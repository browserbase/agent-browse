---
name: playwright-healer
description: Repair existing TypeScript or Python Playwright automations by running the real workflow on Browserbase, using browser-trace artifacts to investigate failures, and iterating until the repaired code passes. Use when a Playwright script, locator, navigation, extraction, assertion, or multi-step browser workflow is broken or flaky and the user wants the current coding agent to diagnose, edit, retry, verify, and optionally propose a pull request.
compatibility: "Requires an existing Playwright command, BROWSERBASE_API_KEY, the browse CLI with `browse cdp`, and the browser-trace skill. The Playwright entry point must accept BROWSERBASE_CONNECT_URL for traced remote runs."
license: MIT
allowed-tools: Bash, Read, Write, Edit, Grep
---

# Playwright Healer

Act as the coding agent. Repair the customer's existing Playwright code directly. Do not start another coding or browser agent, replace Playwright with a different driver, or stop after the first plausible edit.

Use the companion `browser-trace` skill to observe the same Browserbase session driven by the real Playwright command. Treat its CDP firehose, errors, network events, screenshots, and DOM snapshots as evidence; the Playwright command and its business assertions remain the success criterion.

## Required context

Obtain the intended outcome, failing entry point, exact test command, observed error, replay safety, and publication permission. Treat the named script as the starting point rather than an edit boundary; shared fixtures, page objects, and helpers may also require repair.

For traced Browserbase runs, require the actual entry point to use `BROWSERBASE_CONNECT_URL` with `connectOverCDP` or `connect_over_cdp`. If it does not, add the smallest reusable conditional connection branch without changing its normal runtime behavior.

## Recovery loop

1. Read the failing code, dependencies, configuration, and assertions.
2. Reproduce the failure when replay is safe. Preserve its exception and process output.
3. When browser evidence would reduce uncertainty, follow `browser-trace` to create a fresh keep-alive Browserbase session and start capture.
4. Run the real Playwright command against that captured session. Always stop, bisect, and finalize the trace, even after a crash.
5. Inspect only relevant evidence: page summaries, exceptions, console errors, failed requests, navigation sequence, nearby screenshots, and DOM snapshots.
6. Make the smallest durable repair supported by the code and evidence.
7. Rerun the exact command. Treat each new failure as evidence and continue in the same context.

Do not weaken assertions merely to obtain a zero exit code. Never replay irreversible production behavior without explicit authorization. Do not commit trace artifacts or credentials.

## Completion gates

Require both after the final edit:

1. The customer's normal command exits successfully and proves the intended business outcome.
2. A fresh `browser-trace` Browserbase capture runs the actual repaired entry point in that session and the command's assertions pass.

If authorized, stage only repair-related files and open a draft pull request. Otherwise leave the diff for review. Report changed files, both command results, final Browserbase session ID, trace directory, relevant evidence, remaining risks, and pull-request URL when applicable.
