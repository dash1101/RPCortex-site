#!/usr/bin/env python3
"""Build rpc.novalabs.app from its sources.

    python3 site/build.py                  write the site into the repository root
    python3 site/build.py --out DIR        write a complete copy into DIR (for a preview)
    python3 site/build.py --status "text"  show a status bar line, whatever site.json says
    python3 site/build.py --check          build into a scratch folder and only check links

SOURCES
-------
  site/pages/*.html     one page each: a front-matter block, then the body
  site/docs/*.html      one documentation body per version (a contents list and an article)
  site/data/site.json   the nav, the footer, the status bar and where release data is read from
  site/data/docs.json   which documentation versions exist, and their order
  site/data/*.json      the roadmap and the older releases
  ds/                   the shared design system (a copy; see ds/README.md)

Releases are NOT built in. The Get page, the Releases page, the home page and the release
bar read releases.json and boards.json from the OS repository in the browser, so a release
reaches the site the moment its commit is pushed. See site/README.md.

The generated .html files are committed beside the sources, because GitHub Pages serves
the repository as it is. Edit the sources and rebuild, never the output. A build fails on a
broken link, a missing anchor or a placeholder left unfilled.
"""

import argparse
import html
import json
import os
import re
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

ASSETS = ("ds", "js", "css", "img", "data", "releases", "vela-tool", "logo.svg", "favicon.svg", "CNAME", ".nojekyll")


def load(name):
    with open(os.path.join(HERE, "data", name), encoding="utf-8") as f:
        return json.load(f)


def front_matter(text):
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.S)
    if not m:
        raise SystemExit("a page has no front matter")
    meta = {}
    for line in m.group(1).splitlines():
        k, _, v = line.partition(":")
        meta[k.strip()] = v.strip()
    return meta, m.group(2)


def rel_root(path, absolute=False):
    if absolute:
        return "/"
    depth = path.count("/")
    return "../" * depth if depth else "./"


def resolve(href, root):
    if re.match(r"^(https?:|mailto:|#|/)", href):
        return href
    return root + href


def doc_slugs():
    return {d["version"]: d["slug"] for d in load("docs.json") if d.get("version")}


def fix_href(href, root):
    """A link from carried content, written for the old flat site, as it must be written from `root`.

    The old pages used extensionless links (`packages`, `docs?v=v1.0.0#x`) that GitHub Pages
    resolved from the site root. Written out in full, they work from any folder."""
    if re.match(r"^(https?:|mailto:|tel:|#|/|\?|data:|javascript:)", href) or not href:
        return href
    h = href
    while h.startswith("../"):
        h = h[3:]
    h = re.sub(r"^\./", "", h)
    m = re.match(r"^([^?#]*)(.*)$", h)
    path, tail = m.group(1), m.group(2)
    if not path:
        return href
    q = re.match(r"^\?v=([^&#]+)(.*)$", tail)
    if path == "docs" and q and q.group(1) in doc_slugs():
        return "%sdocs/%s.html%s" % (root, doc_slugs()[q.group(1)], q.group(2))
    if "/" not in path and "." not in path:
        path += ".html"
    return root + path + tail


def fix_links(body, root):
    return re.sub(r'\b(href|src)="([^"]*)"', lambda m: '%s="%s"' % (m.group(1), fix_href(m.group(2), root)), body)


