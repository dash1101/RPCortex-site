/* Release data for the whole site.
   ------------------------------------------------------------------------
   A release is cut in the OS repository by tools/release.py, which writes
   releases/releases.json (the history) and releases/boards.json (which boards
   have run which build). This file reads both straight from `main` in the
   browser, so a release reaches the site the moment its commit is pushed and
   nothing here is edited for an ordinary release. Older releases, which that
   history does not contain, are in data/legacy.json on this site.

   Everything degrades: if the data cannot be read, the pages keep the static
   text they were built with and say where the releases are on GitHub.

   Pages use it through window.RPCReleases.load(), and by marking elements:
     data-rel="display|build|long|date|summary|codename|url|tag"
   which are filled with the newest release when the data arrives.            */
(function () {
  'use strict';

  var meta = document.querySelector('meta[name="releases-base"]');
  var BASE = (meta && meta.content) || 'https://raw.githubusercontent.com/dash1101/RPCortex/main/releases/';
  var src = (document.currentScript && document.currentScript.src) || '';
  var ROOT = src.replace(/js\/releases\.js.*$/, '');
  // A base that is not a full URL is relative to the site root, not to the page.
  if (!/^https?:/.test(BASE)) BASE = ROOT + BASE;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function getJSON(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' ' + r.status);
      return r.json();
    });
  }

  var cache = null;
  function load() {
    if (cache) return cache;
    cache = Promise.all([
      getJSON(BASE + 'releases.json').catch(function () { return null; }),
      getJSON(BASE + 'boards.json').catch(function () { return null; }),
      getJSON(ROOT + 'data/legacy.json').catch(function () { return { releases: [] }; })
    ]).then(function (r) {
      var list = r[0] && r[0].releases ? r[0].releases : [];
      return {
        live: list.length > 0,
        releases: list,                                  // newest first
        boards: r[1] && r[1].boards ? r[1].boards : null,
        legacy: r[2].releases || []
      };
    });
    return cache;
  }

  function newest(d) { return d.releases[0] || null; }

  function longName(r) { return r.display + ' (build ' + r.build + ')'; }

  function fmtDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    if (!m) return iso || '';
    var mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return parseInt(m[3], 10) + ' ' + mon[parseInt(m[2], 10) - 1] + ' ' + m[1];
  }

  function bar(d) {
    var el = document.getElementById('relbar');
    var r = newest(d);
    if (!el || !r) return;
    el.innerHTML = '<strong>' + esc(longName(r)) + '</strong> is out &middot; <a href="' +
      ROOT + 'releases.html#' + esc(r.tag) + '">what changed</a>';
    el.hidden = false;
  }

  function bind(d) {
    var r = newest(d);
    if (!r) return;
    var vals = { display: r.display, build: r.build, long: longName(r), date: fmtDate(r.date),
                 summary: r.summary, codename: r.codename, url: r.url, tag: r.tag };
    Array.prototype.forEach.call(document.querySelectorAll('[data-rel]'), function (el) {
      var v = vals[el.getAttribute('data-rel')];
      if (v == null) return;
      if (el.tagName === 'A') el.href = v; else el.textContent = v;
    });
  }

  window.RPCReleases = { load: load, esc: esc, fmtDate: fmtDate, longName: longName, newest: newest,
                         ROOT: ROOT, BASE: BASE };

  function ready() { load().then(function (d) { bar(d); bind(d); }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready); else ready();
})();
