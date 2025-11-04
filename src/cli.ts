#!/usr/bin/env node
import { Stagehand } from '@browserbasehq/stagehand';
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'fs';
import { spawn, ChildProcess } from 'child_process';
import { join } from 'path';
import { findLocalChrome, prepareChromeProfile, takeScreenshot } from './browser-utils.js';
import { z } from 'zod';
import dotenv from 'dotenv';
dotenv.config();

// Persistent browser state
let stagehandInstance: Stagehand | null = null;
let currentPage: any = null;
let chromeProcess: ChildProcess | null = null;
let weStartedChrome = false; // Track if we launched Chrome vs. reused existing

async function initBrowser() {
  if (stagehandInstance) {
    return { stagehand: stagehandInstance, page: currentPage };
  }

  const chromePath = findLocalChrome();
  if (!chromePath) {
    throw new Error('Could not find Chrome installation');
  }

  const cdpPort = 9222;
  const tempUserDataDir = join(process.cwd(), '.chrome-profile');

  // Check if Chrome is already running on the CDP port
  let chromeReady = false;
  try {
    const response = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
    if (response.ok) {
      chromeReady = true;
      console.error('Reusing existing Chrome instance on port', cdpPort);
    }
  } catch (error) {
    // Chrome not running, need to launch it
  }

  // Launch Chrome if not already running
  if (!chromeReady) {
    chromeProcess = spawn(chromePath, [
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${tempUserDataDir}`,
      '--window-position=-9999,-9999', // Launch minimized off-screen
      '--window-size=1280,720',
    ], {
      stdio: 'ignore', // Ignore stdio to prevent pipe buffer blocking
      detached: false,
    });

    // Store PID for safe cleanup later
    if (chromeProcess.pid) {
      const pidFilePath = join(process.cwd(), '.chrome-pid');
      writeFileSync(pidFilePath, JSON.stringify({
        pid: chromeProcess.pid,
        startTime: Date.now()
      }));
    }

    // Wait for Chrome to be ready
    for (let i = 0; i < 50; i++) {
      try {
        const response = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
        if (response.ok) {
          chromeReady = true;
          weStartedChrome = true; // Mark that we started this Chrome instance
          break;
        }
      } catch (error) {
        // Still waiting
      }
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    if (!chromeReady) {
      throw new Error('Chrome failed to start');
    }
  }

  // Initialize Stagehand
  stagehandInstance = new Stagehand({
    env: "LOCAL",
    verbose: 0,
    modelName: "anthropic/claude-haiku-4-5-20251001",
    localBrowserLaunchOptions: {
      cdpUrl: `http://localhost:${cdpPort}`,
    },
  });

  await stagehandInstance.init();
  currentPage = stagehandInstance.page;

  // Wait for page to be ready
  let retries = 0;
  while (retries < 30) {
    try {
      await currentPage.evaluate('document.readyState');
      break;
    } catch (error) {
      await new Promise(resolve => setTimeout(resolve, 100));
      retries++;
    }
  }

  // Configure downloads
  const downloadsPath = join(process.cwd(), 'agent', 'downloads');
  if (!existsSync(downloadsPath)) {
    mkdirSync(downloadsPath, { recursive: true });
  }

  const context = currentPage.context();
  const client = await context.newCDPSession(currentPage);
  await client.send("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: downloadsPath,
    eventsEnabled: true,
  });

  return { stagehand: stagehandInstance, page: currentPage };
}

