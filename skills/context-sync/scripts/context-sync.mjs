#!/usr/bin/env node

import crypto from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  createReadStream,
  createWriteStream,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

import Browserbase from '@browserbasehq/sdk';
import { Stagehand } from '@browserbasehq/stagehand';
import AdmZip from 'adm-zip';

const HELP = `context-sync — copy durable Chrome profile state to a Browserbase Context

Usage:
  node scripts/context-sync.mjs [options]

Options:
  --user-data-dir <path>  Chromium user-data directory (auto-detected when possible)
  --profile <directory>   Profile directory to sync (default: Default)
  --context <id>          Replace an existing Context instead of creating one
  --domains <a.com,b.com> Only inject cookies matching these domains
  --close-browser         Close local Chrome after exporting cookies (recommended)
  --allow-live-copy       Copy while Chrome is open; may produce inconsistent state
  --verified              Use Browserbase Verified mode for cookie injection
  --proxy <City,ST,US>    Use a Browserbase residential proxy for cookie injection
  --dry-run               Inventory files without creating or uploading an archive
  --keep-archive          Keep the encrypted archive and print its local path
  --help                  Show this help

Environment:
  BROWSERBASE_API_KEY     Required unless --dry-run is used
  CDP_URL                 Optional Chrome debug HTTP/WebSocket endpoint
  CDP_PORT_FILE           Optional path to DevToolsActivePort
  CDP_HOST                Optional debug host (default: 127.0.0.1)
`;

function parseArgs() {
  const result = {
    userDataDir: null,
    profile: 'Default',
    contextId: null,
    domains: [],
    closeBrowser: false,
    allowLiveCopy: false,
    verified: false,
    proxy: null,
    dryRun: false,
    keepArchive: false,
  };
  const args = process.argv.slice(2);
  const take = (flag, index) => {
    if (!args[index + 1]) throw new Error(`${flag} requires a value`);
    return args[index + 1];
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--help') {
      console.log(HELP);
      process.exit(0);
    } else if (arg === '--user-data-dir') {
      result.userDataDir = resolve(take(arg, i));
      i += 1;
    } else if (arg === '--profile') {
      result.profile = take(arg, i);
      i += 1;
    } else if (arg === '--context') {
      result.contextId = take(arg, i);
      i += 1;
    } else if (arg === '--domains') {
      result.domains = take(arg, i).split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
      i += 1;
    } else if (arg === '--close-browser') {
      result.closeBrowser = true;
    } else if (arg === '--allow-live-copy') {
      result.allowLiveCopy = true;
    } else if (arg === '--verified') {
      result.verified = true;
    } else if (arg === '--proxy') {
      const parts = take(arg, i).split(',').map((value) => value.trim());
      if (!parts[0] || !parts[1]) throw new Error('--proxy requires "City,State,Country"');
      result.proxy = { city: parts[0], state: parts[1], country: parts[2] || 'US' };
      i += 1;
    } else if (arg === '--dry-run') {
      result.dryRun = true;
    } else if (arg === '--keep-archive') {
      result.keepArchive = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (result.closeBrowser && result.allowLiveCopy) {
    throw new Error('Choose --close-browser or --allow-live-copy, not both');
  }
  if (result.profile.includes('/') || result.profile.includes('\\') || result.profile === '..') {
    throw new Error('--profile must be a directory name such as Default or "Profile 1"');
  }
  return result;
}

const CLI = parseArgs();

const CACHE_PREFIXES = [
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'GrShaderCache',
  'GraphiteDawnCache',
  'ShaderCache',
];

const RUNTIME_NAMES = new Set([
  'DevToolsActivePort',
  'SingletonCookie',
  'SingletonLock',
  'SingletonSocket',
  'lockfile',
]);

const NON_PORTABLE_DATABASES = [
  'Cookies',
  'Network/Cookies',
  'Login Data',
  'Login Data For Account',
];

const SESSION_RESTORE_PREFIXES = [
  'Sessions',
  'Current Session',
  'Current Tabs',
  'Last Session',
  'Last Tabs',
];

function normalizePath(path) {
  return path.split(sep).join('/');
}

function isPathOrChild(path, prefix) {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function shouldExclude(relativePath) {
  const rel = normalizePath(relativePath);
  const name = basename(rel);
  if (RUNTIME_NAMES.has(name)) return true;
  if (CACHE_PREFIXES.some((prefix) => isPathOrChild(rel, prefix))) return true;
  if (SESSION_RESTORE_PREFIXES.some((prefix) => isPathOrChild(rel, prefix))) return true;
  if (NON_PORTABLE_DATABASES.some((prefix) => rel === prefix || rel.startsWith(`${prefix}-`) || rel.startsWith(`${prefix}/`))) {
    return true;
  }
  return false;
}

function collectProfileFiles(profileDir) {
  const files = [];
  const skipped = [];

  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      const rel = relative(profileDir, path);
      if (shouldExclude(rel)) {
        skipped.push(rel);
        continue;
      }
      let stats;
      try {
        stats = lstatSync(path);
      } catch (error) {
        skipped.push(`${rel} (${error.code || 'unreadable'})`);
        continue;
      }
      if (stats.isSymbolicLink()) {
        skipped.push(`${rel} (symlink)`);
      } else if (stats.isDirectory()) {
        walk(path);
      } else if (stats.isFile()) {
        files.push({ path, rel, size: stats.size });
      }
    }
  }

  walk(profileDir);
  return { files, skipped };
}

