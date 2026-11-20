/* The Releases page: every release, newest first, with its notes. Read from the
   release history (js/releases.js) plus the older releases kept on this site. */
(function () {
  'use strict';
  var R = window.RPCReleases;
  var esc = R.esc;
  var mount = document.getElementById('releaseList');

  function sections(notes) {
    return R.noteSections(notes).map(function (s) {
      return '<h4>' + esc(s.title) + '</h4><ul>' + s.items.map(function (i) { return '<li>' + R.noteHTML(i) + '</li>'; }).join('') + '</ul>';
    }).join('');
  }

  function badge(r) {
    if (r.prerelease) return '<span class="badge b-part">pre-release</span>';
    if (r.stable) return '<span class="badge b-done">latest stable</span>';
    return '';
  }

  function row(r, isLegacy) {
    var notes = sections(r.notes);
    var name = isLegacy ? esc(r.display + ' ' + r.codename) : esc(r.display);
    var meta = isLegacy ? badge(r) : badge(r) + '<br>build ' + esc(r.build);
    var links = [];
    if (r.notes_page) links.push('<a href="' + esc(r.notes_page) + '">Full release notes</a>');
    if (r.url) links.push('<a href="' + esc(r.url) + '" target="_blank" rel="noopener">GitHub release</a>');
    var details = (notes || links.length) ?
      '<details><summary>Notes</summary><div class="notes">' + notes + (links.length ? '<p style="margin-top:14px">' + links.join(' &middot; ') + '</p>' : '') + '</div></details>' : '';
    return '<article class="rel" id="' + esc(r.tag) + '"><div><div class="v">' + name + '</div><div class="d">' + esc(R.fmtDate(r.date)) +
      '</div></div><p>' + esc(r.summary || '') + '</p><div class="meta">' + meta + '</div>' + details + '</article>';
  }

  R.load().then(function (d) {
    var html = '';
    if (d.live) html += d.releases.map(function (r) { return row(r, false); }).join('');
    else html += '<p class="dl-meta" style="margin-bottom:18px">The v2 release list could not be read. It is on ' +
      '<a href="https://github.com/dash1101/RPCortex/releases" target="_blank" rel="noopener">GitHub</a>.</p>';
    html += d.legacy.map(function (r) { return row(r, true); }).join('');
    mount.innerHTML = html;
    if (location.hash.length > 1) {
      var el = document.getElementById(location.hash.slice(1));
      if (el) el.scrollIntoView();
    }
  });
})();