async function closeBrowser() {
  const cdpPort = 9222;
  const pidFilePath = join(process.cwd(), '.chrome-pid');

  // First, try to close via Stagehand if we have an instance in this process
  if (stagehandInstance) {
    try {
      await stagehandInstance.close();
    } catch (error) {
      console.error('Error closing Stagehand:', error instanceof Error ? error.message : String(error));
    }
    stagehandInstance = null;
    currentPage = null;
  }

  // If we started Chrome in this process, kill it
  if (chromeProcess && weStartedChrome) {
    try {
      chromeProcess.kill('SIGTERM');
      // Wait briefly for graceful shutdown
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (chromeProcess.exitCode === null) {
        chromeProcess.kill('SIGKILL');
      }
    } catch (error) {
      console.error('Error killing Chrome process:', error instanceof Error ? error.message : String(error));
    }
    chromeProcess = null;
    weStartedChrome = false;
  }

  // For separate CLI invocations, use graceful CDP shutdown + PID file verification
  try {
    // Step 1: Try graceful shutdown via CDP
    const response = await fetch(`http://127.0.0.1:${cdpPort}/json/version`, {
      signal: AbortSignal.timeout(2000)
    });

    if (response.ok) {
      // Connect and close gracefully via Stagehand
      const tempStagehand = new Stagehand({
        env: "LOCAL",
        verbose: 0,
        enableCaching: true,
        modelName: "anthropic/claude-haiku-4-5-20251001",
        localBrowserLaunchOptions: {
          cdpUrl: `http://localhost:${cdpPort}`,
        },
      });
      await tempStagehand.init();
      await tempStagehand.close();

      // Wait briefly for Chrome to close
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Step 2: Check if Chrome is still running
      try {
        const checkResponse = await fetch(`http://127.0.0.1:${cdpPort}/json/version`, {
          signal: AbortSignal.timeout(1000)
        });

        // Chrome is still running, need to force close
        if (checkResponse.ok) {
          // Step 3: Use PID file if available for safe termination
          if (existsSync(pidFilePath)) {
            const pidData = JSON.parse(readFileSync(pidFilePath, 'utf8'));
            const { pid } = pidData;

            // Verify the process is actually Chrome before killing
            const isChrome = await verifyIsChromeProcess(pid);
            if (isChrome) {
              if (process.platform === 'win32') {
                const { exec } = await import('child_process');
                const { promisify } = await import('util');
                const execAsync = promisify(exec);
                await execAsync(`taskkill /PID ${pid} /F`);
              } else {
                process.kill(pid, 'SIGKILL');
              }
            }
          }
        }
      } catch {
        // Chrome successfully closed
      }
    }
  } catch (error) {
    // Chrome not running or already closed
  } finally {
    // Clean up PID file
    if (existsSync(pidFilePath)) {
      try {
        unlinkSync(pidFilePath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

async function verifyIsChromeProcess(pid: number): Promise<boolean> {
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    if (process.platform === 'darwin' || process.platform === 'linux') {
      const { stdout } = await execAsync(`ps -p ${pid} -o comm=`);
      const processName = stdout.trim().toLowerCase();
      return processName.includes('chrome') || processName.includes('chromium');
    } else if (process.platform === 'win32') {
      const { stdout } = await execAsync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`);
      return stdout.toLowerCase().includes('chrome');
    }
    return false;
  } catch {
    return false;
  }
}

// CLI commands
async function navigate(url: string) {
  try {
    const { page } = await initBrowser();
    await page.goto(url);
    const screenshotPath = await takeScreenshot(page);
    return {
      success: true,
      message: `Successfully navigated to ${url}`,
      screenshot: screenshotPath
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function act(action: string) {
  try {
    const { page } = await initBrowser();
    await page.act(action);
    const screenshotPath = await takeScreenshot(page);
    return {
      success: true,
      message: `Successfully performed action: ${action}`,
      screenshot: screenshotPath
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function extract(instruction: string, schema: Record<string, string>) {
  try {
    const { page } = await initBrowser();

    // Convert schema to Zod
    const zodSchema: Record<string, any> = {};
    for (const [key, type] of Object.entries(schema)) {
      switch (type) {
        case "string":
          zodSchema[key] = z.string();
          break;
        case "number":
          zodSchema[key] = z.number();
          break;
        case "boolean":
          zodSchema[key] = z.boolean();
          break;
      }
    }

    const result = await page.extract({
      instruction,
      schema: z.object(zodSchema),
    });
    
    const screenshotPath = await takeScreenshot(page);
    return {
      success: true,
      message: `Successfully extracted data: ${result}`,
      screenshot: screenshotPath
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function observe(query: string) {
  try {
    const { page } = await initBrowser();
    const actions = await page.observe(query);
    const screenshotPath = await takeScreenshot(page);
    return {
      success: true,
      message: `Successfully observed: ${actions}`,
      screenshot: screenshotPath
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function screenshot() {
  try {
    const { page } = await initBrowser();
    const screenshotPath = await takeScreenshot(page);
    return {
      success: true,
      screenshot: screenshotPath
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

// Main CLI handler
async function main() {
  // Prepare Chrome profile on first run
  prepareChromeProfile();

  const args = process.argv.slice(2);
  const command = args[0];

  try {
    let result: { success: boolean; [key: string]: any };

    switch (command) {
      case 'navigate':
        if (args.length < 2) {
          throw new Error('Usage: browser navigate <url>');
        }
        result = await navigate(args[1]);
        break;

      case 'act':
        if (args.length < 2) {
          throw new Error('Usage: browser act "<action>"');
        }
        result = await act(args.slice(1).join(' '));
        break;

      case 'extract':
        if (args.length < 3) {
          throw new Error('Usage: browser extract "<instruction>" \'{"field": "type"}\'');
        }
        const instruction = args[1];
        const schema = JSON.parse(args[2]);
        result = await extract(instruction, schema);
        break;

      case 'observe':
        if (args.length < 2) {
          throw new Error('Usage: browser observe "<query>"');
        }
        result = await observe(args.slice(1).join(' '));
        break;

      case 'screenshot':
        result = await screenshot();
        break;

      case 'close':
        await closeBrowser();
        result = { success: true, message: 'Browser closed' };
        break;

      default:
        throw new Error(`Unknown command: ${command}\nAvailable commands: navigate, act, extract, observe, screenshot, close`);
    }

    console.log(JSON.stringify(result, null, 2));

    // Browser stays open between commands - only closes on explicit 'close' command
    // This allows for faster sequential operations and preserves browser state

    // Exit immediately after printing result
    process.exit(0);
  } catch (error) {
    // Close browser on error too
    await closeBrowser();

    console.error(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, null, 2));
    process.exit(1);
  }
}

// Handle cleanup
process.on('SIGINT', async () => {
  await closeBrowser();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await closeBrowser();
  process.exit(0);
});

main().catch(console.error);