class Site:
    def __init__(self, status_override=None, releases_base=None):
        self.site = load("site.json")
        self.docs_cfg = load("docs.json")
        if releases_base:
            self.site["releases_base"] = releases_base
        self.noindex = set()
        self.social = ""
        if status_override is not None:
            self.site["status"] = {"text": status_override, "tone": "warn"}

    # ---- chrome -----------------------------------------------------------
    def brand(self, root, key):
        """The brand in the nav: the product's own wordmark where it has one, else mark and name. The footer
        uses the one-letter mark alone, because the wordmark is already in the header."""
        img = self.site.get(key)
        if img:
            return '<img class="wordmark" src="%s%s" alt="%s">' % (root, img, self.site["name"])
        return '<img src="%slogo.svg" alt="">%s' % (root, self.site["name"])

    def statusbars(self, root):
        out = ""
        s = self.site.get("status") or {}
        if s.get("text"):
            link = ""
            if s.get("link"):
                link = ' <a href="%s">%s</a>' % (resolve(s["link"], root), s.get("link_text", "More"))
            out += '<div class="statusbar" data-tone="%s">%s%s</div>' % (s.get("tone", "warn"), s["text"], link)
        if self.site.get("release_bar"):
            out += '<div class="statusbar" id="relbar" data-tone="ok" hidden></div>'
        return out

    def nav(self, active, root):
        links = ""
        for n in self.site["nav"]:
            cur = ' aria-current="page"' if n.get("key") and n["key"] == active else ""
            links += '<a href="%s"%s>%s</a>' % (resolve(n["href"], root), cur, n["label"])
        e = self.site["external"]
        links += '<a class="ext" href="%s" target="_blank" rel="noopener">%s</a>' % (e["href"], e["label"])
        return ('<header class="nav"><div class="wrap nav-in">'
                '<a class="brand" href="%s">%s</a>'
                '<button class="nav-toggle" aria-label="Menu" aria-expanded="false" aria-controls="menu"><span></span></button>'
                '<nav id="menu" class="menu" aria-label="Main">%s</nav></div></header>'
                % (root, self.brand(root, "brand_image_sm"), links))

    def footer(self, root):
        links = ""
        for n in self.site["footer"]:
            ext = ' target="_blank" rel="noopener"' if n["href"].startswith("http") else ""
            links += '<a href="%s"%s>%s</a>' % (resolve(n["href"], root), ext, n["label"])
        return ('<footer class="foot"><div class="wrap foot-in">'
                '<a class="brand" href="%s"><img src="%slogo.svg" alt="%s"></a>'
                '<div class="foot-links">%s</div><small>%s</small></div></footer>'
                % (root, root, self.site["name"], links, self.site["copyright"]))

    def page(self, meta, body, root):
        title = meta.get("window_title") or (meta["title"] if meta["title"] == self.site["name"]
                                             else "%s | %s" % (meta["title"], self.site["name"]))
        head_scripts = "".join('<script src="%s"></script>' % s for s in
                               filter(None, [x.strip() for x in meta.get("head_scripts", "").split(",")]))
        scripts = '<script src="%sds/ds.js"></script>' % root
        if self.site.get("release_bar") or meta.get("needs_releases"):
            scripts += '<script src="%sjs/releases.js"></script>' % root
        for s in filter(None, [x.strip() for x in meta.get("scripts", "").split(",")]):
            scripts += '<script src="%s%s"></script>' % (root, s)
        body = body.replace("<main>", '<main id="main">', 1)
        path = meta.get("path", "")
        url = self.site["url"] + ("" if path in ("", "index.html") else path)
        desc = html.escape(meta.get("description", ""), quote=True)
        ttl = html.escape(title, quote=True)
        social = (
            '<meta name="theme-color" content="#090f1d">'
            '<link rel="canonical" href="%s">'
            '<meta property="og:site_name" content="%s"><meta property="og:type" content="website">'
            '<meta property="og:title" content="%s"><meta property="og:description" content="%s">'
            '<meta property="og:url" content="%s"><meta property="og:image" content="%simg/og.png">'
            '<meta name="twitter:card" content="summary_large_image">'
            % (url, self.site["name"], ttl, desc, url, self.site["url"]))
        if meta.get("noindex"):
            social += '<meta name="robots" content="noindex">'
            self.noindex.add(path)
        self.social = social
        legacy = '<link rel="stylesheet" href="%scss/legacy.css">' % root if meta.get("legacy") else ""
        return ('<!doctype html>\n<html lang="en"><head><meta charset="utf-8">'
                '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
                '<title>%s</title><meta name="description" content="%s">%s'
                '<meta name="releases-base" content="%s">'
                '<link rel="icon" type="image/svg+xml" href="%sfavicon.svg">'
                '<link rel="preload" as="font" type="font/woff2" crossorigin href="%sds/fonts/BricolageGrotesque-latin.woff2">'
                '<link rel="preload" as="font" type="font/woff2" crossorigin href="%sds/fonts/InstrumentSans-latin.woff2">'
                '<link rel="stylesheet" href="%sds/ds.css"><link rel="stylesheet" href="%scss/rpc.css">%s%s'
                '</head><body><a class="skip" href="#main">Skip to content</a>%s%s%s%s%s</body></html>\n'
                % (html.escape(title), html.escape(meta.get("description", ""), quote=True), self.social,
                   html.escape(self.site.get("releases_base", ""), quote=True),
                   root, root, root, root, root, legacy, head_scripts,
                   self.statusbars(root), self.nav(meta.get("nav", ""), root), body,
                   self.footer(root), scripts))

    def roadmap(self):
        out = '<div class="road">'
        for e in load("roadmap.json")["entries"]:
            badge = {"done": "b-done", "active": "b-part", "planned": "b-late"}[e["tone"]]
            right = ""
            for b in e["blocks"]:
                if b["type"] == "p":
                    right += "<p>%s</p>" % b["html"]
                elif b["type"] == "label":
                    right += '<div class="tag" style="margin-top:14px">%s</div>' % b["html"]
                elif b["type"] == "note":
                    right += '<p class="progress-note">%s</p>' % b["html"]
                else:
                    right += "<ul>%s</ul>" % "".join('<li%s>%s</li>' % (' class="done"' if i["done"] else "", i["html"])
                                                    for i in b["items"])
            out += ('<article class="road-row"><div><div class="v">%s</div><div class="when"><span class="badge %s">%s</span></div></div>'
                    '<div>%s</div></article>' % (e["ver"], badge, e["status"], right))
        return out + "</div>"

    def fill(self, body, root):
        body = body.replace("{{root}}", root)
        if "{{roadmap}}" in body:
            body = body.replace("{{roadmap}}", fix_links(self.roadmap(), root))
        return body

    # ---- documentation versions -------------------------------------------
    def docs_pages(self, write):
        cfg = self.docs_cfg
        for d in cfg:
            with open(os.path.join(HERE, "docs", d["source"]), encoding="utf-8") as f:
                src = f.read()
            toc = re.search(r'<nav class="docs-toc">(.*?)</nav>', src, re.S)
            art = re.search(r'<article class="docs-article">(.*)</article>', src, re.S)
            if not art:
                raise SystemExit("%s has no article" % d["source"])
            links = re.findall(r'<a href="(#[^"]+)">(.*?)</a>', toc.group(1), re.S) if toc else []
            nav = '<nav class="docs-nav" aria-label="On this page"><div class="tag">On this page</div>%s</nav>' % "".join(
                '<a href="%s">%s</a>' % (h, t) for h, t in links)
            pills = "".join('<a class="pill%s" href="%s.html">%s%s</a>' % (
                " on" if x["slug"] == d["slug"] else "", x["slug"], x["label"],
                (' <small>%s</small>' % x["tag"]) if x.get("tag") else "") for x in cfg)
            main = ('<main><section class="wrap page-head"><div class="eyebrow"><span class="stripes" aria-hidden="true">'
                    '<i></i><i></i><i></i></span>Documentation</div><h1>%s</h1><p class="lede">%s</p>'
                    '<div class="pills" role="navigation" aria-label="Documentation version">%s</div></section>'
                    '<div class="wrap docs">%s<article class="docs-body prose legacy-prose">%s</article></div></main>'
                    % (d["title"], d["hero"], pills, nav, fix_links(art.group(1), "../")))
            meta = {"title": d["title"], "description": d["hero"], "nav": "docs", "legacy": "1", "scripts": "js/spy.js", "path": "docs/%s.html" % d["slug"]}
            write("docs/%s.html" % d["slug"], self.page(meta, main, "../"))
        default = [d for d in cfg if d.get("default")][0]["slug"]
        mapping = {d["version"]: d["slug"] for d in cfg if d.get("version")}
        redirect = ('<main><section class="wrap page-head"><h1>Documentation</h1><p class="lede">Choose a version.</p>'
                    '<div class="pills">%s</div></section></main>'
                    '<script>(function(){var m=%s,q=/[?&]v=([^&#]+)/.exec(location.search);'
                    'var s=q&&m[decodeURIComponent(q[1])];location.replace("docs/"+(s||"%s")+".html"+location.hash);})();</script>'
                    % ("".join('<a class="pill" href="docs/%s.html">%s</a>' % (d["slug"], d["label"]) for d in cfg),
                       json.dumps(mapping), default))
        write("docs.html", self.page({"title": "Documentation", "description": "RPCortex documentation.", "nav": "docs", "path": "docs.html", "noindex": "1"},
                                     redirect, "./"))


