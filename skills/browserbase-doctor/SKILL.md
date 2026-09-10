---
name: browserbase-doctor
description: Diagnose Browserbase browser-session failures from customer-authorized public API data, exported session metadata, CDP session logs, and optional application errors. Use when a user provides a Browserbase session ID or exported logs and asks why a session failed, timed out, disconnected, was blocked, returned network errors, hit resource or concurrency limits, or behaved unexpectedly. Produce a redacted, evidence-backed report without changing or reconnecting to the session.
---

# Browserbase Doctor

Diagnose Browserbase sessions with read-only evidence. Separate facts from inferences, protect customer data, and recommend the smallest useful next step.

## Guardrails

- Treat the Browserbase API key, connection URLs, signing keys, cookies, authorization headers, request bodies, and query values as secrets.
- Never ask the user to paste an API key. Read `BROWSERBASE_API_KEY` from the environment.
- Never connect to, control, release, retry, or otherwise mutate a session. This skill is diagnostic only.
- Prefer offline exports when the user cannot authorize live API access.
- Do not print or attach raw logs by default. Use the script's sanitized report.
- Label each conclusion `high`, `medium`, or `low` confidence. Do not turn absence of evidence into evidence of absence.

## Workflow

### 1. Collect the minimum evidence

Ask for a session ID when one exists. Also accept the originating Playwright, Puppeteer, Selenium, Stagehand, or application error because selector and orchestration failures often occur outside Browserbase and may not appear in session logs.

For a live diagnosis, require `BROWSERBASE_API_KEY` and run:

```bash
python3 scripts/browserbase_doctor.py <session-id> --app-log <optional-log-file>
```

For an offline diagnosis, ask the user to export the `GET /v1/sessions/{id}` and `GET /v1/sessions/{id}/logs` responses, then run:

```bash
python3 scripts/browserbase_doctor.py \
  --session-json session.json \
  --logs-json logs.json \
  --app-log <optional-log-file>
```

Use `--json` for machine-readable output and `--output <path>` to save the report. Run `python3 scripts/browserbase_doctor.py --help` for all options.

If session creation failed before returning an ID, pass the captured error instead:

```bash
python3 scripts/browserbase_doctor.py --error-file create-session-error.txt
```

### 2. Interpret the report

Read [references/diagnosis-rules.md](references/diagnosis-rules.md) before adding or revising a diagnosis. Use [references/api-surface.md](references/api-surface.md) when an endpoint fails, a field is unfamiliar, or the user asks what public evidence is available.

Correlate the report with the application error. In particular:

- Treat a `TIMED_OUT` status as direct evidence of session timeout.
- Treat a long final CDP gap as only suggestive of inactivity; disabled or sparse logging can look similar.
- Treat HTTP `401`/`403` as target-site access or authentication evidence, not proof of Browserbase authentication failure.
- Treat a missing selector, Stagehand inference failure, or uncaught application exception as client-side unless session evidence shows a preceding browser or network failure.
- Treat `429` during session creation as a creation-rate or concurrency symptom; no session exists to inspect.

### 3. Respond with a compact incident report

Lead with the most likely cause and confidence. Include:

1. Session outcome and duration.
2. Ranked findings with exact, sanitized evidence.
3. Recommended fix or next check for each finding.
4. What cannot be determined from the available public evidence.
5. The Session Inspector URL when a session ID exists.

Do not paste large event lists. Mention counts and include at most a few representative sanitized examples.

## Escalation boundary

Recommend the Session Inspector when visual state, DOM state, detailed performance, or video playback is necessary. Recommend Browserbase support only after public evidence and the customer's application error are insufficient; provide the session ID, timestamps, region, status, and redacted finding summary—not the API key or raw secrets.