function inventory(files) {
  const rels = files.map(({ rel }) => normalizePath(rel));
  const has = (prefix) => rels.some((rel) => isPathOrChild(rel, prefix));
  return {
    localStorage: has('Local Storage'),
    indexedDB: has('IndexedDB'),
    cacheStorage: has('Service Worker/CacheStorage'),
    serviceWorkers: has('Service Worker'),
    opfsOrFileSystem: has('File System'),
    bookmarks: has('Bookmarks'),
    history: has('History'),
    preferences: has('Preferences'),
    extensions: has('Extensions') || has('Local Extension Settings') || has('Extension State'),
  };
}

function printInventory(profileDir, files, skipped) {
  const total = files.reduce((sum, file) => sum + file.size, 0);
  const state = inventory(files);
  console.log(`Profile: ${profileDir}`);
  console.log(`Included: ${files.length} files (${(total / 1024 / 1024).toFixed(1)} MiB before ZIP compression)`);
  console.log(`Excluded: ${skipped.length} cache, lock, session-restore, or non-portable credential files`);
  console.log('Detected durable state:');
  for (const [name, present] of Object.entries(state)) {
    console.log(`  ${present ? 'yes' : 'no '}  ${name}`);
  }
}

function candidatePortFiles() {
  const home = homedir();
  const candidates = [];
  if (process.env.CDP_PORT_FILE) candidates.push(resolve(process.env.CDP_PORT_FILE));

  if (process.platform === 'darwin') {
    for (const browser of [
      'Google/Chrome',
      'Google/Chrome Beta',
      'Google/Chrome for Testing',
      'Chromium',
      'BraveSoftware/Brave-Browser',
      'Microsoft Edge',
    ]) {
      candidates.push(resolve(home, 'Library/Application Support', browser, 'DevToolsActivePort'));
      candidates.push(resolve(home, 'Library/Application Support', browser, 'Default/DevToolsActivePort'));
    }
  } else if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA || resolve(home, 'AppData/Local');
    for (const browser of ['Google/Chrome', 'BraveSoftware/Brave-Browser', 'Microsoft/Edge']) {
      candidates.push(resolve(base, browser, 'User Data/DevToolsActivePort'));
      candidates.push(resolve(base, browser, 'User Data/Default/DevToolsActivePort'));
    }
  } else {
    for (const browser of [
      'google-chrome',
      'google-chrome-beta',
      'chromium',
      'BraveSoftware/Brave-Browser',
      'microsoft-edge',
    ]) {
      candidates.push(resolve(home, '.config', browser, 'DevToolsActivePort'));
      candidates.push(resolve(home, '.config', browser, 'Default/DevToolsActivePort'));
    }
  }
  return candidates;
}

function locatePortFile() {
  return candidatePortFiles().find((path) => existsSync(path)) || null;
}

function inferUserDataDir(portFile) {
  if (!portFile) return null;
  let current = dirname(portFile);
  for (let depth = 0; depth < 3; depth += 1) {
    if (existsSync(join(current, 'Local State'))) return current;
    current = dirname(current);
  }
  return dirname(portFile);
}

