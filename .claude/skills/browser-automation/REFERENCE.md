# Browser Automation API Reference

This document provides detailed technical reference for the Stagehand browser automation tools.

## Architecture Overview

The browser automation system consists of:

- **Stagehand**: TypeScript library wrapping Playwright for AI-driven browser control. Uses another model to choose to find and interact with the right elements, so be specific
- **Chrome CDP**: Chrome DevTools Protocol connection on port 9222
- **MCP Server**: Model Context Protocol server exposing tools to Claude
- **Local Chrome**: Chrome browser launched with remote debugging enabled

### File Locations

- **Chrome Profile**: `.chrome-profile/` - Persistent browser profile directory
- **Screenshots**: `./agent/browser_screenshots/` - Screenshot output directory
- **Downloads**: `./agent/downloads/` - File download directory

## Tool Reference

### mcp__stagehand__navigate

Navigate to a URL in the browser.

**Parameters**:
- `url` (string, required): The URL to navigate to. Must include protocol (http:// or https://)

**Returns**:
- Success message with the navigated URL
- Error message if navigation fails

**Implementation Details**:
- Uses Playwright's `page.goto()` under the hood
- Waits for network idle and DOM content loaded
- Supports HTTPS upgrade for HTTP URLs

**Example**:
```javascript
{
  "url": "https://example.com"
}
```

**Error Handling**:
- Invalid URLs return error message
- Network timeouts return timeout error
- SSL certificate errors may fail navigation

---

### mcp__stagehand__act

Perform an action on the page using natural language.

**Parameters**:
- `action` (string, required): Natural language description of the action to perform

**Returns**:
- Success message confirming action performed, but without specificity it might be succeeding on the wrong element!
- Error message if action fails (locator doesn't resolve. )

**Implementation Details**:
- Uses Stagehand's `page.act()` which leverages Claude Sonnet 4.5
- AI model interprets natural language and executes corresponding browser actions
- Supports: clicking, typing, selecting, scrolling, waiting, hovering, and more
- Automatically handles element location and interaction

**Natural Language Examples**:
```
"Click the login button"
"Fill in email field with test@example.com"
"Scroll to the bottom of the page"
"Select 'California' from the state dropdown"
"Hover over the menu icon"
"Wait for 3 seconds"
"Press the Enter key"
"Double-click the file icon"
```

**Best Practices**:
- Be **specific** about which element to interact with
- Include visual descriptors ("button next to the form", "top menu", "form at bottom")
- For ambiguous elements, mention nearby context
- Break complex actions into multiple simple actions

**Error Handling**:
- Element not found errors indicate selector couldn't be resolved
- Timeout errors occur when action takes too long
- Action not possible errors indicate element state prevents action

---

### mcp__stagehand__extract

Extract structured data from the current page using a schema.

**Parameters**:
- `instruction` (string, required): Natural language description of what to extract
- `schema` (object, required): Schema definition mapping field names to types

**Schema Types**:
- `"string"`: Text content
- `"number"`: Numeric values (integers or floats)
- `"boolean"`: True/false values

**Returns**:
- JSON object matching the provided schema
- Error message if extraction fails

**Implementation Details**:
- Uses Stagehand's `page.extract()` with Zod schema validation
- AI model (Claude Sonnet 4.5) identifies relevant page elements
- Automatically handles pagination and dynamic content
- Validates extracted data against schema

**Schema Example**:
```javascript
{
  "instruction": "Extract the product information",
  "schema": {
    "productName": "string",
    "price": "number",
    "inStock": "boolean",
    "description": "string",
    "rating": "number"
  }
}
```

**Complex Extraction Example**:
```javascript
{
  "instruction": "Extract all items from the shopping cart",
  "schema": {
    "itemName": "string",
    "quantity": "number",
    "unitPrice": "number",
    "totalPrice": "number",
    "imageUrl": "string"
  }
}
```

**Best Practices**:
- Use clear, descriptive field names
- Match schema types to expected data types
- Provide specific extraction instructions
- Handle missing data by checking result properties

**Error Handling**:
- Schema validation errors indicate type mismatch
- Extraction failures occur when data not found on page
- Timeout errors for pages that take too long to analyze

---

### mcp__stagehand__observe

Discover available actions on the page.

**Parameters**:
- `query` (string, required): Natural language query to discover elements

**Returns**:
- JSON array of discovered elements with metadata
- Error message if observation fails

**Implementation Details**:
- Uses Stagehand's `page.observe()` to scan page elements
- Returns actionable elements matching the query
- Provides element properties, states, and available actions

**Query Examples**:
```
"Find all buttons"
"Find clickable links in the navigation"
"Find form input fields"
"Find all submit buttons"
"Find elements with text 'Login'"
"Find all images"
```

**Response Format**:
```javascript
[
  {
    "selector": "button.submit-btn",
    "text": "Submit Form",
    "type": "button",
    "visible": true,
    "enabled": true
  },
  // ... more elements
]
```

**Use Cases**:
- Page exploration and discovery
- Debugging action failures
- Understanding page structure
- Finding dynamic element selectors

**Error Handling**:
- Empty array returned when no elements match
- Timeout for pages that take too long to scan

---

### mcp__stagehand__screenshot

Take a screenshot of the current page.

**Parameters**: None

**Returns**:
- Success message with screenshot file path
- Error message if screenshot fails

**Implementation Details**:
- Uses Chrome DevTools Protocol `Page.captureScreenshot`
- Captures full viewport at current scroll position
- Saves as PNG format with timestamp in filename
- Automatically resizes images larger than 2000x2000 pixels using Sharp
- Uses lossless PNG compression

**Screenshot Path Format**:
```
./agent/browser_screenshots/screenshot-YYYY-MM-DDTHH-MM-SS-mmmZ.png
```

**Example Output**:
```
Screenshot saved to /Users/.../agent-browse/agent/browser_screenshots/screenshot-2025-10-17T14-30-45-123Z.png
```

**Image Processing**:
- Original resolution preserved if ≤ 2000x2000
- Larger images resized to fit within 2000x2000 while maintaining aspect ratio
- Uses Sharp library for high-quality image processing

**Best Practices**:
- Take screenshots before and after important actions
- Use for visual debugging and verification
- Screenshot after navigation to confirm page loaded
- Capture error states for troubleshooting

**Error Handling**:
- Directory creation errors if screenshots folder can't be created
- CDP errors if Chrome DevTools Protocol connection fails
- File write errors if disk space insufficient

---

### mcp__stagehand__close_browser

Close the browser and cleanup resources.

**Parameters**: None

**Returns**:
- Success message confirming browser closed
- Error message if cleanup fails

**Implementation Details**:
- Calls `stagehand.close()` to clean up Playwright resources
- Kills Chrome process with `chromeProcess.kill()`
- Clears internal state variables
- Does NOT delete `.chrome-profile/` directory (preserved for reuse)

**Resource Cleanup**:
- Closes all browser tabs and windows
- Terminates Chrome process
- Releases CDP connection
- Clears Stagehand instance

**Best Practices**:
- Always call at the end of browser automation tasks
- Call even if errors occurred during automation
- Don't call mid-workflow unless explicitly needed

**Error Handling**:
- Continues cleanup even if some steps fail
- Safe to call multiple times
- Gracefully handles already-closed browser

---

## Configuration Details

### Stagehand Initialization

The Stagehand instance is configured with:

```typescript
new Stagehand({
  env: "LOCAL",
  verbose: 0,
  enableCaching: true,
  modelName: "anthropic/claude-sonnet-4-5-20250929",
  localBrowserLaunchOptions: {
    cdpUrl: `http://localhost:9222`,
  },
})
```

**Configuration Options**:
- `env: "LOCAL"`: Uses local Chrome instead of remote browser
- `verbose: 0`: Minimal logging output
- `enableCaching: true`: Caches page analysis for better performance
- `modelName`: Claude Sonnet 4.5 for AI-driven actions and extraction
- `cdpUrl`: Chrome DevTools Protocol endpoint

### Chrome Launch Arguments

Chrome is launched with:

```bash
--remote-debugging-port=9222
--user-data-dir=.chrome-profile
```

**Arguments**:
- `--remote-debugging-port`: Enables CDP on port 9222
- `--user-data-dir`: Persistent profile directory for session/cookie persistence

### Download Configuration

Downloads are configured via CDP:

```typescript
await client.send("Browser.setDownloadBehavior", {
  behavior: "allow",
  downloadPath: "./agent/downloads",
  eventsEnabled: true,
})
```

**Behavior**:
- Downloads start automatically (no dialog)
- Files saved to `./agent/downloads/`
- Download events can be monitored via CDP

---

## Error Messages Reference

### Common Errors

**"Could not find local Chrome installation"**
- Cause: Chrome/Chromium not installed or not in standard locations
- Solution: Install Chrome from https://www.google.com/chrome/

**"Chrome failed to start with remote debugging on port 9222"**
- Cause: Port 9222 already in use or Chrome can't bind to port
- Solution: Close other Chrome instances or change CDP port

**"Browser failed to become ready within timeout"**
- Cause: Chrome launched but page context not ready
- Solution: Check Chrome version compatibility, restart system

**"Error performing action: element not found"**
- Cause: Natural language description didn't match any page element
- Solution: Use more specific description or use observe to find elements

**"Error extracting data: schema validation failed"**
- Cause: Extracted data type doesn't match schema
- Solution: Verify schema types match actual page data

**"Error taking screenshot: directory not writable"**
- Cause: Insufficient permissions for screenshots directory
- Solution: Check file permissions on `./agent/browser_screenshots/`

---

## Performance Considerations

### Caching

Stagehand caches page analysis to improve performance on repeated actions. Cache is maintained for:
- Element selectors
- Page structure analysis
- Vision model results

### Timeouts

Default timeouts:
- Navigation: 30 seconds
- Action execution: 30 seconds
- Extraction: 60 seconds
- CDP connection: 15 seconds (50 retries × 300ms)

### Resource Usage

Browser automation consumes:
- Memory: ~200-500MB for Chrome process
- CPU: Variable based on page complexity
- Disk: ~50-200MB for Chrome profile
- Network: Depends on pages visited

---

## Security Considerations

### Credential Handling

- Browser uses persistent profile (`.chrome-profile/`)
- Saved passwords and cookies persist between sessions
- Consider using isolated profiles for sensitive operations

### Download Safety

- Downloads automatically saved to `./agent/downloads/`
- No file type restrictions enforced
- Verify downloaded file integrity before use

### Network Access

- Browser has full network access
- Respects system proxy settings
- Can access localhost and internal networks

---

## Debugging Tips

### Enable Verbose Logging

Uncomment debug logs in `stagehand-tools.ts`:

```typescript
// Change verbose: 0 to verbose: 1 or 2
verbose: 2,  // Maximum verbosity
```

### View Chrome Console

Connect to Chrome DevTools manually:
1. Open Chrome
2. Navigate to `chrome://inspect`
3. Click "inspect" under Remote Target

### Check CDP Connection

Test CDP endpoint:
```bash
curl http://localhost:9222/json/version
```

### Monitor Browser Process

Check Chrome process:
```bash
ps aux | grep chrome
```

### View Screenshots

Screenshots provide visual debugging:
```bash
ls -lh ./agent/browser_screenshots/
open ./agent/browser_screenshots/screenshot-*.png
```

---

## Version Information

- **Stagehand**: Uses `@browserbasehq/stagehand` package
- **Model**: Claude Sonnet 4.5 (claude-sonnet-4-5-20250929)
- **MCP SDK**: `@anthropic-ai/claude-agent-sdk`
- **Browser**: Local Chrome/Chromium installation

For updates and changelog, see the main project repository.
