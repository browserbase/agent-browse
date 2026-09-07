# Browserbase Skills

A set of skills for enabling **[Claude Code](https://docs.claude.com/en/docs/claude-code/overview)** to work with Browserbase through browser automation and the official `browse` CLI.

## Skills

This repo contains the following skills (see `skills/` for details). Every skill installs with `npx skills add`; the six that also have a Claude Code marketplace plugin show that as an alternative. See [Installation](#installation) for details.

| Skill | Description | Install |
|-------|-------------|---------|
| [browser](skills/browser/SKILL.md) | Automate web browser interactions via CLI commands — supports remote Browserbase sessions with Browserbase Identity, Verified browsers, CAPTCHA solving, and residential proxies | `npx skills add browserbase/skills --skill browser`<br>or `/plugin install browse@browserbase` |
| [functions](skills/functions/SKILL.md) | Deploy serverless browser automation to Browserbase cloud using the `browse` CLI | `npx skills add browserbase/skills --skill functions`<br>or `/plugin install functions@browserbase` |
| [browser-trace](skills/browser-trace/SKILL.md) | Capture a full DevTools-protocol trace (CDP firehose, screenshots, DOM dumps) alongside any browser automation, then bisect the stream into per-page searchable buckets | `npx skills add browserbase/skills --skill browser-trace`<br>or `/plugin install browser-trace@browserbase` |
| [browser-to-api](skills/browser-to-api/SKILL.md) | Turn a website's observable HTTP traffic into a best-effort OpenAPI 3.1 spec by analyzing a `browser-trace` capture | `npx skills add browserbase/skills --skill browser-to-api` |
| [autobrowse](skills/autobrowse/SKILL.md) | Self-improving browser automation — iteratively runs a browsing task, reads the trace, and improves the navigation skill until it reliably passes | `npx skills add browserbase/skills --skill autobrowse` |
| [optimize-agent-prompt](skills/optimize-agent-prompt/SKILL.md) | Optimize Browserbase Agent API system prompts through repeated runs, Agent message traces, session logs, scoring, and unchanged confirmation runs | `npx skills add browserbase/skills --skill optimize-agent-prompt` |
| [safe-browser](skills/safe-browser/SKILL.md) | Build local Claude Agent SDK browser agents whose only browser capability is a CDP-gated `safe_browser` tool with domain allowlist enforcement | `npx skills add browserbase/skills --skill safe-browser`<br>or `/plugin install safe-browser@browserbase` |
| [webmcp-gen](skills/webmcp-gen/SKILL.md) | Author, compile, and validate site-specific WebMCP init scripts with the Stagehand WebMCP runtime | `npx skills add browserbase/skills --skill webmcp-gen`<br>or `/plugin install webmcp-gen@browserbase` |
| [add-webmcp](skills/add-webmcp/SKILL.md) | Analyze an existing web app, add first-party WebMCP tools backed by its routes, forms, actions, and schemas, and validate them through Stagehand | `npx skills add browserbase/skills --skill add-webmcp`<br>or `/plugin install add-webmcp@browserbase` |
| [cookie-sync](skills/cookie-sync/SKILL.md) | Sync cookies from local Chrome to a Browserbase persistent context so the browse CLI can access authenticated sites | `npx skills add browserbase/skills --skill cookie-sync` |
| [fetch](skills/fetch/SKILL.md) | Fetch HTML or JSON from static pages without a browser session — inspect status codes, headers, follow redirects | `npx skills add browserbase/skills --skill fetch` |
| [search](skills/search/SKILL.md) | Search the web and return structured results (titles, URLs, metadata) without a browser session | `npx skills add browserbase/skills --skill search` |
| [ui-test](skills/ui-test/SKILL.md) | AI-powered adversarial UI testing — analyzes git diffs to test changes, or explores the full app to find bugs | `npx skills add browserbase/skills --skill ui-test` |
| [browser-use-to-stagehand](skills/browser-use-to-stagehand/SKILL.md) | Migrate browser-use (Python) automation to Stagehand v3 (TypeScript) on Browserbase — maps features and picks the right determinism level per step | `npx skills add browserbase/skills --skill browser-use-to-stagehand` |
| [agent-experience](skills/agent-experience/SKILL.md) | Audit how agent-friendly a product, SDK, or docs site is — drops Claude subagents at it with tiny prompts, captures their traces, and scores setup friction, speed, error recovery, and doc quality | `npx skills add browserbase/skills --skill agent-experience` |
| [company-research](skills/company-research/SKILL.md) | Discover target companies matching your ICP using the Browserbase Search API, deep-research each one, and score fit into a research report and CSV | `npx skills add browserbase/skills --skill company-research` |
| [event-prospecting](skills/event-prospecting/SKILL.md) | Extract speakers from a conference page, filter their companies against your ICP, and deep-research the best-fit people into a person-first prospecting report | `npx skills add browserbase/skills --skill event-prospecting` |
| [competitor-analysis](skills/competitor-analysis/SKILL.md) | Auto-discover a company's competitors via the Browserbase Search API, deep-research each across marketing, signal, benchmark, and strategic-diff lanes, and compile a browsable HTML report with an overview, per-competitor deep dives, a feature/pricing matrix, and a mentions feed | `npx skills add browserbase/skills --skill competitor-analysis` |

## Installation

There are two ways to install, and they cover different sets of skills.

### Any coding agent: `npx skills add` (all skills)

Installs every skill in this repo into the agents it detects (Claude Code, Codex, Cursor, and others):

```bash
$ npx skills add browserbase/skills
```

To install a single skill, pass `--skill`:

```bash
$ npx skills add browserbase/skills --skill ui-test
```

### Claude Code plugin marketplace (subset of skills)

The Claude Code marketplace exposes only the six skills whose Install cell in the table above also lists a `/plugin install` command: `browse`, `functions`, `browser-trace`, `safe-browser`, `webmcp-gen`, and `add-webmcp`. Skills without a plugin (for example `ui-test`, `cookie-sync`, `company-research`) are not available this way; use `npx skills add` for those.

To add the marketplace:

```bash
/plugin marketplace add browserbase/skills
```

Then install a plugin, for example `browse`:

```bash
/plugin install browse@browserbase
```

If you prefer the manual interface:
1. On Claude Code, type `/plugin`
2. Select option `3. Add marketplace`
3. Enter the marketplace source: `browserbase/skills`
4. Select the plugin you want (for example `browse`)
5. Hit enter again to `Install now`
6. **Restart Claude Code** for changes to take effect

## Usage

Once installed, you can ask Claude to browse or use the Browserbase CLI:
- *"Go to Hacker News, get the top post comments, and summarize them "*
- *"QA test http://localhost:3000 and fix any bugs you encounter"*
- *"Order me a pizza, you're already signed in on Doordash"*
- *"Use `browse` to list my Browserbase projects and show the output as JSON"*
- *"Initialize a new Browserbase Function with `browse functions init` and explain the next commands"*
- *"Use safe-browser to build a Hacker News scraper that only stays on the main site"*

Claude will handle the rest.

For local and localhost work, pass `--local` on the first browser command (for example, `browse open http://localhost:3000 --local`) to start a clean isolated browser. Use `--auto-connect` when the agent should reuse your existing local Chrome session, cookies, or login state.

## Troubleshooting

### Chrome not found

Install Chrome for your platform:
- **macOS** or **Windows**: https://www.google.com/chrome/
- **Linux**: `sudo apt install google-chrome-stable`

### Profile refresh

To refresh cookies from your main Chrome profile:
```bash
rm -rf .chrome-profile
```

## Resources

- [Stagehand Documentation](https://github.com/browserbase/stagehand)
- [Claude Code Skills](https://support.claude.com/en/articles/12512176-what-are-skills)
