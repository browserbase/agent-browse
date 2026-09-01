---
name: add-webmcp
description: Analyze an existing web application, identify safe user-visible capabilities across routes, forms, server actions, handlers, and schemas, then implement first-party WebMCP tools and validate discovery and invocation with Stagehand. Use when the user asks to make a codebase agent-ready, expose website features as WebMCP tools, or add WebMCP directly to an app rather than generating a standalone injection script from a URL.
compatibility: "Requires Node.js 22.18 or newer. Validation needs Chrome/Chromium locally or BROWSERBASE_API_KEY for a publicly reachable preview."
license: MIT
allowed-tools: Bash Read Grep Edit Write
---

# Add WebMCP

Turn capabilities already implemented by a web app into maintained, first-party WebMCP tools. Modify the target codebase and its tests; do not introduce a hosted proxy or third-party runtime.

Compatibility: the bundled Stagehand validator requires Node.js 22.18 or newer. Validation needs Chrome/Chromium locally or `BROWSERBASE_API_KEY` for a publicly reachable preview.

Use `webmcp-gen` instead when the requested output is a standalone init script derived from a live URL. This skill starts from source code and integrates tools into the application.

## 1. Establish the application boundary

Read the target repository's instructions, package manifests, framework configuration, and current git status. Preserve unrelated changes.

Set `ADD_WEBMCP_SKILL_DIR` to the directory containing this file and run the bounded scanner:

```bash
node "$ADD_WEBMCP_SKILL_DIR/scripts/scan-codebase.mjs" "$TARGET_REPO"
```

Treat scanner results as leads, not conclusions. In a monorepo, identify the actual browser app and the server packages it calls before editing.

## 2. Build a capability inventory

Trace each candidate from its user-visible entry point through the client handler, validation schema, server boundary, authorization checks, side effect, and returned state. Look at:

- routes and screens;
- forms and their submit handlers;
- server actions, API handlers, RPC procedures, and service clients;
- Zod, Valibot, Yup, Joi, JSON Schema, or equivalent validators;
- authentication, authorization, CSRF, idempotency, rate limits, and audit hooks.

Prefer complete user tasks such as `search_catalog` or `save_draft`, not a mechanical tool per endpoint. Exclude internal/admin-only operations, authentication bypasses, raw database access, secret-bearing operations, and capabilities the UI does not grant the current user.

For each selected tool, record its source files, existing validation and authorization boundary, side effects, risk class, confirmation behavior, and a safe fixture input. Read [references/implementation-and-validation.md](references/implementation-and-validation.md) for the detailed inventory and framework patterns.

## 3. Design the tool contract

- Use a stable verb-noun name and describe the user-visible effect, prerequisites, and important exclusions.
- Derive JSON Schema from the application's existing validator or domain type. Do not invent a second, looser contract. Close object schemas with `additionalProperties: false` and make the execute-time parser reject unknown fields too; a closed discovery schema backed by a permissive runtime parser is not a closed contract.
- Return compact JSON-serializable domain results. Do not return DOM nodes, credentials, cookies, tokens, or entire HTML documents.
- Call the same client/service boundary as the UI so existing validation, authorization, observability, and business rules remain authoritative.
- Validate again inside the handler. Agent-provided input is untrusted.

Assign annotations deliberately:

| Risk | Tool design | Annotation and confirmation behavior |
| --- | --- | --- |
| Read-only | No state mutation | Register `readOnlyHint: true`; add `untrustedContentHint: true` when output includes page or user-controlled text |
| Reversible mutation | Drafts, preferences, cart edits | Register `readOnlyHint: false`; preserve auth/idempotency; test only with disposable state |
| Consequential or irreversible | Purchase, send, publish, delete, permission changes | Split preview/prepare from commit where possible; do not add declarative `toolautosubmit`; keep the final action behind the app's real confirmation control |

Registration uses the current WebMCP hint names `readOnlyHint` and `untrustedContentHint`. Stagehand v4 normalizes discovered annotations to `readOnly`, `untrustedContent`, and, for declarative forms, `autosubmit`. These are hints to the browser or agent, not security enforcement. The application must enforce permissions, validation, confirmation, idempotency, and replay protection.

## 4. Integrate with the application

Use the runtime model context exposed by the browser:

```js
const modelContext = navigator.modelContext || document.modelContext;
```

Register imperative tools from a client-only root/provider after the application is ready. Keep registration lifecycle-safe across navigation and hot reload using the API behavior supported by the target browser. Use declarative form attributes when an existing form already represents the exact task and preserving a visible review step is valuable.

Do not duplicate server business logic in the tool executor. Do not weaken CSRF, same-origin, auth, or confirmation checks to make a smoke test pass. Never embed secrets in browser code.

## 5. Verify the implementation

Run the target's focused tests, typecheck, and production build. Then create a small `webmcp.e2e.json` with every expected tool. Discovery is mandatory; invocation is opt-in per test case and must use synthetic or disposable data.

Install the validator dependencies once:

```bash
pnpm --dir "$ADD_WEBMCP_SKILL_DIR" install --frozen-lockfile
```

Validate localhost with a Stagehand-launched local browser:

```bash
node "$ADD_WEBMCP_SKILL_DIR/scripts/validate-stagehand.mjs" \
  --url http://127.0.0.1:3000 \
  --config "$TARGET_REPO/webmcp.e2e.json" \
  --local
```

Use `--browserbase` only for a publicly reachable deployed preview. The validator uses Stagehand v4's real `page.tools()`, `tool.invoke()`, and `invocation.result()` path. It refuses consequential invocations unless `--allow-consequential` is explicitly supplied.

An injected init script is useful for testing the validator itself, but it is not proof that the target app ships its own tools. Final application proof must run without `--init-script`.

## 6. Report the result

List the capabilities considered and explain exclusions. For each implemented tool, report its contract, backing code path, risk/confirmation treatment, and actual Stagehand discovery/invocation result. State any environment or browser support not tested.

For a comparative benchmark, quality audit, or scored evaluation, read [references/quality-rubric.md](references/quality-rubric.md). Apply its qualification gates before reporting numerical scores; do not let a high diagnostic score hide fabricated behavior, an unsafe consequence boundary, or missing production discovery.
