# Claude Agent SDK with Stagehand Browser Automation

An interactive CLI demonstrating how to use the Claude Agent SDK with custom Stagehand tools for AI-powered browser automation.

## Overview

This project showcases:
- **Claude Agent SDK**: Build autonomous AI agents with Claude's capabilities
- **Custom MCP Tools**: Extend Claude with Stagehand browser automation
- **Interactive CLI**: Multi-turn conversations with persistent context
- **Browser Automation**: Navigate, extract data, and interact with web pages using natural language

## Installation

```bash
npm install
```

**Note**: This project uses your local Chrome installation instead of Playwright's bundled Chromium. Make sure you have Chrome installed on your system.

### Dependencies

The project uses:
- `@anthropic-ai/claude-agent-sdk` - SDK for building Claude agents
- `@browserbasehq/stagehand` - AI-powered browser automation framework
- `zod@^3.25.0` - Schema validation (required by Stagehand)
- `typescript`, `tsx` - TypeScript support

## Setup

1. Set your Anthropic API key as an environment variable:
```bash
export ANTHROPIC_API_KEY="your-api-key"
```

2. Create the required directory structure:
```bash
mkdir -p agent/custom_scripts
```

The `agent` directory is used as the working directory for the Claude agent, and `custom_scripts` is where JavaScript/TypeScript files must be written (enforced by the hook in the example).

## How It Works

### Basic Structure

The SDK uses **streaming input mode** for persistent, interactive sessions. Use an async generator to yield messages:

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

// Create an async generator for streaming messages
async function* generateMessages() {
  yield {
    type: "user" as const,
    message: {
      role: "user" as const,
      content: "Your prompt here"
    }
  };
}

const q = query({
  prompt: generateMessages(),
  options: { /* configuration */ }
});

// Stream responses in real-time
for await (const message of q) {
  // Process messages as they arrive
}
```

**Why streaming mode?**
- Enables multi-turn conversations
- Supports image attachments and rich content
- Provides real-time response generation
- Maintains context across turns
- Allows dynamic message handling

### Key Components

#### 1. Query Options

- **`maxTurns`**: Maximum number of conversation turns (default: 100)
- **`cwd`**: Working directory for the agent (must exist)
- **`model`**: Claude model to use (`"sonnet"`, `"opus"`, `"haiku"`, or `"inherit"`)
- **`executable`**: Path to Node.js binary (use `process.execPath` for current runtime)
- **`allowedTools`**: Array of tool names the agent can use

#### 2. Available Tools

The agent can use various tools including:
- **File operations**: `Read`, `Write`, `Edit`, `MultiEdit`, `NotebookEdit`
- **Search**: `Glob`, `Grep`, `WebSearch`
- **Execution**: `Bash`, `Task`
- **Utilities**: `TodoWrite`, `WebFetch`, `BashOutput`, `KillBash`
- **Planning**: `ExitPlanMode`

#### 3. Hooks

Hooks allow you to intercept and control tool usage. The example includes a `PreToolUse` hook that enforces that `.js` and `.ts` files can only be written to the `custom_scripts` directory:

```typescript
hooks: {
  PreToolUse: [
    {
      matcher: "Write|Edit|MultiEdit",
      hooks: [
        async (input: any): Promise<HookJSONOutput> => {
          // Validation logic
          // Return { continue: true } to allow
          // Return { decision: 'block', stopReason: '...', continue: false } to deny
        }
      ]
    }
  ]
}
```

#### 4. Message Types

The SDK returns several types of messages as you iterate through the query:

- **`system`**: System initialization and configuration messages
- **`assistant`**: Claude's responses - can contain:
  - Text content (conversational responses)
  - Tool uses (actions Claude wants to take)
- **`user`**: Tool results returned to Claude
- **`result`**: Final summary when a task completes (duration, cost, turns)

##### Handling Assistant Messages

Claude's responses come in `assistant` messages with a `content` array containing either text or tool uses:

```typescript
if (message.type === 'assistant' && message.message) {
  // Handle text responses
  const textContent = message.message.content.find((c: any) => c.type === 'text');
  if (textContent && 'text' in textContent) {
    console.log('Claude says:', textContent.text);
  }

  // Handle tool uses
  const toolUses = message.message.content.filter((c: any) => c.type === 'tool_use');
  for (const toolUse of toolUses) {
    console.log(`Using tool: ${toolUse.name}`, toolUse.input);
  }
}
```

##### Handling Tool Results

Tool results come back as `user` type messages (they're "from the user's environment"):

```typescript
if (message.type === 'user' && message.message) {
  const toolResults = message.message.content.filter((c: any) => c.type === 'tool_result');
  for (const result of toolResults) {
    const textResult = result.content.find((c: any) => c.type === 'text');
    console.log('Tool result:', textResult.text);
  }
}
```

##### Handling Task Completion

When Claude finishes a task, you'll receive a `result` message with summary information:

```typescript
if (message.type === 'result') {
  console.log(`✓ Task completed in ${message.duration_ms}ms (${message.num_turns} turns)`);
  console.log(`💰 Cost: $${message.total_cost_usd.toFixed(4)}`);

  // This is when you should prompt the user for follow-up questions
  shouldPromptUser = true;
}
```

### Architecture

1. The SDK spawns a Claude Code CLI process as a subprocess
2. It uses the Node.js binary specified in `executable` (defaults to `"node"`)
3. Communication happens via stdin/stdout with the subprocess
4. The agent runs in the specified `cwd` directory
5. Hooks can intercept and modify tool calls before execution

## Running the Example

### Interactive Mode (No Arguments)

Start a conversation without an initial prompt:
```bash
npx tsx hello-world.ts
```

This will show `You:` and wait for your first message.

### With Initial Prompt

Start with a specific task:
```bash
npx tsx hello-world.ts "Go to Hacker News and get the title of the top post"
```

After Claude responds, you'll see `You:` and can continue the conversation:
- Ask follow-up questions
- Give new instructions
- Type `exit` or `quit` to end the session

### Example Browser Automation Tasks

```bash
# Extract data from a website
npx tsx hello-world.ts "Navigate to example.com and extract the page title"

