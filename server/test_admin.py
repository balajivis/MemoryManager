"""Tests for server/admin.py. Run: python3 -m unittest server/test_admin.py"""

import http.client
import os
import re
import sqlite3
import sys
import tempfile
import threading
import unittest
from urllib.parse import urlencode

sys.path.insert(0, os.path.dirname(__file__))
import admin  # noqa: E402
import waitlist  # noqa: E402


class AdminTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = os.path.join(self.tmp.name, "waitlist.db")
        waitlist.init_db(self.db)
        with sqlite3.connect(self.db) as conn:
            conn.executemany("INSERT INTO waitlist (email, created_at, policy_version) VALUES (?, ?, 'draft')", [
                ("ada@example.com", "2026-10-01T09:00:00Z"),
                ("bob@corp.test", "2026-10-02T09:00:00Z"),
                ("x<b>y@evil.test", "2026-10-03T09:00:00Z"),   # can't arrive via the API; tests escaping
                ("100%_sure@example.com", "2026-10-04T09:00:00Z"),
            ])

        class H(admin.AdminHandler):
            db_path = self.db

        self.httpd = waitlist.Server(("127.0.0.1", 0), H)
        self.port = self.httpd.server_address[1]
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.tmp.cleanup()

    def request(self, method, path, body=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port)
        hdrs = {"Host": f"127.0.0.1:{self.port}", **(headers or {})}
        if body is not None:
            hdrs.setdefault("Content-Type", "application/x-www-form-urlencoded")
        conn.request(method, path, body=body, headers=hdrs)
        resp = conn.getresponse()
        data = resp.read().decode()
        conn.close()
        return resp.status, resp, data

    def emails(self):
        with sqlite3.connect(self.db) as conn:
            return [r[0] for r in conn.execute("SELECT email FROM waitlist ORDER BY id")]

    def test_list_shows_every_signup_newest_first_and_escaped(self):
        status, resp, page = self.request("GET", "/")
        self.assertEqual(status, 200)
        self.assertIn('<span class="num">4</span>', page)
        self.assertLess(page.index("100%_sure@example.com"), page.index("ada@example.com"))
        self.assertIn("x&lt;b&gt;y@evil.test", page)
        self.assertNotIn("x<b>y", page)

    def test_search_is_literal_and_case_insensitive(self):
        _, _, page = self.request("GET", "/?q=CORP")
        self.assertIn("bob@corp.test", page)
        self.assertNotIn("ada@example.com", page)
        _, _, page = self.request("GET", "/?" + urlencode({"q": "%_"}))   # LIKE wildcards are literal
        self.assertIn("100%_sure@example.com", page)
        self.assertNotIn("ada@example.com", page)
        _, _, page = self.request("GET", "/?q=nobody")
        self.assertIn("No sign-ups match that search.", page)

    def test_security_headers(self):
        _, resp, _ = self.request("GET", "/")
        self.assertIn("default-src 'none'", resp.getheader("Content-Security-Policy"))
        self.assertEqual(resp.getheader("X-Frame-Options"), "DENY")
        self.assertEqual(resp.getheader("Cache-Control"), "no-store")
        self.assertEqual(resp.getheader("Referrer-Policy"), "no-referrer")

    def test_rejects_other_hosts_dns_rebinding(self):
        status, _, _ = self.request("GET", "/", headers={"Host": f"attacker.example:{self.port}"})
        self.assertEqual(status, 403)

    def test_export_csv(self):
        status, resp, body = self.request("GET", "/export.csv")
        self.assertEqual(status, 200)
        self.assertTrue(resp.getheader("Content-Type").startswith("text/csv"))
        self.assertIn("attachment", resp.getheader("Content-Disposition"))
        lines = body.strip().splitlines()
        self.assertEqual(lines[0], "email,created_at,policy_version")
        self.assertEqual(len(lines), 5)

    def delete_form(self, signup_id):
        _, _, page = self.request("GET", f"/confirm?id={signup_id}")
        return re.search(r'name="token" value="([^"]+)"', page).group(1), page

    def test_delete_flow(self):
        token, page = self.delete_form(1)
        self.assertIn("ada@example.com", page)
        status, resp, _ = self.request("POST", "/delete", urlencode({"id": 1, "token": token}))
        self.assertEqual(status, 303)
        self.assertEqual(resp.getheader("Location"), "/?notice=deleted")
        self.assertNotIn("ada@example.com", self.emails())
        self.assertNotIn("ada", resp.getheader("Location"))   # no email in the redirect URL
        _, _, page = self.request("GET", "/?notice=deleted")
        self.assertIn("Deleted.", page)

    def test_delete_needs_the_token(self):
        for body in [urlencode({"id": 1}), urlencode({"id": 1, "token": "guess"})]:
            status, _, _ = self.request("POST", "/delete", body)
            self.assertEqual(status, 403)
        self.assertEqual(len(self.emails()), 4)

    def test_delete_rejects_cross_site_origin(self):
        token, _ = self.delete_form(1)
        status, _, _ = self.request("POST", "/delete", urlencode({"id": 1, "token": token}),
                                    headers={"Origin": "https://attacker.example"})
        self.assertEqual(status, 403)
        self.assertEqual(len(self.emails()), 4)

    def test_confirm_for_missing_signup(self):
        status, _, page = self.request("GET", "/confirm?id=999")
        self.assertEqual(status, 404)
        self.assertIn("already gone", page)

    def test_pagination(self):
        with sqlite3.connect(self.db) as conn:
            conn.executemany("INSERT INTO waitlist (email, policy_version) VALUES (?, 'draft')",
                             [(f"p{i}@example.com",) for i in range(150)])
        _, _, page1 = self.request("GET", "/")
        self.assertIn("Page 1 of 2", page1)
        self.assertEqual(page1.count("<tr><td>"), admin.PAGE_SIZE)
        _, _, page2 = self.request("GET", "/?page=2")
        self.assertEqual(page2.count("<tr><td>"), 154 - admin.PAGE_SIZE)

    def test_admin_refuses_non_loopback(self):
        original = admin.ADMIN_HOST
        try:
            admin.ADMIN_HOST = "0.0.0.0"
            with self.assertRaises(SystemExit):
                admin.make_server()
        finally:
            admin.ADMIN_HOST = original


if __name__ == "__main__":
    unittest.main()
