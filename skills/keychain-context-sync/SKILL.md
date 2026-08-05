---
name: keychain-context-sync
description: Read Chrome cookies directly from a macOS profile database using user-approved Keychain access, without CDP, and prepare them for a Browserbase Context import. Use when a user asks for offline or at-rest Chrome cookie access, a Chrome Safe Storage consent flow, or Keychain-based profile migration to Browserbase.
license: MIT
allowed-tools: Bash
---

# Keychain Context Sync

Use the bundled extractor to validate macOS at-rest cookie access before enabling any Browserbase upload.

## Safety

- Explain that cookie values are authentication credentials.
- Ask before triggering the macOS Keychain dialog.
- Let macOS collect the login password; never request, read, or log it.
- Never print cookie values, names, domains, the Safe Storage secret, or decrypted JSON.
- Start with `--inspect-only`. Keep upload disabled during interactive testing.
- Prefer closing Chrome before reading its databases. The script creates a read-only SQLite backup when Chrome remains open.

## Inspect

```bash
node scripts/chrome-keychain-cookies.mjs \
  --profile-dir "$HOME/Library/Application Support/Google/Chrome/Default" \
  --inspect-only
```

macOS displays a consent dialog for `Chrome Safe Storage`. The displayed requester is the signed process responsible for the command. A terminal script may show Terminal, Codex, Node, or `security`; Browserbase branding requires a signed macOS helper application.

The command prints counts only: database rows, successful decryptions, plaintext rows, and failures. Treat any failure count as a compatibility issue and do not upload.

## Validate

```bash
node --test scripts/chrome-keychain-cookies.test.mjs
node --check scripts/chrome-keychain-cookies.mjs
```

Read [references/chrome-crypto.md](references/chrome-crypto.md) before changing cryptography or supporting another browser/platform.

## Upload boundary

Do not copy the raw macOS `Cookies` database into Browserbase. Its encrypted values are bound to the source Keychain. A future upload command must keep decrypted cookies in memory, create/upload the non-credential profile archive, inject cookies into a persistent Browserbase session, and then clear temporary material.