def build(out_dir, status=None, releases_base=None):
    s = Site(status, releases_base)
    written = []

    def write(rel, text):
        path = os.path.join(out_dir, rel)
        os.makedirs(os.path.dirname(path) or out_dir, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
        written.append(rel)

    pdir = os.path.join(HERE, "pages")
    for fn in sorted(os.listdir(pdir)):
        with open(os.path.join(pdir, fn), encoding="utf-8") as f:
            meta, body = front_matter(f.read())
        root = rel_root(meta["path"], bool(meta.get("absolute")))
        body = s.fill(body, root)
        if meta.get("legacy"):
            body = fix_links(body, root)
        write(meta["path"], s.page(meta, body, root))
    s.docs_pages(write)
    # the older-releases data the browser reads: one source (site/data), one published copy
    os.makedirs(os.path.join(out_dir, "data"), exist_ok=True)
    shutil.copy(os.path.join(HERE, "data", "legacy.json"), os.path.join(out_dir, "data", "legacy.json"))
    # the files a crawler asks for
    base = s.site["url"]
    urls = [base + ("" if r == "index.html" else r) for r in written if r not in s.noindex]
    with open(os.path.join(out_dir, "sitemap.xml"), "w", encoding="utf-8") as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n%s</urlset>\n'
                % "".join("  <url><loc>%s</loc></url>\n" % u for u in sorted(urls)))
    with open(os.path.join(out_dir, "robots.txt"), "w", encoding="utf-8") as f:
        f.write("User-agent: *\nAllow: /\n\nSitemap: %ssitemap.xml\n" % base)
    return written



