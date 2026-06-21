/**
 * RPCortex — modular documentation loader.
 *
 * docs.html is a thin shell. Each version's docs live in docs/<version>.html
 * (just the sidebar TOC + the article), listed in docs/versions.json. This
 * loader reads ?v=<version> (the version lives in the query so it never collides
 * with the in-page #section anchors), fetches that partial into #docs-mount,
 * builds the version switcher, wires the scroll-spy TOC, and scrolls to any
 * deep-linked #section after the content is in.
 *
 * Adding a new version = drop docs/vX.Y.Z.html + one entry in versions.json.
 */
(function () {
  'use strict';

  var mount = document.getElementById('docs-mount');
  if (!mount) return;
  var sw = document.getElementById('version-switcher');
  var heroSub = document.getElementById('docs-hero-sub');

  mount.innerHTML = '<p class="docs-loading">Loading documentation&hellip;</p>';

  function queryVersion() {
    var m = /[?&]v=([^&#]+)/.exec(location.search);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function initScrollSpy() {
    var sections = document.querySelectorAll('.docs-article h2[id]');
    var tocLinks = document.querySelectorAll('.docs-toc a');
    if (!sections.length || !('IntersectionObserver' in window)) return;
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          tocLinks.forEach(function (l) { l.classList.remove('active'); });
          var link = document.querySelector('.docs-toc a[href="#' + e.target.id + '"]');
          if (link) link.classList.add('active');
        }
      });
    }, { rootMargin: '-20% 0px -70% 0px' });
    sections.forEach(function (s) { obs.observe(s); });
  }

  function scrollToHash() {
    // The browser already tried to jump to #hash before the partial existed —
    // do it now that the content is in the DOM.
    if (location.hash.length > 1) {
      var el = document.getElementById(location.hash.slice(1));
      if (el) el.scrollIntoView();
    }
  }

  fetch('docs/versions.json')
    .then(function (r) { return r.json(); })
    .then(function (list) {
      var want = queryVersion();
      var v = null, i;
      for (i = 0; i < list.length; i++) { if (list[i].version === want) { v = list[i]; break; } }
      if (!v) for (i = 0; i < list.length; i++) { if (list[i]['default']) { v = list[i]; break; } }
      if (!v) v = list[0];

      if (sw) {
        sw.innerHTML = '<span>Version:</span>' + list.map(function (x) {
          var cls = (x.version === v.version) ? ' class="version-active"' : '';
          var tag = x.tag ? ' <small>' + x.tag + '</small>' : '';
          return '<a href="?v=' + x.version + '"' + cls + '>' + x.label + tag + '</a>';
        }).join('');
      }
      if (heroSub && v.heroSub) heroSub.innerHTML = v.heroSub;
      document.title = 'RPCortex — Documentation (' + v.version + ')';

      return fetch('docs/' + v.file).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      }).then(function (html) {
        mount.innerHTML = html;
        initScrollSpy();
        scrollToHash();
      });
    })
    .catch(function () {
      mount.innerHTML = '<p class="docs-loading">Could not load the documentation. '
        + '<a href="?v=v1.0.0">Try the latest &rarr;</a></p>';
    });
})();
