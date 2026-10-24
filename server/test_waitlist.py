"""Tests for server/waitlist.py. Run: python3 -m unittest server/test_waitlist.py

Each test class starts the real server on a random localhost port with a temporary
SQLite file, so nothing touches the production database.
"""

import contextlib
import io
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(__file__))
import waitlist  # noqa: E402


class WaitlistServer(unittest.TestCase):
    rate_limit = 1000

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = os.path.join(self.tmp.name, "data", "waitlist.db")
        waitlist.init_db(self.db)

        class H(waitlist.Handler):
            db_path = self.db
            limiter = waitlist.RateLimiter(self.rate_limit, 600)

        self.httpd = waitlist.Server(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        self.stderr = io.StringIO()
        self.redirect = contextlib.redirect_stderr(self.stderr)
        self.redirect.__enter__()
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.redirect.__exit__(None, None, None)
        self.tmp.cleanup()

    def post(self, body, ctype="application/json", path="/api/waitlist", headers=None):
        data = json.dumps(body).encode() if ctype == "application/json" and not isinstance(body, bytes) else body
        req = urllib.request.Request(self.url + path, data=data, method="POST",
                                     headers={"Content-Type": ctype, **(headers or {})})
        try:
            with urllib.request.urlopen(req) as resp:
                return resp.status, resp.headers, resp.read().decode()
        except urllib.error.HTTPError as err:
            return err.code, err.headers, err.read().decode()

    def rows(self):
        with sqlite3.connect(self.db) as conn:
            return conn.execute("SELECT email, policy_version FROM waitlist ORDER BY id").fetchall()


class Signups(WaitlistServer):
    def test_valid_email_is_stored(self):
        status, _, body = self.post({"email": "  Ada@Example.COM "})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["result"], "joined")
        self.assertEqual(self.rows(), [("Ada@example.com", "draft")])  # domain lowercased, local part kept

    def test_duplicate_gets_the_same_answer_and_one_row(self):
        first = self.post({"email": "ada@example.com"})
        again = self.post({"email": "ADA@example.com"})
        self.assertEqual(first[0], again[0])
        self.assertEqual(first[2], again[2])  # can't tell new from already listed
        self.assertEqual(len(self.rows()), 1)

    def test_invalid_emails_are_rejected(self):
        for bad in ["", "ada", "ada@", "@example.com", "ada@example", "a b@example.com",
                    "x" * 250 + "@example.com", 42, None, ["ada@example.com"]]:
            status, _, body = self.post({"email": bad})
            self.assertEqual(status, 400, bad)
            self.assertEqual(json.loads(body)["result"], "invalid_email")
        self.assertEqual(self.rows(), [])

    def test_honeypot_pretends_success_and_stores_nothing(self):
        status, _, body = self.post({"email": "bot@example.com", "website": "http://spam"})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["result"], "joined")
        self.assertEqual(self.rows(), [])

    def test_bad_requests(self):
        self.assertEqual(self.post(b"{not json")[0], 400)
        self.assertEqual(self.post(b'["a list"]')[0], 400)
        self.assertEqual(self.post(b"x" * 5000)[0], 413)
        self.assertEqual(self.post({"email": "ada@example.com"}, path="/api/other")[0], 404)
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(self.url + "/api/waitlist")
        self.assertEqual(ctx.exception.code, 405)
        self.assertEqual(self.rows(), [])

    def test_form_post_without_javascript(self):
        status, headers, body = self.post(b"email=ada%40example.com&website=",
                                          ctype="application/x-www-form-urlencoded")
        self.assertEqual(status, 200)
        self.assertIn("text/html", headers["Content-Type"])
        self.assertIn("You're on the list", body)
        self.assertIn('href="/#waitlist"', body)
        self.assertEqual(self.rows(), [("ada@example.com", "draft")])

    def test_form_post_error_page_escapes_nothing_from_input(self):
        status, _, body = self.post(b"email=%3Cscript%3E", ctype="application/x-www-form-urlencoded")
        self.assertEqual(status, 400)
        self.assertNotIn("<script>", body)  # the page never echoes what was typed

    def test_responses_are_not_cached(self):
        _, headers, _ = self.post({"email": "ada@example.com"})
        self.assertEqual(headers["Cache-Control"], "no-store")

    def test_concurrent_signups_all_land(self):
        emails = [f"user{i}@example.com" for i in range(60)] * 2  # every address twice
        with ThreadPoolExecutor(max_workers=16) as pool:
            statuses = list(pool.map(lambda e: self.post({"email": e})[0], emails))
        self.assertEqual(set(statuses), {200})
        self.assertEqual(len(self.rows()), 60)

    def test_no_email_reaches_the_logs(self):
        self.post({"email": "secret-canary@example.com"})
        self.post(b"email=form-canary%40example.com", ctype="application/x-www-form-urlencoded")
        self.assertNotIn("canary", self.stderr.getvalue())


class RateLimit(WaitlistServer):
    rate_limit = 3

    def test_per_client_limit(self):
        for i in range(3):
            self.assertEqual(self.post({"email": f"u{i}@example.com"})[0], 200)
        status, _, body = self.post({"email": "u9@example.com"})
        self.assertEqual(status, 429)
        self.assertEqual(json.loads(body)["result"], "rate_limited")
        # a different client (nginx's X-Real-IP) has its own budget
        self.assertEqual(self.post({"email": "v@example.com"}, headers={"X-Real-IP": "203.0.113.9"})[0], 200)
        self.assertEqual(len(self.rows()), 4)


class OperatorCommands(unittest.TestCase):
    def test_count_export_delete(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = os.path.join(tmp, "waitlist.db")
            waitlist.init_db(db)
            for e in ["ada@example.com", "bob@example.com"]:
                waitlist.add_signup(e, db)
            env = {**os.environ, "WAITLIST_DB": db}
            run = lambda *a: subprocess.run([sys.executable, waitlist.__file__, *a], env=env,
                                            capture_output=True, text=True).stdout.strip()
            self.assertEqual(run("count"), "2")
            self.assertIn("ada@example.com", run("export"))
            self.assertEqual(run("delete", "ADA@example.com"), "deleted")
            self.assertEqual(run("delete", "ada@example.com"), "not on the list")
            self.assertEqual(run("count"), "1")
            copy = os.path.join(tmp, "backup.db")
            self.assertIn("backed up", run("backup", copy))
            with sqlite3.connect(copy) as conn:
                self.assertEqual(conn.execute("SELECT email FROM waitlist").fetchall(), [("bob@example.com",)])


if __name__ == "__main__":
    unittest.main()
