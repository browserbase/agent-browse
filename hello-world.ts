import { query } from '@anthropic-ai/claude-agent-sdk';
import type { HookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import * as path from "path";
import * as readline from "readline";
import stagehandServer from './stagehand-tools.js';

// ANSI color codes for prettier output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
};

async function main() {
  // Get initial prompt from command line arguments
  const args = process.argv.slice(2);
  const hasInitialPrompt = args.length > 0;
  const initialPrompt = hasInitialPrompt ? args.join(' ') : null;

  if (hasInitialPrompt) {
    console.log(`${colors.dim}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
    console.log(`${colors.bright}${colors.cyan}You:${colors.reset} ${initialPrompt}`);
    console.log(`${colors.dim}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`);
  }

  // Create readline interface for interactive input
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const getUserInput = (prompt: string = `\n${colors.bright}${colors.cyan}You:${colors.reset} `): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(prompt, (answer) => {
        resolve(answer);
      });
    });
  };

  let shouldPromptUser = !hasInitialPrompt; // If no initial prompt, ask for input immediately
  let conversationActive = true;

  // Streaming input mode: creates an async generator for multi-turn conversations
  async function* generateMessages() {
    // Send initial prompt if provided
    if (initialPrompt) {
      yield {
        type: "user" as const,
        message: {
          role: "user" as const,
          content: initialPrompt
        },
        parent_tool_use_id: null,
        session_id: "default"
      };
    }

    // Keep accepting new messages
    while (conversationActive) {
      // Wait until we're ready for next input
      while (!shouldPromptUser && conversationActive) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      if (!conversationActive) break;

      shouldPromptUser = false;
      const userInput = await getUserInput();

      if (userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === 'quit') {
        conversationActive = false;
        console.log(`\n${colors.dim}Goodbye!${colors.reset}`);
        break;
      }

      yield {
        type: "user" as const,
        message: {
          role: "user" as const,
          content: userInput
        },
        parent_tool_use_id: null,
        session_id: "default"
      };
    }
  }

  const q = query({
    prompt: generateMessages(),
    options: {
      systemPrompt: { type: 'preset', preset: 'claude_code', append: "\n\nWhen using the Stagehand tools, take a screenshot after each tool call and view the screenshot to ensure the tool was completed correctly. Use the todo tools to keep track of your steps." },
      maxTurns: 100,
      cwd: path.join(process.cwd(), 'agent'),
      model: "sonnet",
      executable: "node", // Use the current node binary path
      mcpServers: {
        "stagehand": stagehandServer
      },
      allowedTools: [
        "Task", "Bash", "Glob", "Grep", "LS", "ExitPlanMode", "Read", "Edit", "MultiEdit", "Write", "NotebookEdit",
        "WebFetch", "TodoWrite", "WebSearch", "BashOutput", "KillBash",
        "mcp__stagehand__navigate", "mcp__stagehand__act", "mcp__stagehand__extract",
        "mcp__stagehand__observe", "mcp__stagehand__screenshot",
        "mcp__stagehand__close_browser"
      ],
      hooks: {
        PreToolUse: [
          {
            matcher: "Write|Edit|MultiEdit",
            hooks: [
              async (input: any): Promise<HookJSONOutput> => {
                const toolName = input.tool_name;
                const toolInput = input.tool_input;

                if (!['Write', 'Edit', 'MultiEdit'].includes(toolName)) {
                  return { continue: true };
                }

                let filePath = '';
                if (toolName === 'Write' || toolName === 'Edit') {
                  filePath = toolInput.file_path || '';
                } else if (toolName === 'MultiEdit') {
                  filePath = toolInput.file_path || '';
                }

                const ext = path.extname(filePath).toLowerCase();
                if (ext === '.js' || ext === '.ts') {
                  const customScriptsPath = path.join(process.cwd(), 'agent', 'custom_scripts');

                  if (!filePath.startsWith(customScriptsPath)) {
                    return {
                      decision: 'block',
                      stopReason: `Script files (.js and .ts) must be written to the custom_scripts directory. Please use the path: ${customScriptsPath}/${path.basename(filePath)}`,
                      continue: false
                    };
                  }
                }

                return { continue: true };
              }
            ]
          }
        ]
      },
    },
  });

  for await (const message of q) {
    // Handle assistant messages (Claude's responses and tool uses)
    if (message.type === 'assistant' && message.message) {
      const textContent = message.message.content.find((c: any) => c.type === 'text');
      if (textContent && 'text' in textContent) {
        console.log(`\n${colors.bright}${colors.magenta}Claude:${colors.reset} ${textContent.text}`);
      }

      // Show tool uses (but not tool results - those come in 'user' type messages)
      const toolUses = message.message.content.filter((c: any) => c.type === 'tool_use');
      for (const toolUse of toolUses) {
        const toolName = (toolUse as any).name.replace('mcp__stagehand__', '');
        console.log(`\n${colors.blue}🔧 Using tool:${colors.reset} ${colors.bright}${toolName}${colors.reset}`);
        const input = JSON.stringify((toolUse as any).input, null, 2);
        const indentedInput = input.split('\n').map(line => `   ${colors.dim}${line}${colors.reset}`).join('\n');
        console.log(indentedInput);
      }
    }

    // Handle tool results (these come as 'user' type messages)
    if (message.type === 'user' && message.message) {
      const content = message.message.content;
      // Content can be a string or an array
      if (Array.isArray(content)) {
        const toolResults = content.filter((c: any) => c.type === 'tool_result');
        for (const result of toolResults as any[]) {
          // Handle errors
          if (result.is_error) {
            const errorText = typeof result.content === 'string'
              ? result.content
              : JSON.stringify(result.content);
            console.log(`\n${colors.red}❌ Tool error:${colors.reset} ${errorText}`);
            continue;
          }

          // Handle successful results
          if (result.content) {
            // Content can be a string or an array
            if (typeof result.content === 'string') {
              console.log(`\n${colors.green}✓ Tool result:${colors.reset} ${colors.dim}${result.content}${colors.reset}`);
            } else if (Array.isArray(result.content)) {
              const textResult = result.content.find((c: any) => c.type === 'text');
              if (textResult) {
                console.log(`\n${colors.green}✓ Tool result:${colors.reset} ${colors.dim}${textResult.text}${colors.reset}`);
              }
            }
          }
        }
      }
    }

    // Handle result message - this signals the conversation is complete and we should prompt for input
    if (message.type === 'result') {
      // Hand control back to user for follow-up questions
      shouldPromptUser = true;
    }
  }

  // Only close readline when conversation is fully done
  rl.close();
  process.exit(0);
}

main().catch(console.error);
