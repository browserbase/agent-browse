# Diagnosis rules

Apply these rules conservatively. Prefer direct status and event evidence over timing heuristics.

## Lifecycle

| Signal | Confidence | Interpretation | Recommendation |
|---|---|---|---|
| `status == TIMED_OUT` | High | Browserbase ended the session at its configured timeout | Increase the session/project timeout or shorten the task; maximum duration is platform-limited |
| `status == ERROR` | High for outcome, low for cause | The browser session ended in error | Correlate the last CDP events and client exception; use Inspector if the API lacks a termination reason |
| End time is within a few seconds of `expiresAt` | Medium | Configured timeout likely ended the session | Compare requested timeout with project default |
| `keepAlive == false` and client disconnected | Medium only with client evidence | Disconnect normally ends the session | Set keep-alive only when reconnection is required |
| Roughly 10 minutes without CDP commands before termination | Medium | CDP inactivity timeout is plausible | Send a lightweight CDP heartbeat periodically; sparse/disabled logs can mimic this gap |
| Newly created session was not connected within 5 minutes | Medium only with client timestamps | Initial connection window may have elapsed | Connect immediately or use keep-alive when appropriate |

## Network and target-site behavior

| Signal | Interpretation | Recommendation |
|---|---|---|
| `Network.loadingFailed` or `net::ERR_*` | Browser-level DNS, TLS, proxy, cancellation, or connection failure | Report the exact sanitized error and host; retry only transient failures |
| HTTP `401` | Target-site authentication failed or expired | Refresh the authenticated context and verify credentials/session state |
| HTTP `403` | Target site denied access; bot protection is one possibility | Inspect response and console evidence; verify proxy, identity, and authorization before attributing to bot defense |
| HTTP `429` from a page | Target site rate-limited browser traffic | Respect target retry guidance and reduce traffic |
| HTTP `5xx` | Target or upstream server failed | Retry with bounded backoff and preserve request evidence |
| Captcha-solving start without completion | Challenge solving may have stalled | Inspect video/console and identity settings |

Do not confuse a target site's HTTP status with the Browserbase API status.

## Automation and page errors

- Treat `Runtime.exceptionThrown`, console errors, and `Log.entryAdded` errors as page evidence.
- Treat Playwright timeouts, missing selectors, Stagehand schema/inference errors, and uncaught application exceptions as client evidence unless browser events explain them.
- A page can emit console errors and still complete the requested task. Rank errors by temporal proximity and relevance to the failing action.
- A `COMPLETED` session can contain an unsuccessful automation run; session lifecycle and task outcome are independent.

## Capacity and rate limits

- A Browserbase API `429` during `POST /sessions` means the request was rejected before a session was created. Inspect `retry-after` and `x-ratelimit-*` headers.
- If current running sessions equal or exceed project concurrency, report saturation as a present condition, not definitive proof of a historical failure.
- Use queueing and bounded retry that respects `retry-after`; do not blindly retry.

## Evidence language

- **High:** directly stated by status or a specific event.
- **Medium:** multiple signals align, but another cause remains plausible.
- **Low:** a useful hypothesis requiring more evidence.

State unavailable evidence explicitly, for example: “The public logs show the navigation succeeded, but the client-side selector exception was not provided.”
