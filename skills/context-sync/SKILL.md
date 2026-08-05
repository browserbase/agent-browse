---
name: context-sync
description: Sync durable state from a local Chromium profile into a Browserbase Context, including cookies, localStorage, IndexedDB, Cache Storage, service workers, bookmarks, history, preferences, and extension data. Use when a user wants a cloud browser to retain more than cookies or asks to copy, migrate, upload, or refresh their local Chrome profile in Browserbase.
license: MIT
allowed-tools: Bash
---

# Context Sync — Local Chrome → Browserbase Context

Copy a selected local Chromium profile into a Browserbase Context. Use the bundled script; do not manually copy individual storage APIs.

## Safety contract

- Explain that the profile can contain authenticated sessions and sensitive browsing data.
- Ask before closing Chrome. Use `--close-browser` only after the user agrees.
- Prefer a dedicated Chrome profile over a personal primary profile.
- Never print cookie values, storage contents, the encrypted archive, or the signed upload URL.
- Do not claim that open tabs, live DOM/JavaScript state, back-forward stacks, active connections, saved passwords, or `sessionStorage` will resume.

## Setup

```bash
cd .claude/skills/context-sync
npm install
export BROWSERBASE_API_KEY="..."
```

Enable remote debugging in Chrome and restart it. If automatic discovery is unavailable, set `CDP_URL` and pass `--user-data-dir`.

## Run

First show what will be included without uploading:

```bash
node .claude/skills/context-sync/scripts/context-sync.mjs --dry-run --profile Default
```

For a consistent snapshot, get permission to close Chrome, then run:

```bash
node .claude/skills/context-sync/scripts/context-sync.mjs --close-browser --profile Default
```

The command exports cookies over CDP, closes Chrome, archives the selected profile as Browserbase's `Default` profile, encrypts and uploads it, starts a persistent Browserbase session, injects the portable cookie values, and prints the Context ID.

Use another local profile with `--profile "Profile 1"`. If `CDP_URL` is set explicitly, also pass `--user-data-dir "/path/to/User Data"`.

Refresh a Context only when custom Context uploads are enabled for the project:

```bash
node .claude/skills/context-sync/scripts/context-sync.mjs --context <context-id> --close-browser
```

If the update API reports that uploads are unavailable, create a new Context by omitting `--context`.

## Use the Context

```bash
SESSION_JSON="$(browse cloud sessions create --context-id <context-id> --persist --keep-alive)"
SESSION_ID="$(echo "$SESSION_JSON" | jq -r .id)"
CONNECT_URL="$(echo "$SESSION_JSON" | jq -r .connectUrl)"
browse open https://example.com --cdp "$CONNECT_URL"
# When done:
browse stop
browse cloud sessions update "$SESSION_ID" --status REQUEST_RELEASE
```

Always use `--persist` when changes made in cloud sessions should flow back into the Context.

## Alternative for a running browser

`--allow-live-copy` avoids closing Chrome but can capture inconsistent SQLite or LevelDB files. Use it only when the user explicitly accepts that risk. Prefer `--close-browser`.

Read [references/state-matrix.md](references/state-matrix.md) before making claims about what survives. Read [references/implementation.md](references/implementation.md) when debugging uploads, encryption, profile discovery, or cross-platform behavior.
