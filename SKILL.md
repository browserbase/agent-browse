---
name: browser
description: Interactive AI-powered browser automation using Stagehand and local Chrome. Use this skill when the user needs to navigate websites, click elements, extract data, take screenshots, or perform multi-step web automation tasks. Provides natural language browser control with 10x better context efficiency than traditional DOM-based approaches. Ideal for web scraping, testing workflows, gathering online information, or any task requiring web interaction.
---

# Browser Automation Skill

## Overview

This skill provides Claude with autonomous browser automation capabilities through an interactive CLI powered by Stagehand AI and local Chrome. Unlike traditional browser automation that requires CSS selectors and DOM knowledge, this skill enables natural language commands like "click the login button" or "extract all product prices", resulting in 10x fewer tokens per interaction.

## When to Use This Skill

Use this skill when the user requests:
- **Web navigation**: "Go to Hacker News and show me the top post"
- **Data extraction**: "Find all the prices on this e-commerce page"
- **Form interaction**: "Fill out the contact form with my details"
- **Multi-step workflows**: "Search for Claude AI, go to the first result, and summarize the page"
- **Screenshots**: "Take a screenshot of the homepage"
- **Web research**: "Browse to this article and extract the key points"
- **Testing scenarios**: "Test the login flow on this website"

## How It Works

The skill combines three powerful technologies:

1. **Claude Agent SDK**: Provides reasoning and planning capabilities
2. **Stagehand**: AI browser automation framework that uses natural language instead of selectors
3. **Local Chrome**: Persistent browser with profile reuse for cookies and sessions

**Key Innovation**: Traditional approaches pass entire DOM structures (~500 tokens) to Claude. Stagehand handles the "how" of browser interactions using natural language (~50 tokens), while Claude focuses on the "what" - resulting in massive context savings.

## Available Browser Tools

Once the interactive session starts, Claude has access to these MCP tools:

### 1. `navigate`
Navigate to a URL and automatically take a screenshot.

**Example**: Navigate to https://news.ycombinator.com

### 2. `act`
Perform actions using natural language commands. Automatically takes screenshot after action.

**Examples**:
- "Click the login button"
- "Type 'Claude AI' into the search box"
- "Scroll down to the footer"
- "Click the first article link"

### 3. `extract`
Extract structured data from the page using natural language + schema.

**Example**: Extract product information with schema:
```json
{
  "name": "string",
  "price": "number",
  "inStock": "boolean"
}
```

### 4. `observe`
Discover elements on the page matching a natural language query.

**Example**: "Find all navigation links"

### 5. `screenshot`
Capture the current state of the page.

### 6. `close_browser`
Clean up and close the browser session.

## Setup Requirements

**Before using this skill for the first time:**

### 1. Install Dependencies
```bash
cd /Users/pkiv/browserbase/ceo/.claude/skills/browser/scripts/browser-cli
npm install
npm run build
```

### 2. Verify Chrome Installation
The skill requires Google Chrome to be installed on your system:
- **macOS**: Chrome at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
- **Windows**: Chrome in `Program Files` or `Program Files (x86)`
- **Linux**: Chrome at `/usr/bin/google-chrome` or Chromium as fallback

### 3. Set API Key
Ensure `ANTHROPIC_API_KEY` is available in your environment:
```bash
export ANTHROPIC_API_KEY=your_api_key_here
```

Or create a `.env` file in the browser-cli directory:
```
ANTHROPIC_API_KEY=your_api_key_here
```

### 4. First Run Setup
On first execution, the skill will:
- Copy your Chrome Default profile to `.chrome-profile/` (preserves cookies/sessions)
- Create `agent/` directory for screenshots and downloads
- This may take 30-60 seconds

## Usage

The browser skill provides command-based CLI tools that Claude Code can call during conversations:

### Available Commands

```bash
# Navigate to a URL (opens minimized, stays open)
npx browser navigate <url>

# Perform an action using natural language
npx browser act "<action>"

# Extract structured data from the current page
npx browser extract "<instruction>" '{"field": "type"}'

# Discover elements on the page
npx browser observe "<query>"

# Take a screenshot
npx browser screenshot

# Manually close the browser
npx browser close
```

### Browser Behavior

**Minimized Launch**: Chrome opens off-screen to avoid disrupting your workflow.

**Persistent Browser**: The browser stays open between commands for faster sequential operations and to preserve browser state (cookies, sessions, etc.).

**Reuse Existing**: If Chrome is already running on port 9222, it will reuse that instance.

**Safe Cleanup**: The browser only closes when you explicitly call `npx browser close`, or your existing Chrome windows remain untouched.

**Sequential Commands**: Chain multiple commands without reopening the browser:
```bash
npx browser navigate https://example.com
npx browser act "click the login button"
npx browser extract "get title" '{"title": "string"}'
npx browser close  # Explicitly close when done
```

### Example Usage

```bash
# Navigate to a pricing page
npx browser navigate https://www.browserbase.com/pricing

# Extract pricing information
npx browser extract "Extract all pricing tiers" '{"plans": "string"}'

# Perform an action
npx browser act "click the sign up button"

# Take a screenshot
npx browser screenshot
```

## File Structure Created

When you run the skill, it creates:

```
scripts/browser-cli/
├── .chrome-profile/          # Copied Chrome profile (cookies, sessions)
├── agent/
│   ├── browser_screenshots/  # Screenshots with timestamps
│   └── downloads/            # Browser downloads
└── ...
```

## Technical Details

- **Browser Mode**: Local Chrome with CDP (Chrome DevTools Protocol) on port 9222
- **Profile Persistence**: Reuses `.chrome-profile/` across sessions for logged-in states
- **Screenshot Management**: Auto-resized to 2000x2000 max using Sharp
- **Model for Actions**: Stagehand uses Claude Haiku 4.5 for fast, cost-effective DOM operations
- **Model for Reasoning**: Interactive session uses Claude Sonnet for planning
- **Session Limit**: 100 turns maximum per conversation

## Safety Features

- **File Write Protection**: Cannot write .js/.ts files outside designated directories
- **Graceful Cleanup**: SIGINT/SIGTERM handlers properly close browser
- **Error Handling**: All tools wrapped with try/catch for robust operation

## Resources

### scripts/browser-cli/
Complete TypeScript CLI implementation with:
- `src/cli.ts`: Main interactive conversation loop
- `src/stagehand-tools.ts`: MCP server exposing browser tools to Claude
- `src/browser-utils.ts`: Chrome management, profile copying, screenshots
- `package.json`: All dependencies (Agent SDK, Stagehand, Sharp, etc.)

## Troubleshooting

**"Chrome not found" error**: Install Google Chrome or update path in `browser-utils.ts`

**Profile copying is slow**: First run only. Subsequent runs reuse `.chrome-profile/`

**Port 9222 already in use**: Another Chrome debugging session is running. Close it or change port in `stagehand-tools.ts`

**ANTHROPIC_API_KEY not found**: Set environment variable or create `.env` file

## Context Efficiency Benefits

Traditional approach per interaction:
- DOM structure: ~500 tokens
- CSS selectors: Manual specification
- Error-prone: Selectors break on page changes

Stagehand approach per interaction:
- Natural language: ~50 tokens
- Intent-based: "click login button"
- Resilient: Adapts to page structure changes

**Result**: 10x reduction in context usage, enabling longer automation sessions.
