# Public diagnostic API surface

Use only customer-authorized, read-only endpoints. API behavior can change; verify against the linked Browserbase documentation when a response differs from this reference.

## Primary evidence

| Evidence | Endpoint | Diagnostic value |
|---|---|---|
| Session metadata | `GET /v1/sessions/{id}` | Status, timestamps, project, region, keep-alive, proxy bytes, CPU, memory, context, and user metadata |
| Session logs | `GET /v1/sessions/{id}/logs` | CDP console, network, runtime, and page-lifecycle events |
| Project metadata | `GET /v1/projects/{projectId}` | Default timeout and project concurrency |
| Running sessions | `GET /v1/sessions?status=RUNNING` | Current sessions that can be compared with the project concurrency limit |

Authentication uses the `X-BB-API-Key` header. Keep the key in `BROWSERBASE_API_KEY`; never place it in a command line, report, or fixture.

## Useful secondary evidence

- Session Inspector: `https://browserbase.com/sessions/{sessionId}` for video, network, console, events, and performance views.
- Replay metadata: `GET /v1/sessions/{id}/replays`; recordings may be disabled or unavailable. Do not fetch video segments for a routine diagnosis.
- Downloads API: useful when the reported failure concerns a missing or incomplete download.
- Project usage: `GET /v1/projects/{projectId}/usage`; useful for billing and usage questions, but not a direct root-cause signal for one session.

## Known limits

- Browserbase session logs do not necessarily contain exceptions thrown by the customer's automation process.
- A failed create-session request may return no session ID. Diagnose it from the HTTP status, response body, and rate-limit headers.
- A selector failure needs the client error and often DOM or video evidence from Session Inspector.
- A completed status only describes session lifecycle. It does not prove the customer's task succeeded.
- Session metadata does not expose the complete session-creation request, so settings absent from the response may require customer code or Inspector evidence.

## Official documentation

- [Get a Session](https://docs.browserbase.com/reference/api/get-a-session)
- [Session Logs](https://docs.browserbase.com/reference/api/session-logs)
- [Get a Project](https://docs.browserbase.com/reference/api/get-a-project)
- [List Sessions](https://docs.browserbase.com/reference/api/list-sessions)
- [Observability](https://docs.browserbase.com/platform/browser/observability/observability)
- [Manage a browser session](https://docs.browserbase.com/platform/browser/getting-started/manage-browser-session)
- [Concurrency management](https://docs.browserbase.com/optimizations/concurrency/overview)
