#!/usr/bin/env python3
"""Tests for how release notes are shown: js/releases.js (noteSections) and the Releases page.

    python3 site/test_releases.py

Releases from v2.01-beta on file their notes under new, improved, fixed, security, changed and
issues; v2.00-beta was published with added, changed, fixed and limitations. Both must show,
each in its own order, with empty sections left out. The page test loads the generated
releases.html in headless Chromium with the release data replaced by the fixtures below, so it
needs the site built (python3 site/build.py) and Playwright with Chromium.
"""
import json
import mimetypes
import os
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SITE = "https://site.test/"

OLD = {
    "tag": "v2.0.0", "display": "v2.00-beta", "version": "2.00", "build": 483, "codename": "Vela II",
    "date": "2026-10-28", "prerelease": True, "summary": "The first one.", "assets": [],
    "notes": {"added": ["An added thing."], "changed": ["A changed thing."], "fixed": ["A `fixed` thing."],
              "limitations": ["A limitation."]},
}
NEW = {
    "tag": "v2.01-beta", "display": "v2.01-beta", "version": "2.01", "build": 600, "codename": "Vela II",
    "date": "2026-12-01", "prerelease": True, "summary": "The next one.", "assets": [],
    "notes": {"issues": ["An open issue."], "changed": ["A changed thing."], "security": [],
              "fixed": ["A fixed thing."], "new": ["A new thing."], "improved": ["An improvement."]},
}


class Releases(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from playwright.sync_api import sync_playwright
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch()

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()

    def open_page(self, releases):
        page = self.browser.new_page()

        def site(route):
            path = route.request.url[len(SITE):].split("?")[0].split("#")[0] or "index.html"
            full = os.path.join(ROOT, path)
            if not os.path.isfile(full):
                return route.fulfill(status=404, body="")
            route.fulfill(path=full, content_type=mimetypes.guess_type(full)[0] or "application/octet-stream")

        def data(route):
            if route.request.url.endswith("releases.json"):
                return route.fulfill(status=200, content_type="application/json", body=json.dumps({"schema": 1, "releases": releases}))
            route.fulfill(status=404, body="")

        page.route(SITE + "**", site)
        page.route("https://raw.githubusercontent.com/**", data)
        page.goto(SITE + "releases.html")
        page.wait_for_selector("#releaseList article.rel")
        return page

    def sections(self, page, notes):
        return page.evaluate("(n) => window.RPCReleases.noteSections(n).map(s => s.title)", notes)

    # ---- noteSections -----------------------------------------------------------------
    def test_new_keys_in_their_order_with_empty_ones_left_out(self):
        page = self.open_page([NEW])
        self.assertEqual(self.sections(page, NEW["notes"]),
                         ["New", "Improved", "Fixed", "Changed", "Known issues"])
        page.close()

    def test_old_keys_keep_the_order_they_were_published_in(self):
        page = self.open_page([OLD])
        self.assertEqual(self.sections(page, OLD["notes"]), ["Added", "Changed", "Fixed", "Known limitations"])
        page.close()

    def test_a_key_neither_set_knows_is_shown_last(self):
        page = self.open_page([NEW])
        self.assertEqual(self.sections(page, {"fixed": ["x"], "thanks": ["y"], "new": ["z"]}), ["New", "Fixed", "Thanks"])
        self.assertEqual(self.sections(page, None), [])
        page.close()

    # ---- the page -----------------------------------------------------------------------
    def test_the_page_shows_both_kinds_of_release(self):
        page = self.open_page([NEW, OLD])
        got = page.evaluate("""() => Array.from(document.querySelectorAll('#releaseList article.rel'))
            .filter(a => a.id.startsWith('v2')).map(a => [a.id, Array.from(a.querySelectorAll('h4')).map(h => h.textContent)])""")
        self.assertEqual(got, [
            ["v2.01-beta", ["New", "Improved", "Fixed", "Changed", "Known issues"]],
            ["v2.0.0", ["Added", "Changed", "Fixed", "Known limitations"]],
        ])
        self.assertEqual(page.eval_on_selector("#v2\\.0\\.0 li code", "e => e.textContent"), "fixed")
        page.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