async function resolveCdpUrl(input) {
  if (/^wss?:\/\/.+\/devtools\/browser\//.test(input)) return input;
  const base = input.replace(/^wss?/i, (scheme) => scheme.length === 3 ? 'https' : 'http').replace(/\/+$/, '');
  const versionUrl = base.endsWith('/json/version') ? base : `${base}/json/version`;
  const response = await fetch(versionUrl);
  if (!response.ok) throw new Error(`Could not resolve CDP endpoint (${response.status})`);
  const info = await response.json();
  if (!info.webSocketDebuggerUrl) throw new Error('Chrome did not expose webSocketDebuggerUrl');
  return info.webSocketDebuggerUrl;
}

async function getLocalConnection(portFile) {
  if (process.env.CDP_URL) return resolveCdpUrl(process.env.CDP_URL);
  if (!portFile) {
    throw new Error('No DevToolsActivePort found. Enable Chrome remote debugging or set CDP_URL.');
  }
  const lines = readFileSync(portFile, 'utf8').trim().split(/\r?\n/);
  if (!lines[0] || !lines[1]) throw new Error(`Invalid DevToolsActivePort file: ${portFile}`);
  return `ws://${process.env.CDP_HOST || '127.0.0.1'}:${lines[0]}${lines[1]}`;
}

function profileLooksLive(userDataDir) {
  return ['SingletonLock', 'SingletonSocket', 'SingletonCookie'].some((name) => existsSync(join(userDataDir, name)));
}

async function exportCookies(cdpUrl) {
  const local = new Stagehand({
    env: 'LOCAL',
    localBrowserLaunchOptions: { cdpUrl },
    verbose: 0,
    disablePino: true,
  });
  await local.init();
  const cookies = await local.context.cookies();
  await local.close();
  return cookies;
}

async function closeBrowser(cdpUrl) {
  await new Promise((resolveClose, reject) => {
    const socket = new WebSocket(cdpUrl);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error('Timed out asking Chrome to close'));
    }, 10_000);
    const finish = () => {
      clearTimeout(timeout);
      resolveClose();
    };
    socket.addEventListener('open', () => socket.send(JSON.stringify({ id: 1, method: 'Browser.close' })));
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id === 1) finish();
    });
    socket.addEventListener('close', finish);
    socket.addEventListener('error', () => reject(new Error('Could not send Browser.close over CDP')));
  });
}

async function waitForProfileToStop(userDataDir) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (!profileLooksLive(userDataDir)) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error('Chrome still appears to be using this profile after 15 seconds');
}

function filterCookies(cookies, domains) {
  if (domains.length === 0) return cookies;
  return cookies.filter((cookie) => {
    const cookieDomain = cookie.domain.replace(/^\./, '').toLowerCase();
    return domains.some((domain) => cookieDomain === domain || cookieDomain.endsWith(`.${domain}`));
  });
}

function toCookieParams(cookies) {
  return cookies.map((cookie) => {
    const result = {
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
    };
    if (cookie.expires > 0) result.expires = cookie.expires;
    if (cookie.sameSite === 'Strict' || cookie.sameSite === 'Lax') result.sameSite = cookie.sameSite;
    if (cookie.sameSite === 'None' && cookie.secure) result.sameSite = 'None';
    return result;
  });
}

async function makeArchive(files, outputPath) {
  const zip = new AdmZip();
  for (const file of files) {
    const archivePath = normalizePath(join('Default', file.rel));
    zip.addLocalFile(file.path, dirname(archivePath), basename(archivePath));
  }
  await zip.writeZipPromise(outputPath, { overwrite: true });
}

async function encryptArchive(inputPath, outputPath, materials) {
  const aesKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(materials.initializationVectorSize);
  const encryptedAesKey = crypto.publicEncrypt(materials.publicKey, aesKey);
  const cipher = crypto.createCipheriv(materials.cipherAlgorithm.toLowerCase(), aesKey, iv);
  const input = createReadStream(inputPath);
  const output = createWriteStream(outputPath);

  await new Promise((resolveEncryption, reject) => {
    input.on('error', reject);
    output.on('error', reject);
    output.on('finish', resolveEncryption);
    output.write(Buffer.concat([encryptedAesKey, iv]));
    input.pipe(cipher).pipe(output);
  });
}

async function getUploadMaterials(client, contextId) {
  if (!contextId) return client.contexts.create({});
  try {
    return await client.contexts.update(contextId);
  } catch (error) {
    throw new Error(`Could not update Context ${contextId}. Custom Context updates may be disabled; omit --context to create a new one. ${error.message}`);
  }
}