# Interact with forms
npx tsx hello-world.ts "Go to google.com and search for 'AI agents'"

# Take screenshots
npx tsx hello-world.ts "Go to github.com/browserbase/stagehand and take a screenshot"
```

## Custom Stagehand Tools

The project includes a custom MCP server (`stagehand-tools.ts`) with 6 browser automation tools:

### Available Tools

1. **`navigate`** - Navigate to a URL
   ```typescript
   await page.goto("https://example.com")
   ```

2. **`act`** - Perform actions using natural language
   ```typescript
   await page.act("click the login button")
   await page.act("fill in email with test@example.com")
   ```

3. **`extract`** - Extract structured data with schemas
   ```typescript
   await page.extract({
     instruction: "extract the title and author",
     schema: { title: "string", author: "string" }
   })
   ```

4. **`observe`** - Discover available actions on the page
   ```typescript
   await page.observe("find all buttons")
   ```

5. **`screenshot`** - Take a screenshot
   ```typescript
   await page.screenshot({ path: "screenshot.png" })
   ```

6. **`close_browser`** - Cleanup and close the browser

### How the Custom Tools Work

The tools are registered via the `mcpServers` option:

```typescript
const q = query({
  prompt: generateMessages(),
  options: {
    mcpServers: {
      "stagehand": stagehandServer
    },
    allowedTools: [
      "mcp__stagehand__navigate",
      "mcp__stagehand__act",
      "mcp__stagehand__extract",
      "mcp__stagehand__observe",
      "mcp__stagehand__screenshot",
      "mcp__stagehand__close_browser"
    ]
  }
});
```

Tool names follow the format: `mcp__{server_name}__{tool_name}`

## What We Learned

### 1. Creating Custom MCP Tools

Custom tools extend Claude's capabilities with domain-specific functionality:

```typescript
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

const customServer = createSdkMcpServer({
  name: "stagehand",
  version: "1.0.0",
  tools: [
    tool(
      "navigate",
      "Navigate to a URL in the browser",
      {
        url: z.string().describe("The URL to navigate to"),
      },
      async (args) => {
        const { page } = await getStagehand();
        await page.goto(args.url);
        return {
          content: [{ type: "text", text: `Navigated to ${args.url}` }]
        };
      }
    )
  ]
});
```

**Key learnings:**
- Use `z` (Zod) for type-safe parameter validation
- Return content in the format `{ content: [{ type: "text", text: "..." }] }`
- Tools can be async and maintain state between calls
- Tool names become `mcp__{server_name}__{tool_name}` when registered

### 2. Using Local Chrome with Remote Debugging

**Problem**: Chrome requires a non-default user data directory for remote debugging to work.

**Solution**: Copy the user's Chrome profile to a local directory and launch Chrome with CDP:

```typescript
// Copy Chrome profile to .chrome-profile directory
const sourceUserDataDir = getChromeUserDataDir();
const tempUserDataDir = join(process.cwd(), '.chrome-profile');

if (!existsSync(tempUserDataDir)) {
  cpSync(sourceDefaultProfile, destDefaultProfile, { recursive: true });
}

// Launch Chrome with remote debugging
const chromeProcess = spawn(chromePath, [
  '--remote-debugging-port=9222',
  `--user-data-dir=${tempUserDataDir}`,
]);

// Wait for CDP to be ready
const response = await fetch('http://127.0.0.1:9222/json/version');

// Connect via CDP
const stagehand = new Stagehand({
  env: "LOCAL",
  localBrowserLaunchOptions: {
    cdpUrl: 'http://localhost:9222',
  },
});
```

**Why this matters**:
- Uses your real Chrome with all your cookies and sessions
- No conflicts with your running Chrome instance
- Profile is copied once and reused for faster subsequent launches
- Chrome requires a non-default data directory for remote debugging

### 3. Interactive CLI with Async Generators

**Challenge**: Coordinate between user input and Claude's responses while supporting multi-turn follow-ups.

**Solution**: Use a flag to control when to prompt for input, and watch for the `result` message:

```typescript
let shouldPromptUser = false;
let conversationActive = true;

