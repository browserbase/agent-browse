---
name: Browser Automation
description: Automate web browser interactions using natural language. Use when the user asks to browse websites, navigate web pages, extract data from websites, take screenshots, fill forms, click buttons, or interact with web applications. Triggers include "browse", "navigate to", "go to website", "extract data from webpage", "screenshot", "web scraping", "fill out form", "click on", "search for on the web". When taking actions be as specific as possible. 
allowed-tools: mcp__stagehand__navigate, mcp__stagehand__act, mcp__stagehand__extract, mcp__stagehand__observe, mcp__stagehand__screenshot, mcp__stagehand__close_browser
---

# Browser Automation

Automate browser interactions using Stagehand with Claude. This skill provides natural language control over a Chrome browser for navigation, interaction, data extraction, and screenshots.

## Prerequisites

The browser automation MCP server must be running. It uses a local Chrome installation and connects via Chrome DevTools Protocol (CDP) on port 9222.

## Available Operations

### Navigate to URLs
Use `mcp__stagehand__navigate` to load web pages.

**When to use**: Opening any website, loading a specific URL, going to a web page.

**Example requests**:
- "Navigate to https://example.com"
- "Go to google.com"
- "Open the GitHub homepage"

### Interact with Pages
Use `mcp__stagehand__act` for natural language actions on page elements.

**When to use**: Clicking buttons, filling forms, scrolling, selecting options, typing text.

**Example requests**:
- "Click the 'Sign In' button"
- "Fill in the email field with test@example.com"
- "Scroll down to the footer"
- "Select 'United States' from the country dropdown"
- "Type 'laptop' in the search box and press enter"

**IMPORTANT**
BE AS SPECIFIC AS POSSIBLE, DETAILS MAKE A WORLD OF DIFFERENCE

### Extract Data
Use `mcp__stagehand__extract` to get structured data from the page.

**When to use**: Scraping data, getting specific information, collecting structured content.

**Schema format**: Define fields as objects with field names as keys and types as values:
- `"string"` for text
- `"number"` for numeric values
- `"boolean"` for true/false values

**Example requests**:
- "Extract the product title, price, and availability"
- "Get all the article headlines and authors"
- "Scrape the table data from this page"

### Discover Elements
Use `mcp__stagehand__observe` to find available actions and elements on the page.

**When to use**: Understanding page structure, finding what's clickable, discovering form fields.

**Example requests**:
- "Find all clickable buttons on the page"
- "What form fields are available?"
- "Show me all the links in the navigation menu"

### Take Screenshots
Use `mcp__stagehand__screenshot` to capture the current page state.

**When to use**: Visual verification, documenting page state, debugging, creating records.

**Notes**:
- Screenshots are saved to `./agent/browser_screenshots/`
- Images larger than 2000x2000 pixels are automatically resized
- Filename includes timestamp for uniqueness

**Example requests**:
- "Take a screenshot of the current page"
- "Capture what's on screen"
- "Show me what the page looks like"

### Clean Up
Use `mcp__stagehand__close_browser` when finished with browser tasks.

**When to use**: After completing all browser interactions, to free up resources.

**Example requests**:
- "Close the browser"
- "Clean up and close Chrome"
- "We're done with the browser"

## Best Practices

1. **Always navigate first**: Before interacting with a page, navigate to the URL
2. **Use natural language**: Describe actions as you would instruct a human
3. **Extract with clear schemas**: Define field names and types explicitly
4. **Handle errors gracefully**: If an action fails, try using `observe` to understand the page better
5. **Close when done**: Always clean up browser resources after completing tasks
6. **Be specific**: Use precise selectors in natural language ("the blue Submit button" vs "the button")

## Common Patterns

### Simple browsing task
1. Navigate to URL
2. Perform actions (click, fill, scroll)
3. Take screenshot or extract data
4. Close browser

### Data extraction task
1. Navigate to URL
2. Wait for content to load (act: "wait for page to load")
3. Extract structured data with schema
4. Process the extracted JSON data
5. Close browser

### Multi-step interaction
1. Navigate to URL
2. Act: Fill in form fields
3. Act: Click submit button
4. Wait for results
5. Extract or screenshot results
6. Close browser

### Debugging workflow
1. Navigate to URL
2. Take screenshot (verify page loaded correctly)
3. Observe (find available elements)
4. Act on specific elements
5. Take screenshot (verify action succeeded)
6. Close browser

## Troubleshooting

**Page not loading**: Wait a few seconds after navigation before acting. You can explicitly act: "wait for the page to fully load"

**Element not found**: Use `observe` to discover what elements are actually available on the page

**Action fails**: Be more specific in natural language description. Instead of "click the button", try "click the blue Submit button in the form"

**Screenshots missing**: Check the `./agent/browser_screenshots/` directory for saved files

For detailed examples, see [EXAMPLES.md](EXAMPLES.md).
For API reference and technical details, see [REFERENCE.md](REFERENCE.md).