async function uploadArchive(uploadUrl, encryptedPath) {
  const body = readFileSync(encryptedPath);
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/zip' },
    body,
  });
  if (!response.ok) throw new Error(`Context archive upload failed (${response.status} ${response.statusText})`);
}

async function injectCookies(contextId, cookies, apiKey) {
  if (cookies.length === 0) return null;
  const browserSettings = { context: { id: contextId, persist: true } };
  if (CLI.verified) browserSettings.verified = true;
  const cloud = new Stagehand({
    env: 'BROWSERBASE',
    apiKey,
    disableAPI: true,
    browserbaseSessionCreateParams: {
      browserSettings,
      ...(CLI.proxy ? { proxies: [{ type: 'browserbase', geolocation: CLI.proxy }] } : {}),
    },
    verbose: 0,
    disablePino: true,
  });
  await cloud.init();
  const sessionId = cloud.browserbaseSessionID;
  await cloud.context.addCookies(toCookieParams(cookies));
  await cloud.close();
  return sessionId;
}

async function main() {
  const portFile = locatePortFile();
  const userDataDir = CLI.userDataDir || inferUserDataDir(portFile);
  if (!userDataDir) {
    throw new Error('Could not infer Chrome user-data directory. Pass --user-data-dir.');
  }
  const profileDir = resolve(userDataDir, CLI.profile);
  if (!existsSync(profileDir) || !statSync(profileDir).isDirectory()) {
    throw new Error(`Profile directory not found: ${profileDir}`);
  }

  const initial = collectProfileFiles(profileDir);
  printInventory(profileDir, initial.files, initial.skipped);
  if (CLI.dryRun) return;

  const apiKey = process.env.BROWSERBASE_API_KEY;
  if (!apiKey) throw new Error('BROWSERBASE_API_KEY is required');
  if (!CLI.closeBrowser && !CLI.allowLiveCopy) {
    throw new Error('A consistent snapshot requires permission to close Chrome. Re-run with --close-browser, or explicitly accept risk with --allow-live-copy.');
  }

  const cdpUrl = await getLocalConnection(portFile);
  const allCookies = await exportCookies(cdpUrl);
  const cookies = filterCookies(allCookies, CLI.domains);
  console.log(`Exported ${cookies.length} cookie(s) through CDP${CLI.domains.length ? ` for ${CLI.domains.join(', ')}` : ''}`);

  if (CLI.closeBrowser) {
    console.log('Closing local Chrome for a consistent profile snapshot...');
    await closeBrowser(cdpUrl);
    await waitForProfileToStop(userDataDir);
  } else if (profileLooksLive(userDataDir)) {
    console.warn('Warning: copying a live profile; SQLite or LevelDB state may be inconsistent.');
  }

  const { files, skipped } = collectProfileFiles(profileDir);
  const workDir = join(tmpdir(), `context-sync-${crypto.randomUUID()}`);
  mkdirSync(workDir, { recursive: true });
  const zipPath = join(workDir, 'profile.zip');
  const encryptedPath = join(workDir, 'profile.encrypted.zip');
  let contextId = CLI.contextId;

  try {
    console.log(`Archiving ${files.length} profile files...`);
    await makeArchive(files, zipPath);

    const client = new Browserbase({ apiKey });
    const materials = await getUploadMaterials(client, contextId);
    contextId = materials.id;
    console.log(`${CLI.contextId ? 'Updating' : 'Created'} Context: ${contextId}`);

    await encryptArchive(zipPath, encryptedPath, materials);
    await uploadArchive(materials.uploadUrl, encryptedPath);
    console.log('Encrypted profile archive uploaded');

    const sessionId = await injectCookies(contextId, cookies, apiKey);
    if (sessionId) console.log(`Injected ${cookies.length} cookie(s) through persistent session ${sessionId}`);

    console.log('');
    console.log('Context sync complete.');
    console.log(`Context ID: ${contextId}`);
    console.log('Use this Context in future sessions with persist enabled.');

    if (CLI.keepArchive) {
      const keptPath = resolve(process.cwd(), `context-${contextId}.encrypted.zip`);
      writeFileSync(keptPath, readFileSync(encryptedPath));
      console.log(`Encrypted archive kept at: ${keptPath}`);
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
