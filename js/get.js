/* Get RPCortex: version, then board, then what to actually do.
   ------------------------------------------------------------------------
   The two operating systems install in completely different ways, so the page
   does not pretend they are one flow:

     v2 (native)  one .uf2 dragged onto the drive the board presents; no drivers,
                  no serial, nothing to install on the host
     v1 (Python)  MicroPython underneath, then the files copied over USB serial
                  by the web installer

   The v2 side reads the release history (js/releases.js). If that cannot be
   read it falls back to the images the update channel always points at, so the
   page never has nothing to offer.                                           */
(function () {
  'use strict';
  var R = window.RPCReleases;
  var esc = R.esc;
  var elVersions = document.getElementById('versionCards');
  var elBoards = document.getElementById('boardCards');
  var elResult = document.getElementById('resultPanel');
  var stepBoard = document.getElementById('stepBoard');
  var stepResult = document.getElementById('stepResult');

  var RAW = 'https://raw.githubusercontent.com/dash1101/RPCortex/main/releases/';
  var FALLBACK_BOARDS = [
    { id: 'pico2_w', name: 'Pico 2 W', chip: 'RP2350', radio: 'Wi-Fi and Bluetooth', status: 'verified' },
    { id: 'pico2', name: 'Pico 2', chip: 'RP2350', radio: 'none', status: 'untested' },
    { id: 'pico_w', name: 'Pico W', chip: 'RP2040', radio: 'Wi-Fi and Bluetooth', status: 'untested' },
    { id: 'pico', name: 'Pico', chip: 'RP2040', radio: 'none', status: 'untested' }
  ];

  var data, v2, v1, chosen, board;

  function kb(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB'; }

  function asset(rel, boardId, kind) {
    if (!rel) return null;
    for (var i = 0; i < rel.assets.length; i++) {
      var a = rel.assets[i];
      if (a.board === boardId && a.kind === kind) return a;
    }
    return null;
  }

  function pressed(container, btn) {
    Array.prototype.forEach.call(container.children, function (c) { c.setAttribute('aria-pressed', 'false'); });
    btn.setAttribute('aria-pressed', 'true');
  }

  function card(html, onclick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'get-card';
    b.setAttribute('aria-pressed', 'false');
    b.innerHTML = html;
    b.addEventListener('click', function () { onclick(b); });
    return b;
  }

  // ---- step 1 -----------------------------------------------------------------
  function renderVersions() {
    elVersions.innerHTML = '';
    var cards = [];
    if (v2) {
      var label = data.live ? R.longName(v2) : 'v2.0-beta';
      cards.push({ id: 'v2', el: card(
        '<b>RPCortex ' + esc(label) + '</b><small>&ldquo;Vela II&rdquo; &middot; C++ &middot; one file</small>' +
        '<span class="badge ' + (v2.prerelease ? 'b-part' : 'b-done') + '">' + (v2.prerelease ? 'beta pre-release' : 'stable') + '</span>' +
        '<small>' + esc(v2.summary || 'Rewritten in C++: no interpreter, both cores, and packages that cannot take the device down.') + '</small>',
        function (b) { pick('v2', b); }) });
    }
    if (v1) {
      cards.push({ id: 'v1', el: card(
        '<b>RPCortex ' + esc(v1.display) + ' ' + esc(v1.codename) + '</b><small>MicroPython &middot; installs over USB from this page</small>' +
        '<span class="badge b-done">latest stable</span>' +
        '<small>The MicroPython line. Still the one to use if you rely on Python packages.</small>',
        function (b) { pick('v1', b); }) });
    }
    cards.forEach(function (c) { elVersions.appendChild(c.el); });
    if (cards.length) { cards[0].el.click(); }
  }

  function pick(which, btn) {
    chosen = which;
    pressed(elVersions, btn);
    if (which === 'v2') {
      renderBoards();
      stepBoard.classList.remove('is-hidden');
    } else {
      stepBoard.classList.add('is-hidden');
      renderV1();
    }
  }

  // ---- step 2 (v2 only) ---------------------------------------------------------
  function renderBoards() {
    elBoards.innerHTML = '';
    var boards = data.boards || FALLBACK_BOARDS;
    boards.forEach(function (b, i) {
      var ran = b.status === 'verified';
      var el = card('<b>' + esc(b.name) + '</b><small>' + esc(b.chip) + (b.radio && b.radio !== 'none' ? ' &middot; ' + esc(b.radio) : '') + '</small>' +
        '<span class="badge ' + (ran ? 'b-done' : 'b-part') + '">' + (ran ? 'run on hardware' : 'not booted yet') + '</span>',
        function (btn) { board = b; pressed(elBoards, btn); renderV2(); });
      elBoards.appendChild(el);
      if (i === 0) el.click();
    });
  }

  // ---- step 3 ---------------------------------------------------------------------
  function renderV2() {
    stepResult.classList.remove('is-hidden');
    var uf2 = asset(v2, board.id, 'uf2');
    var bin = asset(v2, board.id, 'bin');
    var url = uf2 ? uf2.url : RAW + 'rpcortex-v2-' + board.id + '.uf2';
    var binUrl = bin ? bin.url : RAW + 'rpcortex-v2-' + board.id + '.bin';
    var fname = uf2 ? uf2.file : 'rpcortex-v2-' + board.id + '.uf2';
    var meta = uf2 ? '<p class="dl-meta">' + esc(fname) + ' &middot; ' + kb(uf2.size) + ' &middot; SHA-256 ' + esc(uf2.sha256) + '</p>' : '';
    var untested = board.status === 'verified' ? '' :
      '<p class="warn"><strong>This board has not been booted yet.</strong> The image builds and passes its checks, ' +
      'but no one has run it on this hardware. Every result on this site is from a Pico 2 W.</p>';
    elResult.innerHTML =
      '<div><a class="btn btn-primary" href="' + esc(url) + '">Download for ' + esc(board.name) + '</a></div>' + meta + untested +
      '<ol>' +
        '<li>Hold <strong>BOOTSEL</strong> and plug the board into USB. It appears as a drive called <strong>RP2350</strong> or <strong>RPI-RP2</strong>.</li>' +
        '<li>Drag the <code>.uf2</code> onto it. The board restarts by itself.</li>' +
        '<li>Open a serial terminal at <strong>115200 baud</strong>: PuTTY, <code>screen</code>, anything. The first start asks for a root password once.</li>' +
      '</ol>' +
      '<p class="dl-meta">Prefer not to drag a file? <a href="flash.html?board=' + esc(board.id) + '">Install from your browser</a> (Chrome, Edge or Opera, optional).</p>' +
      '<div class="info"><strong>After the first install</strong> the device updates itself. <code>update check</code> looks for a newer release and ' +
      '<code>update install</code> applies it, checked against a checksum before anything is written, with a copy of the old firmware kept to go back to. ' +
      'You should not need this page again. The raw image, for your own flashing tools, is <a href="' + esc(binUrl) + '">the .bin</a>.</div>' +
      '<p class="warn"><strong>Coming from v1?</strong> v2 replaces the firmware entirely, so installing it removes MicroPython and everything stored under it. Save anything worth keeping first.</p>';
  }

  function renderV1() {
    stepResult.classList.remove('is-hidden');
    elResult.innerHTML =
      '<div><a class="btn btn-primary" href="install.html">Open the web installer</a></div>' +
      '<p class="dl-meta">RPCortex ' + esc(v1.display) + ' installs over USB from your browser.</p>' +
      '<ol>' +
        '<li>Flash <a href="https://micropython.org/download/" target="_blank" rel="noopener">MicroPython 1.25+</a> to the board first. RPCortex runs on top of it.</li>' +
        '<li>Open the installer in Chrome, Edge or another Chromium browser. The Web Serial API does not exist in Firefox or Safari.</li>' +
        '<li>Pick <strong>' + esc(v1.display) + '</strong> in the version list and connect.</li>' +
      '</ol>' +
      '<p class="dl-meta">Runs on the Pico 2 W, Pico W, Pico and ESP32-S3.</p>' +
      '<div class="info"><strong>Prefer to do it yourself?</strong> The archive is <a href="' + esc(v1.rpc) + '">' + esc(v1.display) +
      '.rpc</a>, a ZIP of the filesystem. Want the drag-and-drop install instead? That is <a href="switch.html">v2</a>, which needs no MicroPython underneath.</div>';
  }

  // ---- load ---------------------------------------------------------------------------
  R.load().then(function (d) {
    data = d;
    v2 = d.live ? R.newest(d) : { prerelease: true, assets: [], summary: '' };
    for (var i = 0; i < d.legacy.length; i++) { if (d.legacy[i].stable) { v1 = d.legacy[i]; break; } }
    renderVersions();
  }).catch(function (e) {
    elVersions.innerHTML = '<p class="dl-meta">Could not load the release list (' + esc(e.message) + '). ' +
      'The downloads are on <a href="https://github.com/dash1101/RPCortex/releases" target="_blank" rel="noopener">GitHub</a> in the meantime.</p>';
  });
})();
