/* ===========================================================================
   Get RPCortex — version, then board, then what to actually do.
   ---------------------------------------------------------------------------
   Everything here is driven by releases/catalog.json. Adding a version or a
   board is a row of data, not markup and not a new page — which matters
   because the two OS lines install in completely different ways and that split
   will only get wider.

     v2 (native)  — one .uf2, dragged onto the drive the board presents. No
                    drivers, no serial, nothing to install on the host.
     v1 (Python)  — needs MicroPython underneath, then the files copied over
                    USB serial by the web installer.

   A picker that pretended those were the same thing would have to lie about
   one of them.
   =========================================================================== */
(function () {
  'use strict';

  var catalog = null;
  var chosenVersion = null;

  var elVersions = document.getElementById('versionCards');
  var elDevices  = document.getElementById('deviceCards');
  var elResult   = document.getElementById('resultPanel');
  var stepDevice = document.getElementById('stepDevice');
  var stepResult = document.getElementById('stepResult');

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---- step 1: versions ----------------------------------------------------

  function renderVersions() {
    elVersions.innerHTML = '';
    catalog.versions.forEach(function (v) {
      var card = document.createElement('button');
      card.className = 'get-card';
      card.type = 'button';
      card.innerHTML =
        '<div class="get-card-top">' +
          '<span class="get-card-title">' + esc(v.name) + '</span>' +
          (v.tag ? '<span class="get-tag get-tag-' + esc(v.tag) + '">' + esc(v.tag) + '</span>' : '') +
        '</div>' +
        '<div class="get-card-sub">&ldquo;' + esc(v.codename) + '&rdquo; &middot; ' +
          (v.kind === 'native' ? 'C++' : 'MicroPython') + '</div>' +
        '<p class="get-card-body">' + esc(v.blurb) + '</p>';
      card.addEventListener('click', function () { pickVersion(v, card); });
      elVersions.appendChild(card);
    });

    var def = catalog.versions.filter(function (v) { return v.default; })[0];
    if (def) pickVersion(def, elVersions.children[catalog.versions.indexOf(def)]);
  }

  function pickVersion(v, card) {
    chosenVersion = v;
    Array.prototype.forEach.call(elVersions.children, function (c) {
      c.classList.remove('is-chosen');
    });
    if (card) card.classList.add('is-chosen');
    renderDevices();
    stepDevice.classList.remove('is-hidden');
    stepResult.classList.add('is-hidden');
  }

  // ---- step 2: boards ------------------------------------------------------

  function renderDevices() {
    elDevices.innerHTML = '';
    var ids = Object.keys(chosenVersion.devices);
    ids.forEach(function (id) {
      var d = chosenVersion.devices[id];
      var card = document.createElement('button');
      card.className = 'get-card get-card-sm';
      card.type = 'button';
      card.innerHTML =
        '<span class="get-card-title">' + esc(d.label) + '</span>' +
        '<div class="get-card-sub">' + esc(d.chip) +
          (d.wireless ? ' &middot; wireless' : '') + '</div>';
      card.addEventListener('click', function () {
        Array.prototype.forEach.call(elDevices.children, function (c) {
          c.classList.remove('is-chosen');
        });
        card.classList.add('is-chosen');
        renderResult(id, d);
      });
      elDevices.appendChild(card);
    });
  }

  // ---- step 3: what to do --------------------------------------------------

  function renderResult(id, d) {
    stepResult.classList.remove('is-hidden');
    if (chosenVersion.install === 'uf2') renderUf2(id, d);
    else                                 renderInstaller(id, d);
    stepResult.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function renderUf2(id, d) {
    // The .uf2 is the whole install. Saying so plainly is the point: anyone
    // arriving from v1 expects to need a tool, and does not.
    elResult.innerHTML =
      '<div class="get-result-main">' +
        '<a class="btn-primary get-dl" href="' + esc(d.uf2) + '" download>' +
          'Download ' + esc(chosenVersion.id) + ' for ' + esc(d.label) +
        '</a>' +
        '<p class="get-dl-sub">One file. No drivers, no serial tool, nothing to install here.</p>' +
      '</div>' +
      '<ol class="get-steps">' +
        '<li>Hold the <strong>BOOTSEL</strong> button and plug the board into USB.</li>' +
        '<li>It appears as a drive called <strong>RP2350</strong> or <strong>RPI-RP2</strong>.</li>' +
        '<li>Drag the <code>.uf2</code> onto it. The board reboots by itself.</li>' +
        '<li>Open a serial terminal at <strong>115200</strong> baud &mdash; PuTTY, ' +
            '<code>screen</code>, anything.</li>' +
      '</ol>' +
      '<div class="get-aside">' +
        '<h4>After the first install</h4>' +
        '<p>The device updates itself. <code>update check</code> looks for a newer ' +
           'release and <code>update install</code> applies it, verified against a ' +
           'checksum before anything is written. You should not need this page again.</p>' +
        '<p class="get-alt">Building an updater or flashing over SWD? The raw image ' +
           'is <a href="' + esc(d.bin) + '" download>' + esc(id) + '.bin</a>.</p>' +
      '</div>';
  }

  function renderInstaller(id, d) {
    // v1 needs MicroPython underneath and a serial copy, so this hands over to
    // the installer rather than pretending a download is enough.
    elResult.innerHTML =
      '<div class="get-result-main">' +
        '<a class="btn-primary get-dl" href="install">Open the web installer</a>' +
        '<p class="get-dl-sub">' + esc(chosenVersion.name) + ' installs over USB from your browser.</p>' +
      '</div>' +
      '<ol class="get-steps">' +
        '<li>Flash <a href="https://micropython.org/download/" target="_blank" rel="noopener">' +
            'MicroPython 1.25+</a> to the board first &mdash; RPCortex runs on top of it.</li>' +
        '<li>Open the installer in Chrome, Edge or another Chromium browser. ' +
            'The Web Serial API does not exist in Firefox or Safari.</li>' +
        '<li>Pick <strong>' + esc(chosenVersion.id) + '</strong> in the version list and connect.</li>' +
      '</ol>' +
      '<div class="get-aside">' +
        '<h4>Prefer to do it yourself?</h4>' +
        '<p>The archive is <a href="' + esc(chosenVersion.rpc) + '" download>' +
           esc(chosenVersion.id) + '.rpc</a> &mdash; a ZIP of the filesystem, if you would ' +
           'rather copy it across with your own tooling.</p>' +
        '<p class="get-alt">Wanting the drag-and-drop install instead? ' +
           'That is <a href="switch">v2</a>, which needs no MicroPython underneath.</p>' +
      '</div>';
  }

  // ---- load ----------------------------------------------------------------

  fetch('releases/catalog.json', { cache: 'no-store' })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (j) {
      catalog = j;
      renderVersions();
    })
    .catch(function (e) {
      // Say what failed and give a way through it. A picker that cannot load
      // its list should not leave someone with nothing.
      elVersions.innerHTML =
        '<p class="get-loading">Could not load the release list (' + esc(e.message) + ').<br>' +
        'The downloads are on <a href="https://github.com/dash1101/RPCortex/tree/main/releases" ' +
        'target="_blank" rel="noopener">GitHub</a> in the meantime.</p>';
    });
})();