async function* generateMessages() {
  // Send initial prompt if provided
  if (initialPrompt) {
    yield {
      type: "user" as const,
      message: { role: "user" as const, content: initialPrompt }
    };
  }

  // Keep accepting follow-up messages
  while (conversationActive) {
    // Wait until Claude finishes responding
    while (!shouldPromptUser && conversationActive) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    shouldPromptUser = false;
    const userInput = await getUserInput();

    if (userInput === 'exit') {
      conversationActive = false;
      break;
    }

    yield {
      type: "user" as const,
      message: { role: "user" as const, content: userInput }
    };
  }
}

// Watch for task completion to prompt for follow-up
for await (const message of q) {
  if (message.type === 'result') {
    // Task completed - ready for follow-up
    shouldPromptUser = true;
  }
}

// Only close readline when exiting, not after each task
if (!conversationActive) {
  rl.close();
}
```

**Key insights:**
- Generator must wait for consumption before prompting
- Watch for `result` message type (not just lack of tool_use) to know when Claude is done
- Keep readline open to support follow-up questions
- Only close readline when user explicitly exits
- Disable verbose logging (`verbose: 0`) to prevent interference with readline

### 4. Lazy Initialization Pattern

Stagehand browser instance is expensive to create. Use singleton pattern:

```typescript
let stagehandInstance: Stagehand | null = null;

async function getStagehand() {
  if (!stagehandInstance) {
    stagehandInstance = new Stagehand({ env: "LOCAL" });
    await stagehandInstance.init();
    // Wait for readiness...
  }
  return stagehandInstance;
}
```

This ensures the browser is only initialized once per session.

## Common Issues

### Chrome not found

**Error**: `Could not find local Chrome installation`

**Solution**: Install Google Chrome for your platform:
- **macOS**: Download from https://www.google.com/chrome/
- **Windows**: Download from https://www.google.com/chrome/
- **Linux**: Run `sudo apt install google-chrome-stable` or `sudo apt install chromium-browser`

### CDP connection refused

**Error**: `browserType.connectOverCDP: connect ECONNREFUSED`

**Solution**: This usually means Chrome didn't start with remote debugging properly. The script handles this automatically by:
1. Copying your Chrome profile to `.chrome-profile/` (first run only)
2. Launching Chrome with `--remote-debugging-port=9222`
3. Polling the CDP endpoint until ready

If issues persist, try deleting `.chrome-profile/` and restarting.

### Profile conflicts

**Issue**: Want to refresh cookies from your main Chrome profile

**Solution**: Delete the `.chrome-profile/` directory to trigger a fresh copy on next run:
```bash
rm -rf .chrome-profile
```

## Claude Agent SDK Documentation

### Overview

The Claude Agent SDK (formerly Claude Code SDK) provides tools for building custom AI agents with Claude's capabilities. It offers:

- **Automatic context management**: Handles conversation flow and state
- **Rich tool ecosystem**: File operations, code execution, web search, and more
- **Advanced permissions control**: Fine-grained control over agent capabilities
- **Production-ready essentials**: Error handling, session management, and streaming

### TypeScript SDK Features

#### Installation
```bash
npm install @anthropic-ai/claude-agent-sdk
```

#### Core Functions

1. **`query()`**: Primary method for interacting with agents
   - Streams messages as they arrive
   - Accepts a prompt (string or async iterable)
   - Returns a `Query` object with additional methods

2. **`tool()`**: Creates type-safe MCP tool definitions
   - Requires name, description, input schema, and handler function

3. **`createSdkMcpServer()`**: Creates an MCP server in the same process

#### Configuration Options

- **Model selection**: Choose between "sonnet", "opus", "haiku", or "inherit"
- **Permission controls**: Specify allowed tools and directories
- **Environment access**: Control working directory and environment variables
- **Hooks**: Intercept events like tool use, session start/end
- **Custom tools**: Define MCP tools for specialized functionality

#### Use Cases

**Coding Agents:**
- SRE diagnostic tools
- Security review bots
- Oncall engineering assistants
- Code review agents

**Business Agents:**
- Legal contract reviewers
- Finance analysis assistants
- Customer support agents
- Content creation tools

### Model Context Protocol (MCP)

The SDK supports MCP for extending agent functionality with custom tools and integrations. Use the `tool()` function to create type-safe tool definitions.

## Resources

- [Claude Agent SDK Overview](https://docs.claude.com/en/api/agent-sdk/overview)
- [TypeScript SDK Documentation](https://docs.claude.com/en/api/agent-sdk/typescript)
- [GitHub Repository](https://github.com/anthropics/claude-agent-sdk-typescript)
- [Anthropic Engineering Blog](https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk)
