# Browserbase Function deployment shape

Read this only when asked to package or deploy the workflow as a Browserbase
Function.

## Recommended boundary

Keep the first deployed version split across two runtimes:

```text
Caller / agent skill
  |-- Ramp CLI: resolve target transaction
  |-- Browserbase Function: find + download exact vendor receipt
  |     `-- returns Browserbase session ID + matched order evidence
  |-- Browse CLI: retrieve the session download archive
  `-- Ramp CLI: dry-run, attach, and verify
```

Why this boundary exists:

- A Browserbase Function automatically receives a Browserbase session, but the
  native `ramp` binary is not documented as preinstalled in the Function runtime.
- Standalone Ramp authentication uses a Client ID and Client secret to obtain an
  expiring agent token. Do not copy the secret or token into function parameters
  or source code, and do not fall back to a human OAuth session.
- Browserbase's public Functions documentation currently says Function Secrets
  are coming soon. Re-check the current official docs before claiming or using
  that feature; never pass vendor passwords or Ramp tokens in invocation params.
- Function filesystem state is not persistent, unique, or guaranteed to be
  cleared between invocations. Use a session-ID-scoped temporary directory,
  remove that invocation's transient files, and use the returned Browserbase
  session ID to retrieve the receipt download from the caller.

This split still demonstrates the important identity story: Browserbase Contexts
provide the vendor identity, and the standalone Ramp identity provides the
business-owned, audited financial actor.

## Context configuration

`catering-agent` is a local Browse CLI alias. A deployed Function needs the real
context UUID in its `sessionConfig`. Resolve it privately before generating the
Function and do not commit the resolved UUID.

Put every invocation that uses this context behind an external single-flight
queue. The next invocation may start only after the previous Browserbase session
reaches `COMPLETED`; a Function-local mutex cannot serialize different hosts.

The relevant Function shape is:

```ts
import { defineFn } from "@browserbasehq/sdk-functions";
import { chromium } from "playwright-core";

defineFn(
  "fetch-event-receipt",
  async (ctx, params) => {
    const browser = await chromium.connectOverCDP(ctx.session.connectUrl);
    const page = browser.contexts()[0]?.pages()[0];
    if (!page) throw new Error("Browserbase did not provide a page");

    // Use a unique /tmp directory derived from ctx.session.id. Navigate, match,
    // await exactly one completed receipt download, validate the downloaded
    // artifact itself, and clean this invocation's transient files.
    return {
      sessionId: ctx.session.id,
      vendor: "<validated vendor>",
      orderDate: "<validated charged/placed date>",
      currency: "USD",
      amountMinor: 0,
      status: "retrieved",
    };
  },
  {
    sessionConfig: {
      browserSettings: {
        context: {
          id: "<resolved-catering-context-uuid>",
          persist: true,
        },
      },
    },
  },
);
```

Do not publish this placeholder. Generate a local deployment artifact with the
resolved UUID excluded from version control, or wait for a verified secure
configuration mechanism.

## Build and verification

Use the Browse CLI's current Functions commands:

```bash
browse functions init fetch-event-receipt-function
browse functions dev index.ts
browse functions publish index.ts --dry-run
browse functions publish index.ts
browse functions invoke <function-id> --params '<sanitized-json>'
```

Before publishing, run the local development server against real Browserbase
sessions and verify all supported vendors independently. A typecheck or dry-run
publish does not prove authentication, matching, downloading, or upload.

The Function result should include the Browserbase session ID, vendor, order
date, currency, exact amount in minor units, and a status. It must not include
the context UUID, CDP URL, cookies, passwords, OAuth state, customer details, or
receipt base64.

Official references:

- <https://docs.browserbase.com/platform/runtime/overview>
- <https://docs.browserbase.com/platform/browser/core-features/contexts>
