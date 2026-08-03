import importlib.util
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "scripts" / "browserbase_doctor.py"
SPEC = importlib.util.spec_from_file_location("browserbase_doctor", SCRIPT)
doctor = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(doctor)


class BrowserbaseDoctorTests(unittest.TestCase):
    def test_redacts_secrets_and_url_values(self):
        fake_key = "bb_" + "abcdefghijklmnop"
        value = {
            "connectUrl": "wss://connect.browserbase.com?token=secret",
            "headers": {"Authorization": "Bearer abc.def", "x-bb-api-key": fake_key},
            "url": "https://example.com/account?email=person@example.com&token=abc",
            "message": "login failed password=hunter2",
        }
        redacted = doctor.redact(value)
        self.assertEqual(redacted["connectUrl"], "[REDACTED]")
        self.assertEqual(redacted["headers"]["Authorization"], "[REDACTED]")
        self.assertEqual(redacted["headers"]["x-bb-api-key"], "[REDACTED]")
        self.assertEqual(redacted["url"], "https://example.com/account?email=[REDACTED]&token=[REDACTED]")
        self.assertEqual(redacted["message"], "login failed password=[REDACTED]")

    def test_finds_timeout_network_and_page_errors(self):
        started = datetime(2026, 1, 1, tzinfo=timezone.utc)
        ended = started + timedelta(minutes=15)
        session = {
            "id": "session-12345678",
            "projectId": "project-1",
            "status": "TIMED_OUT",
            "startedAt": started.isoformat(),
            "endedAt": ended.isoformat(),
            "expiresAt": ended.isoformat(),
            "region": "us-west-2",
            "keepAlive": False,
        }
        logs = [
            {
                "method": "Network.responseReceived",
                "timestamp": int(started.timestamp() * 1000),
                "request": {
                    "params": {"response": {"status": 403, "url": "https://example.com/private?token=secret"}}
                },
            },
            {
                "method": "Runtime.exceptionThrown",
                "timestamp": int((started + timedelta(seconds=1)).timestamp() * 1000),
                "request": {"params": {"exceptionDetails": {"text": "Uncaught Error: boom"}}},
            },
        ]
        report = doctor.analyze_session(session, logs, None, None, "", "", [])
        ids = {finding["id"] for finding in report["findings"]}
        self.assertTrue({"session-timed-out", "ended-at-expiry", "http-403", "page-errors"} <= ids)
        serialized = doctor.json.dumps(report)
        self.assertNotIn("secret", serialized)
        self.assertIn("token=[REDACTED]", serialized)

    def test_classifies_create_session_429_without_session(self):
        fake_key = "bb_" + "abcdefghijklmnop"
        report = doctor.analyze_session(
            None,
            [],
            None,
            None,
            "",
            f"HTTP 429 Too Many Requests; retry-after: 42; x-bb-api-key: {fake_key}",
            [],
        )
        finding = report["findings"][0]
        self.assertEqual(finding["id"], "create-rate-limited")
        self.assertNotIn(fake_key, doctor.json.dumps(report))


if __name__ == "__main__":
    unittest.main()