def check(out_dir, written):
    """Every local link and anchor in the generated pages resolves."""
    problems = []
    pages = {}
    for rel in written:
        with open(os.path.join(out_dir, rel), encoding="utf-8") as fh:
            pages[rel] = fh.read()
    ids = {p: set(re.findall(r'\bid="([^"]+)"', t)) for p, t in pages.items()}
    for p, text in pages.items():
        if "{{" in re.sub(r"<script.*?</script>", "", text, flags=re.S):
            problems.append("%s: an unfilled placeholder: %s" % (p, re.search(r"\{\{[^}]*\}\}", text).group(0)))
        for attr, url in re.findall(r'\b(href|src)="([^"]*)"', text):
            if re.match(r"^(https?:|mailto:|tel:|data:|javascript:)", url) or not url:
                continue
            path, _, frag = url.partition("#")
            path = path.partition("?")[0]
            if path.startswith("/"):
                target = path[1:]
                if not target or target.endswith("/"):
                    target += "index.html"
            else:
                target = p if not path else os.path.normpath(os.path.join(os.path.dirname(p), path))
            full = os.path.join(out_dir, target)
            if os.path.isdir(full):
                target = os.path.join(target, "index.html")
                full = os.path.join(out_dir, target)
            if not os.path.exists(full):
                problems.append("%s: %s=%s does not exist" % (p, attr, url))
            elif frag and target in ids and frag not in ids[target]:
                problems.append("%s: %s has no #%s" % (p, target, frag))
    return problems


def ds_drift():
    """Warn when ds/ differs from the other site's copy; the two are meant to be identical."""
    import hashlib
    mine, theirs = os.path.join(ROOT, "ds"), os.path.join(os.path.dirname(ROOT), "NovaLabs", "ds")
    if not os.path.isdir(theirs):
        return []
    out = []
    for dp, _, fs in os.walk(mine):
        for f in fs:
            a = os.path.join(dp, f)
            b = os.path.join(theirs, os.path.relpath(a, mine))
            if not os.path.exists(b) or hashlib.sha256(open(a, "rb").read()).hexdigest() != hashlib.sha256(open(b, "rb").read()).hexdigest():
                out.append(os.path.relpath(a, ROOT))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", help="write a complete copy here instead of the repository root")
    ap.add_argument("--status", help="status bar text for this build")
    ap.add_argument("--releases-base", help="read releases.json and boards.json from here (a preview with sample data)")
    ap.add_argument("--check", action="store_true", help="build to a scratch folder and only check")
    a = ap.parse_args()

    out = a.out or (tempfile.mkdtemp(prefix="rpcortex-") if a.check else ROOT)
    if out != ROOT:
        os.makedirs(out, exist_ok=True)
        for item in ASSETS:
            src = os.path.join(ROOT, item)
            dst = os.path.join(out, item)
            if os.path.isdir(src):
                shutil.copytree(src, dst, dirs_exist_ok=True)
            elif os.path.exists(src):
                shutil.copy(src, dst)
    for f in ds_drift():
        print("  ~ %s differs from the other site's copy (see ds/README.md)" % f)
    written = build(out, a.status, a.releases_base)
    # the browser tool is copied in by tools/sync-vela-tool.sh, not generated; its links are checked too
    tool = [p for p in ("vela-tool/index.html",) if os.path.exists(os.path.join(out, p))]
    problems = check(out, written + tool)
    for p in problems:
        print("  ! " + p)
    print("%d pages%s" % (len(written), "" if not problems else ", %d problem(s)" % len(problems)))
    if a.check:
        shutil.rmtree(out, ignore_errors=True)
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
