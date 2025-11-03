# Browser Automation Skill

## Available as a Claude Code Skill

This browser automation is available as a **Claude Code Skill** via the plugin marketplace. Skills are folders of instructions, scripts, and resources that Claude loads dynamically to improve performance on specialized tasks. They teach Claude how to complete specific tasks in a repeatable way.

**Install via Claude Code:**
```
/plugin marketplace add browserbase/agent-browse
```

Once installed, simply mention the skill in your conversation: "Use the browser automation skill to navigate to example.com and extract contact information."

Learn more:
- [What are skills?](https://support.claude.com/en/articles/12512176-what-are-skills)
- [Using skills in Claude](https://support.claude.com/en/articles/12512180-using-skills-in-claude)
- [How to create custom skills](https://support.claude.com/en/articles/12512198-creating-custom-skills)

---

# Claude Agent SDK + Stagehand: Agentic Browser Automation

## About This Demo

A demo showing how the **[Claude Agent SDK](https://docs.claude.com/en/api/agent-sdk/overview)** (reasoning) combines with **[Stagehand](https://github.com/browserbase/stagehand)** (AI browser automation framework) to create powerful agentic browser automation. Because Stagehand accepts natural language instructions, it's significantly more context-efficient than native Playwright.

## Architecture: Reasoning + Tools

This demo illustrates a clean separation of concerns:

- **Claude Agent SDK**: Handles all reasoning, planning, and decision-making
- **Stagehand**: Executes browser actions via natural language commands
- **Result**: Context-efficient automation where Claude decides *what* to do and Stagehand handles *how* to do it

### Context Efficiency

**Stagehand saves thousands of tokens per interaction** by handling DOM traversal and selector logic internally.

```typescript
// Traditional: ~500 tokens of context + implementation
- Full DOM structure passed to Claude
- Claude generates: await page.click('button[data-testid="auth-submit"][aria-label="Submit"]');
- Breaks if UI changes

// Stagehand: ~50 tokens
- Claude calls: act({ action: "click the submit button" })
- Stagehand figures out the selector
- Resilient to UI changes
```

## Installation

```bash
npm install
```

**Requirements**: Chrome must be installed on your system.

## Setup

Set your Anthropic API key:
```bash
export ANTHROPIC_API_KEY="your-api-key"
```

**Note**: On first run, the demo will automatically copy your Chrome user data directory to `.chrome-profile` for browser automation. This preserves your cookies and logged-in sessions.

## Usage

### Interactive Mode
```bash
npx tsx agent-browse.ts
```

### With Initial Prompt
```bash
npx tsx agent-browse.ts "Go to Hacker News and get the title of the top post"
```

After Claude responds, you can:
- Ask follow-up questions
- Give new instructions
- Type `exit` or `quit` to end

### Example Tasks

```bash
# Complex multi-step workflow
npx tsx agent-browse.ts "Go to Hacker News, find the top post, click it, and summarize what it's about"

# Data extraction with reasoning
npx tsx agent-browse.ts "Navigate to example.com and extract any contact information you can find"

# Adaptive navigation
npx tsx agent-browse.ts "Go to github.com/browserbase/stagehand, take a screenshot, then find and click the documentation link"
```

Claude will:
1. **Plan** the steps needed (reasoning via Agent SDK)
2. **Execute** each step using Stagehand tools (natural language browser actions)
3. **Adapt** based on what it sees (screenshots, extracted data)
4. **Report** back with results

## Stagehand Tools

The demo exposes 6 Stagehand browser automation tools via MCP:

| Tool | Description | Example |
|------|-------------|---------|
| `navigate` | Go to a URL | `navigate({ url: "https://example.com" })` |
| `act` | Perform actions via natural language | `act({ action: "click the login button" })` |
| `extract` | Get structured data from the page | `extract({ instruction: "extract the title", schema: { title: "string" } })` |
| `observe` | Discover what's on the page | `observe({ query: "find all buttons" })` |
| `screenshot` | Capture the current page | `screenshot({})` |
| `close_browser` | Clean up when done | `close_browser({})` |

### How It Works

```typescript
const q = query({
  prompt: generateMessages(),
  options: {
    mcpServers: {
      "stagehand": stagehandServer  // Register Stagehand tools
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

**The flow:**
1. Claude (via Agent SDK) decides what browser action to take
2. Claude calls a Stagehand MCP tool with natural language parameters
3. Stagehand translates the natural language into precise browser actions
4. Results flow back to Claude for the next decision

## Troubleshooting

### Chrome not found

Install Chrome for your platform:
- **macOS**: https://www.google.com/chrome/
- **Windows**: https://www.google.com/chrome/
- **Linux**: `sudo apt install google-chrome-stable`

### Profile refresh

To refresh cookies from your main Chrome profile:
```bash
rm -rf .chrome-profile
```

## Resources

- [Claude Agent SDK Documentation](https://docs.claude.com/en/api/agent-sdk/overview)
- [Stagehand Documentation](https://github.com/browserbase/stagehand)
- [MCP (Model Context Protocol)](https://modelcontextprotocol.io)
