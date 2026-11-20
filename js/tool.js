/* The tool page (tool.html).
   ------------------------------------------------------------------------
   The tool itself is tools/web in the RPCortex (v2) repository, copied into
   vela-tool/ by tools/sync-vela-tool.sh. This page does not embed it: Web
   Serial in a frame needs the frame to be allowed the port, and a page of its
   own is simpler. It links to it once vela-tool/SOURCE.json names the commit
   the copy came from (the placeholder's names none), shows that commit, and
   otherwise says what to use meanwhile. Either way it says when the browser has no Web Serial.   */
(function () {
  'use strict';
  var box = document.getElementById('toolLaunch');
  var open = document.getElementById('toolOpen');
  var stamp = document.getElementById('toolStamp');
  var base = open.getAttribute('data-tool');

  if (!('serial' in navigator)) document.getElementById('noSerial').classList.remove('is-hidden');

  function state(s) { box.setAttribute('data-tool-state', s); }

  // SOURCE.json is always there: the placeholder's has no commit, and the copy the sync script makes
  // names the one it came from. One request, and nothing that 404s while the tool is not here yet.
  fetch(base + 'SOURCE.json', { cache: 'no-cache' }).then(function (r) {
    return r.ok ? r.json() : null;
  }).then(function (src) {
    if (!src || !src.commit) { state('pending'); return; }
    open.href = base;
    state('ready');
    stamp.textContent = 'Built from RPCortex ' + String(src.commit).slice(0, 8) + (src.date ? ', ' + src.date : '') +
      (src.dirty ? ' (with uncommitted changes)' : '');
  }).catch(function () { state('pending'); });
})();
