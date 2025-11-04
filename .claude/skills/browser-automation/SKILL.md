---
name: Browser Automation
description: Automate web browser interactions using natural language via CLI commands. Use when the user asks to browse websites, navigate web pages, extract data from websites, take screenshots, fill forms, click buttons, or interact with web applications. Triggers include "browse", "navigate to", "go to website", "extract data from webpage", "screenshot", "web scraping", "fill out form", "click on", "search for on the web". When taking actions be as specific as possible.
allowed-tools: Bash
---

# Browser Automation

Automate browser interactions using Stagehand CLI with Claude. This skill provides natural language control over a Chrome browser through command-line tools for navigation, interaction, data extraction, and screenshots.

## Overview

This skill uses a CLI-based approach where Claude Code calls browser automation commands via bash. The browser stays open between commands for faster sequential operations and preserves browser state (cookies, sessions, etc.).

## Prerequisites

- Google Chrome installed on your system
- Node.js and dependencies installed (`pnpm install`)
- Project built (`pnpm build` or `tsx` for running TypeScript directly)

## Available Commands

### Navigate to URLs
```bash
tsx src/cli.ts navigate <url>
```

**When to use**: Opening any website, loading a specific URL, going to a web page.

**Example usage**:
- `tsx src/cli.ts navigate https://example.com`
- `tsx src/cli.ts navigate https://news.ycombinator.com`

**Output**: JSON with success status, message, and screenshot path

### Interact with Pages
```bash
tsx src/cli.ts act "<action>"
```

**When to use**: Clicking buttons, filling forms, scrolling, selecting options, typing text.

**Example usage**:
- `tsx src/cli.ts act "click the Sign In button"`
- `tsx src/cli.ts act "fill in the email field with test@example.com"`
- `tsx src/cli.ts act "scroll down to the footer"`
- `tsx src/cli.ts act "type 'laptop' in the search box and press enter"`

**Important**: Be as specific as possible - details make a world of difference. When filling fields, you don't need to combine 'click and type'; the tool will perform a fill similar to Playwright's fill function.

**Output**: JSON with success status, message, and screenshot path

### Extract Data
```bash
tsx src/cli.ts extract "<instruction>" '{"field": "type"}'
```

**When to use**: Scraping data, getting specific information, collecting structured content.

**Schema format**: JSON object where keys are field names and values are types:
- `"string"` for text
- `"number"` for numeric values
- `"boolean"` for true/false values

**Example usage**:
- `tsx src/cli.ts extract "get the product title and price" '{"title": "string", "price": "number"}'`
- `tsx src/cli.ts extract "get all article headlines" '{"headlines": "string"}'`

**Output**: JSON with success status, extracted data, and screenshot path

### Discover Elements
```bash
tsx src/cli.ts observe "<query>"
```

**When to use**: Understanding page structure, finding what's clickable, discovering form fields.

**Example usage**:
- `tsx src/cli.ts observe "find all clickable buttons"`
- `tsx src/cli.ts observe "find all form fields"`
- `tsx src/cli.ts observe "find all navigation links"`

**Output**: JSON with success status, discovered elements, and screenshot path

### Take Screenshots
```bash
tsx src/cli.ts screenshot
```

**When to use**: Visual verification, documenting page state, debugging, creating records.

**Notes**:
- Screenshots are saved to `./agent/browser_screenshots/`
- Images larger than 2000x2000 pixels are automatically resized
- Filename includes timestamp for uniqueness

**Output**: JSON with success status and screenshot path

### Clean Up
```bash
tsx src/cli.ts close
```

**When to use**: After completing all browser interactions, to free up resources.

**Output**: JSON with success status and message

## Browser Behavior

**Persistent Browser**: The browser stays open between commands for faster sequential operations and to preserve browser state (cookies, sessions, etc.).

**Reuse Existing**: If Chrome is already running on port 9222, it will reuse that instance.

**Minimized Launch**: Chrome opens off-screen (position -9999,-9999) to avoid disrupting workflow.

**Safe Cleanup**: The browser only closes when you explicitly call the `close` command.

## Best Practices

1. **Always navigate first**: Before interacting with a page, navigate to the URL
2. **📸 Always view screenshots**: After each command (navigate, act, extract, observe), use the Read tool to view the screenshot and verify the command worked correctly
3. **Use natural language**: Describe actions as you would instruct a human
4. **Extract with clear schemas**: Define field names and types explicitly in JSON
5. **Handle errors gracefully**: Check the `success` field in JSON output; if an action fails, view the screenshot and try using `observe` to understand the page better
6. **Close when done**: Always clean up browser resources after completing tasks
7. **Be specific**: Use precise selectors in natural language ("the blue Submit button" vs "the button")
8. **Chain commands**: Run multiple commands sequentially without reopening the browser

## Common Patterns

### Simple browsing task
```bash
tsx src/cli.ts navigate https://example.com
tsx src/cli.ts act "click the login button"
tsx src/cli.ts screenshot
tsx src/cli.ts close
```

### Data extraction task
```bash
tsx src/cli.ts navigate https://example.com/products
tsx src/cli.ts act "wait for page to load"
tsx src/cli.ts extract "get all products" '{"name": "string", "price": "number"}'
tsx src/cli.ts close
```

### Multi-step interaction
```bash
tsx src/cli.ts navigate https://example.com/login
tsx src/cli.ts act "fill in email with user@example.com"
tsx src/cli.ts act "fill in password with mypassword"
tsx src/cli.ts act "click the submit button"
tsx src/cli.ts screenshot
tsx src/cli.ts close
```

### Debugging workflow
```bash
tsx src/cli.ts navigate https://example.com
tsx src/cli.ts screenshot
tsx src/cli.ts observe "find all buttons"
tsx src/cli.ts act "click the specific button"
tsx src/cli.ts screenshot
tsx src/cli.ts close
```

## Troubleshooting

**Page not loading**: Wait a few seconds after navigation before acting. You can explicitly: `tsx src/cli.ts act "wait for the page to fully load"`

**Element not found**: Use `observe` to discover what elements are actually available on the page

**Action fails**: Be more specific in natural language description. Instead of "click the button", try "click the blue Submit button in the form"

**Screenshots missing**: Check the `./agent/browser_screenshots/` directory for saved files

**Chrome not found**: Install Google Chrome or the CLI will show an error with installation instructions

**Port 9222 in use**: Another Chrome debugging session is running. Close it or wait for timeout

For detailed examples, see [EXAMPLES.md](EXAMPLES.md).
For API reference and technical details, see [REFERENCE.md](REFERENCE.md).
