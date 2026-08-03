#!/usr/bin/env python3
"""Read-only Browserbase session diagnostics using public API evidence."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


API_BASE = "https://api.browserbase.com/v1"
SENSITIVE_KEYS = {
    "authorization",
    "cookie",
    "cookies",
    "setcookie",
    "set-cookie",
    "xbbapikey",
    "x-bb-api-key",
    "apikey",
    "api-key",
    "signingkey",
    "connecturl",
    "seleniumremoteurl",
    "password",
    "passwd",
    "secret",
    "token",
    "accesstoken",
    "refreshtoken",
    "rawbody",
    "postdata",
    "requestbody",
}
SEVERITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}


class ApiError(RuntimeError):
    def __init__(self, status: int | None, message: str):
        super().__init__(message)
        self.status = status


def normalized_key(value: str) -> str:
    return re.sub(r"[^a-z0-9-]", "", value.lower())


def redact_url(value: str) -> str:
    try:
        parsed = urllib.parse.urlsplit(value)
    except ValueError:
        return value
    if parsed.scheme not in {"http", "https", "ws", "wss"}:
        return value
    host = parsed.hostname or ""
    if parsed.scheme in {"ws", "wss"} and "browserbase" in host.lower():
        return "[REDACTED_CONNECT_URL]"
    netloc = host
    try:
        port = parsed.port
    except ValueError:
        port = None
    if port:
        netloc += f":{port}"
    redacted_query = "&".join(
        f"{urllib.parse.quote_plus(key)}=[REDACTED]"
        for key, _ in urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
    )
    return urllib.parse.urlunsplit((parsed.scheme, netloc, parsed.path, redacted_query, ""))


def redact_string(value: str) -> str:
    value = re.sub(
        r"(?:https?|wss?)://[^\s\]\[<>'\"]+",
        lambda match: redact_url(match.group(0).rstrip(".,);"))
        + match.group(0)[len(match.group(0).rstrip(".,);")) :],
        value,
    )
    value = re.sub(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]+", "Bearer [REDACTED]", value)
    value = re.sub(
        r"(?i)\b(authorization|cookie|set-cookie|x-bb-api-key|api[_-]?key|password|passwd|secret|token|access[_-]?token|refresh[_-]?token|signing[_-]?key)\b\s*[:=]\s*([^\s,;]+)",
        lambda match: f"{match.group(1)}=[REDACTED]",
        value,
    )
    value = re.sub(r"\bbb_[A-Za-z0-9_-]{12,}\b", "[REDACTED_API_KEY]", value)
    return value


def redact(value: Any, key: str | None = None) -> Any:
    if key is not None and normalized_key(key) in SENSITIVE_KEYS:
        return "[REDACTED]"
    if isinstance(value, dict):
        return {str(k): redact(v, str(k)) for k, v in value.items()}
    if isinstance(value, list):
        return [redact(item) for item in value]
    if isinstance(value, str):
        return redact_string(value)
    return value


def compact(value: Any, limit: int = 320) -> str:
    if isinstance(value, str):
        text = redact_string(value)
    else:
        text = json.dumps(redact(value), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    text = re.sub(r"\s+", " ", text).strip()
    return text if len(text) <= limit else text[: limit - 1] + "…"


def parse_datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        seconds = float(value) / 1000 if value > 10_000_000_000 else float(value)
        try:
            return datetime.fromtimestamp(seconds, tz=timezone.utc)
        except (OSError, OverflowError, ValueError):
            return None
    if isinstance(value, str):
        candidate = value.strip().replace("Z", "+00:00")
        try:
            parsed = datetime.fromisoformat(candidate)
        except ValueError:
            return None
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    return None


def event_timestamp(event: dict[str, Any]) -> datetime | None:
    for value in (
        event.get("timestamp"),
        (event.get("request") or {}).get("timestamp"),
        (event.get("response") or {}).get("timestamp"),
    ):
        parsed = parse_datetime(value)
        if parsed:
            return parsed
    return None


def event_params(event: dict[str, Any]) -> dict[str, Any]:
    request = event.get("request")
    if isinstance(request, dict) and isinstance(request.get("params"), dict):
        return request["params"]
    params = event.get("params")
    return params if isinstance(params, dict) else {}


def load_json(path: str) -> Any:
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"Could not read JSON from {path}: {exc}") from exc


def load_text(path: str | None) -> str:
    if not path:
        return ""
    try:
        return Path(path).read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        raise ValueError(f"Could not read {path}: {exc}") from exc


def api_get(path: str, api_key: str, query: dict[str, str] | None = None) -> Any:
    url = f"{API_BASE}{path}"
    if query:
        url += "?" + urllib.parse.urlencode(query)
    request = urllib.request.Request(
        url,
        headers={"X-BB-API-Key": api_key, "Accept": "application/json", "User-Agent": "browserbase-doctor/1"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise ApiError(exc.code, f"Browserbase API returned HTTP {exc.code}: {compact(body, 180)}") from exc
    except urllib.error.URLError as exc:
        raise ApiError(None, f"Could not reach Browserbase API: {exc.reason}") from exc
    try:
        return json.loads(body)
    except json.JSONDecodeError as exc:
        raise ApiError(None, "Browserbase API returned invalid JSON") from exc


def add_finding(
    findings: list[dict[str, Any]],
    finding_id: str,
    severity: str,
    confidence: str,
    title: str,
    evidence: list[str],
    recommendation: str,
) -> None:
    if any(item["id"] == finding_id for item in findings):
        return
    findings.append(
        {
            "id": finding_id,
            "severity": severity,
            "confidence": confidence,
            "title": title,
            "evidence": [compact(item) for item in evidence[:3]],
            "recommendation": recommendation,
        }
    )


def console_text(params: dict[str, Any]) -> str:
    values: list[str] = []
    for key in ("text", "message"):
        if isinstance(params.get(key), str):
            values.append(params[key])
    entry = params.get("entry")
    if isinstance(entry, dict) and isinstance(entry.get("text"), str):
        values.append(entry["text"])
    details = params.get("exceptionDetails")
    if isinstance(details, dict):
        for key in ("text", "exception"):
            if isinstance(details.get(key), str):
                values.append(details[key])
            elif isinstance(details.get(key), dict):
                description = details[key].get("description")
                if isinstance(description, str):
                    values.append(description)
    args = params.get("args")
    if isinstance(args, list):
        for arg in args:
            if isinstance(arg, dict):
                value = arg.get("value", arg.get("description"))
                if isinstance(value, (str, int, float, bool)):
                    values.append(str(value))
    return " ".join(values)


def analyze_logs(logs: list[Any], findings: list[dict[str, Any]]) -> dict[str, Any]:
    stats: dict[str, Any] = {
        "events": len(logs),
        "network_responses": 0,
        "http_errors": 0,
        "network_failures": 0,
        "console_errors": 0,
        "runtime_exceptions": 0,
        "max_event_gap_seconds": None,
    }
    http_examples: dict[int, list[str]] = {}
    network_failures: list[str] = []
    console_errors: list[str] = []
    runtime_exceptions: list[str] = []
    solving_started = 0
    solving_completed = 0
    timestamps: list[datetime] = []

    for raw_event in logs:
        if not isinstance(raw_event, dict):
            continue
        method = str(raw_event.get("method", ""))
        params = event_params(raw_event)
        timestamp = event_timestamp(raw_event)
        if timestamp:
            timestamps.append(timestamp)

        if method == "Network.responseReceived":
            response = params.get("response") if isinstance(params.get("response"), dict) else {}
            status = response.get("status")
            url = response.get("url", "unknown URL")
            if isinstance(status, (int, float)):
                code = int(status)
                stats["network_responses"] += 1
                if code >= 400:
                    stats["http_errors"] += 1
                    http_examples.setdefault(code, []).append(f"HTTP {code} {redact_url(str(url))}")

        if method in {"Network.loadingFailed", "Network.webSocketFrameError"}:
            stats["network_failures"] += 1
            error = params.get("errorText", params.get("errorMessage", "network request failed"))
            network_failures.append(compact(error))

        text = console_text(params)
        lowered = text.lower()
        if "browser-solving-started" in lowered:
            solving_started += 1
        if "browser-solving-completed" in lowered:
            solving_completed += 1
        if method == "Runtime.exceptionThrown":
            stats["runtime_exceptions"] += 1
            runtime_exceptions.append(compact(text or params))
        elif method == "Runtime.consoleAPICalled" and str(params.get("type", "")).lower() in {"error", "assert"}:
            stats["console_errors"] += 1
            console_errors.append(compact(text or params))
        elif method == "Log.entryAdded":
            entry = params.get("entry") if isinstance(params.get("entry"), dict) else {}
            if str(entry.get("level", "")).lower() in {"error", "warning"}:
                stats["console_errors"] += 1
                console_errors.append(compact(text or entry))

    timestamps.sort()
    if len(timestamps) > 1:
        stats["max_event_gap_seconds"] = round(
            max((right - left).total_seconds() for left, right in zip(timestamps, timestamps[1:])), 1
        )

    if network_failures:
        add_finding(
            findings,
            "network-loading-failed",
            "high",
            "high",
            f"{len(network_failures)} browser network request(s) failed",
            network_failures,
            "Inspect the exact net error and affected host; verify DNS, TLS, proxy, and target availability before retrying.",
        )
    for code_group, title, recommendation in (
        ({401}, "Target-site authentication failures", "Refresh or recreate the authenticated context and verify target-site credentials."),
        ({403}, "Target site denied requests", "Inspect the response and Session Inspector; verify authorization, proxy, and identity settings before attributing this to bot protection."),
        ({429}, "Target site rate-limited requests", "Respect the target site's retry guidance and reduce request rate."),
    ):
        examples = [item for code in code_group for item in http_examples.get(code, [])]
        if examples:
            add_finding(findings, f"http-{next(iter(code_group))}", "high", "high", title, examples, recommendation)
    server_examples = [item for code, items in http_examples.items() if code >= 500 for item in items]
    if server_examples:
        add_finding(
            findings,
            "http-5xx",
            "high",
            "high",
            "Target or upstream server returned 5xx",
            server_examples,
            "Retry only with bounded backoff and preserve the failing request evidence for the target service owner.",
        )
    if runtime_exceptions or console_errors:
        examples = runtime_exceptions + console_errors
        add_finding(
            findings,
            "page-errors",
            "medium",
            "high",
            f"Page emitted {len(examples)} error(s) or exception(s)",
            examples,
            "Correlate these page errors with the failing action; unrelated page errors do not necessarily mean the automation failed.",
        )
    if solving_started > solving_completed:
        add_finding(
            findings,
            "captcha-solving-incomplete",
            "medium",
            "medium",
            "Challenge solving started without a matching completion event",
            [f"started={solving_started}, completed={solving_completed}"],
            "Inspect the session video and console timeline, then verify identity, proxy, and CAPTCHA settings.",
        )
    return stats


def analyze_session(
    session: dict[str, Any] | None,
    logs: list[Any],
    project: dict[str, Any] | None,
    running_sessions: list[Any] | None,
    app_text: str,
    create_error: str,
    warnings: list[str],
) -> dict[str, Any]:
    findings: list[dict[str, Any]] = []
    summary: dict[str, Any] = {}

    if session:
        started = parse_datetime(session.get("startedAt"))
        ended = parse_datetime(session.get("endedAt"))
        expires = parse_datetime(session.get("expiresAt"))
        duration = round((ended - started).total_seconds(), 1) if started and ended else None
        summary = {
            "id": session.get("id"),
            "status": session.get("status"),
            "startedAt": session.get("startedAt"),
            "endedAt": session.get("endedAt"),
            "expiresAt": session.get("expiresAt"),
            "durationSeconds": duration,
            "region": session.get("region"),
            "projectId": session.get("projectId"),
            "keepAlive": session.get("keepAlive"),
            "proxyBytes": session.get("proxyBytes"),
            "avgCpuUsage": session.get("avgCpuUsage"),
            "memoryUsage": session.get("memoryUsage"),
        }
        status = str(session.get("status", "")).upper()
        if status == "TIMED_OUT":
            add_finding(
                findings,
                "session-timed-out",
                "critical",
                "high",
                "Browserbase marked the session TIMED_OUT",
                [f"status={status}", f"duration={duration}s" if duration is not None else "duration unavailable"],
                "Increase the session or project timeout, or shorten the task; also distinguish this from client action timeouts.",
            )
        elif status == "ERROR":
            add_finding(
                findings,
                "session-error",
                "critical",
                "high",
                "Browserbase marked the session ERROR",
                ["status=ERROR"],
                "Correlate the final CDP events with the client exception and use Session Inspector for the termination reason.",
            )
        if ended and expires and abs((expires - ended).total_seconds()) <= 10:
            add_finding(
                findings,
                "ended-at-expiry",
                "high",
                "medium",
                "Session ended at its configured expiry",
                [f"endedAt={session.get('endedAt')}", f"expiresAt={session.get('expiresAt')}"],
                "Compare the requested timeout with the project default and increase it only if the task legitimately needs longer.",
            )

    stats = analyze_logs(logs, findings)
    max_gap = stats.get("max_event_gap_seconds")
    if isinstance(max_gap, (int, float)) and max_gap >= 590:
        add_finding(
            findings,
            "long-cdp-gap",
            "medium",
            "medium",
            "Logs contain a CDP activity gap of about 10 minutes or more",
            [f"largest event gap={max_gap}s"],
            "If the client intentionally idles, send a lightweight CDP command every few minutes; confirm with client timestamps because sparse logs can mimic inactivity.",
        )

    if project:
        summary["projectDefaultTimeout"] = project.get("defaultTimeout")
        summary["projectConcurrency"] = project.get("concurrency")
        concurrency = project.get("concurrency")
        if isinstance(concurrency, int) and isinstance(running_sessions, list):
            project_id = session.get("projectId") if session else project.get("id")
            running_count = sum(
                1
                for item in running_sessions
                if isinstance(item, dict) and (not project_id or item.get("projectId") == project_id)
            )
            summary["runningSessionsObserved"] = running_count
            if running_count >= concurrency:
                add_finding(
                    findings,
                    "concurrency-saturated",
                    "medium",
                    "medium",
                    "Project concurrency is currently saturated",
                    [f"running={running_count}, project concurrency={concurrency}"],
                    "Queue session creation and respect retry-after on 429 responses; current saturation does not prove a historical failure.",
                )

    combined_client_text = "\n".join(part for part in (app_text, create_error) if part)
    lowered_client = combined_client_text.lower()
    if create_error and ("429" in create_error or "too many requests" in lowered_client):
        add_finding(
            findings,
            "create-rate-limited",
            "critical",
            "high",
            "Browserbase session creation was rate-limited",
            [compact(create_error, 420)],
            "Respect retry-after and x-ratelimit headers, queue creation, and compare active sessions with project concurrency.",
        )
    if app_text and re.search(r"(?i)(selector|locator|waiting for).*?(timeout|not found|failed)", app_text, re.DOTALL):
        add_finding(
            findings,
            "client-selector-failure",
            "high",
            "high",
            "Client automation reported an element or selector failure",
            [compact(app_text, 420)],
            "Inspect DOM/video at the failure time and verify frames, timing, and selector assumptions; this error originates in the client unless earlier browser evidence explains it.",
        )
    elif app_text and re.search(r"(?i)(timeout|timed out)", app_text):
        add_finding(
            findings,
            "client-timeout",
            "high",
            "high",
            "Client automation reported a timeout",
            [compact(app_text, 420)],
            "Identify whether this was an action/navigation timeout or the Browserbase session timeout; compare its timestamp with session status and network events.",
        )

    findings.sort(key=lambda item: (SEVERITY_ORDER.get(item["severity"], 99), item["id"]))
    session_id = summary.get("id")
    return {
        "session": redact(summary),
        "statistics": stats,
        "findings": findings,
        "warnings": [compact(warning) for warning in warnings],
        "limitations": [
            "Session lifecycle status does not prove the customer's task succeeded.",
            "Client-side automation exceptions may be absent unless an application log was provided.",
            "Visual and DOM state require Session Inspector or a customer-provided trace.",
        ],
        "inspectorUrl": f"https://browserbase.com/sessions/{session_id}" if session_id else None,
    }


def render_markdown(report: dict[str, Any]) -> str:
    session = report.get("session") or {}
    lines = ["# Browserbase Doctor report", ""]
    if session:
        lines.extend(
            [
                f"- Session: `{session.get('id', 'unknown')}`",
                f"- Status: `{session.get('status', 'unknown')}`",
                f"- Duration: `{session.get('durationSeconds', 'unknown')}s`",
                f"- Region: `{session.get('region', 'unknown')}`",
                f"- Keep alive: `{session.get('keepAlive', 'unknown')}`",
                "",
            ]
        )
    findings = report.get("findings") or []
    lines.extend(["## Findings", ""])
    if not findings:
        lines.append("No specific root-cause signal was found in the supplied evidence.")
        lines.append("")
    for index, finding in enumerate(findings, 1):
        lines.append(
            f"{index}. **{finding['title']}** — {finding['severity']} severity, {finding['confidence']} confidence"
        )
        for evidence in finding.get("evidence", []):
            lines.append(f"   - Evidence: `{evidence}`")
        lines.append(f"   - Next step: {finding['recommendation']}")
    stats = report.get("statistics") or {}
    lines.extend(["", "## Evidence summary", ""])
    lines.append(
        "- "
        + ", ".join(
            [
                f"{stats.get('events', 0)} log events",
                f"{stats.get('network_responses', 0)} network responses",
                f"{stats.get('http_errors', 0)} HTTP errors",
                f"{stats.get('network_failures', 0)} network failures",
                f"{stats.get('runtime_exceptions', 0)} runtime exceptions",
            ]
        )
    )
    if report.get("warnings"):
        lines.extend(["", "## Collection warnings", ""])
        lines.extend(f"- {item}" for item in report["warnings"])
    lines.extend(["", "## Limits", ""])
    lines.extend(f"- {item}" for item in report.get("limitations", []))
    if report.get("inspectorUrl"):
        lines.extend(["", f"Session Inspector: {report['inspectorUrl']}"])
    return "\n".join(lines).rstrip() + "\n"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Diagnose Browserbase sessions without mutating them.")
    parser.add_argument("session_id", nargs="?", help="Browserbase session ID for live API collection")
    parser.add_argument("--session-json", help="Offline Get Session response")
    parser.add_argument("--logs-json", help="Offline Session Logs response")
    parser.add_argument("--project-json", help="Optional offline Get Project response")
    parser.add_argument("--running-sessions-json", help="Optional offline List Sessions response")
    parser.add_argument("--app-log", help="Optional customer automation log or exception")
    parser.add_argument("--error-file", help="Optional create-session/API error captured before a session existed")
    parser.add_argument("--no-capacity-check", action="store_true", help="Skip live project/running-session checks")
    parser.add_argument("--json", action="store_true", help="Emit JSON instead of Markdown")
    parser.add_argument("--output", help="Write the sanitized report to this path")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    warnings: list[str] = []
    try:
        app_text = load_text(args.app_log)
        create_error = load_text(args.error_file)
        session = load_json(args.session_json) if args.session_json else None
        logs = load_json(args.logs_json) if args.logs_json else []
        project = load_json(args.project_json) if args.project_json else None
        running_sessions = load_json(args.running_sessions_json) if args.running_sessions_json else None
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    if session is not None and not isinstance(session, dict):
        print("error: --session-json must contain a JSON object", file=sys.stderr)
        return 2
    if not isinstance(logs, list):
        print("error: --logs-json must contain a JSON array", file=sys.stderr)
        return 2
    if not any((args.session_id, session, create_error)):
        print("error: provide a session ID, --session-json, or --error-file", file=sys.stderr)
        return 2

    if args.session_id:
        if not re.fullmatch(r"[A-Za-z0-9-]{8,128}", args.session_id):
            print("error: invalid session ID format", file=sys.stderr)
            return 2
        api_key = os.environ.get("BROWSERBASE_API_KEY")
        if not api_key:
            print("error: set BROWSERBASE_API_KEY for live diagnosis, or use offline JSON exports", file=sys.stderr)
            return 2
        try:
            session = api_get(f"/sessions/{urllib.parse.quote(args.session_id)}", api_key)
        except ApiError as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 1
        try:
            logs = api_get(f"/sessions/{urllib.parse.quote(args.session_id)}/logs", api_key)
            if not isinstance(logs, list):
                warnings.append("Session Logs response was not an array; log analysis was skipped.")
                logs = []
        except ApiError as exc:
            warnings.append(str(exc))
            logs = []
        if not args.no_capacity_check and isinstance(session, dict) and session.get("projectId"):
            project_id = urllib.parse.quote(str(session["projectId"]))
            try:
                project = api_get(f"/projects/{project_id}", api_key)
            except ApiError as exc:
                warnings.append(f"Project metadata unavailable: {exc}")
            try:
                running_sessions = api_get("/sessions", api_key, {"status": "RUNNING"})
            except ApiError as exc:
                warnings.append(f"Running-session count unavailable: {exc}")

    report = analyze_session(
        session if isinstance(session, dict) else None,
        logs,
        project if isinstance(project, dict) else None,
        running_sessions if isinstance(running_sessions, list) else None,
        app_text,
        create_error,
        warnings,
    )
    output = json.dumps(report, indent=2, ensure_ascii=False) + "\n" if args.json else render_markdown(report)
    if args.output:
        try:
            Path(args.output).write_text(output, encoding="utf-8")
        except OSError as exc:
            print(f"error: could not write {args.output}: {exc}", file=sys.stderr)
            return 2
    else:
        print(output, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
