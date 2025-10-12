import { existsSync, cpSync, mkdirSync } from 'fs';
import { platform } from 'os';
import { join } from 'path';

/**
 * Finds the local Chrome installation path based on the operating system
 * @returns The path to the Chrome executable, or undefined if not found
 */
export function findLocalChrome(): string | undefined {
  const systemPlatform = platform();
  const chromePaths: string[] = [];

  if (systemPlatform === 'darwin') {
    // macOS paths
    chromePaths.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      `${process.env.HOME}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
      `${process.env.HOME}/Applications/Chromium.app/Contents/MacOS/Chromium`
    );
  } else if (systemPlatform === 'win32') {
    // Windows paths
    chromePaths.push(
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
      'C:\\Program Files\\Chromium\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Chromium\\Application\\chrome.exe'
    );
  } else {
    // Linux paths
    chromePaths.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium',
      '/usr/local/bin/google-chrome',
      '/usr/local/bin/chromium',
      '/opt/google/chrome/chrome',
      '/opt/google/chrome/google-chrome'
    );
  }

  // Find the first existing Chrome installation
  for (const path of chromePaths) {
    if (path && existsSync(path)) {
      return path;
    }
  }

  return undefined;
}

/**
 * Gets the Chrome user data directory path based on the operating system
 * @returns The path to Chrome's user data directory, or undefined if not found
 */
export function getChromeUserDataDir(): string | undefined {
  const systemPlatform = platform();

  if (systemPlatform === 'darwin') {
    return `${process.env.HOME}/Library/Application Support/Google/Chrome`;
  } else if (systemPlatform === 'win32') {
    return `${process.env.LOCALAPPDATA}\\Google\\Chrome\\User Data`;
  } else {
    // Linux
    return `${process.env.HOME}/.config/google-chrome`;
  }
}

/**
 * Prepares the Chrome profile by copying it to .chrome-profile directory (first run only)
 * This should be called before initializing Stagehand to avoid timeouts
 */
export function prepareChromeProfile() {
  const sourceUserDataDir = getChromeUserDataDir();
  const tempUserDataDir = join(process.cwd(), '.chrome-profile');

  // Only copy if the temp directory doesn't exist yet
  if (!existsSync(tempUserDataDir)) {
    const dim = '\x1b[2m';
    const reset = '\x1b[0m';

    // Show copying message
    console.log(`${dim}Copying Chrome profile to .chrome-profile/ (this may take a minute)...${reset}`);

    mkdirSync(tempUserDataDir, { recursive: true });

    // Copy the Default profile directory (contains cookies, local storage, etc.)
    const sourceDefaultProfile = join(sourceUserDataDir!, 'Default');
    const destDefaultProfile = join(tempUserDataDir, 'Default');

    if (existsSync(sourceDefaultProfile)) {
      cpSync(sourceDefaultProfile, destDefaultProfile, { recursive: true });
      console.log(`${dim}✓ Profile copied successfully${reset}\n`);
    } else {
      console.log(`${dim}No existing profile found, using fresh profile${reset}\n`);
    }
  }
}
