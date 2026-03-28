/**
 * RPCortex — Package browser + serial installer for packages.html.
 * Depends on: serial-device.js (window.RPC).
 *
 * Downloads .pkg files from the repo and pushes them to a connected
 * device via the _xfer shell command — no raw REPL, no reboot.
 */
(function () {
  'use strict';

  var Device   = RPC.Device;
  var sleep    = RPC.sleep;
  var toBase64 = RPC.toBase64;
  var esc      = RPC.esc;

  /* ── URL helper ───────────────────────────────────────────────── */

  /**
   * Ensure a URL uses HTTPS.  The repo index.json stores http:// URLs
   * for compatibility with the on-device HTTP client, but browsers on
   * a secure page need HTTPS to avoid mixed-content blocks.
   */
  function ensureHttps(url) {
    if (url && url.indexOf('http://') === 0) {
      return 'https://' + url.slice(7);
    }
    return url;
  }

  /* ── DOM refs ─────────────────────────────────────────────────── */
  var connectBtn     = document.getElementById('connectBtn');
  var disconnectBtn  = document.getElementById('disconnectBtn');
  var connectDot     = document.getElementById('connectDot');
  var connectLabel   = document.getElementById('connectLabel');
  var pkgContainer   = document.getElementById('pkgContainer');
  var xferOverlay    = document.getElementById('xferOverlay');
  var xferTitle      = document.getElementById('xferTitle');
  var xferSub        = document.getElementById('xferSub');
  var xferProgress   = document.getElementById('xferProgress');
  var xferLog        = document.getElementById('xferLog');
  var xferCloseBtn   = document.getElementById('xferCloseBtn');

  /* ── State ────────────────────────────────────────────────────── */
  var activeDevice = null;
  var packages     = [];

  /* ── UI: Connection ───────────────────────────────────────────── */
  function setConnected(connected) {
    connectDot.className     = 'connect-dot ' + (connected ? 'on' : 'off');
    connectLabel.textContent = connected ? 'Device connected' : 'No device connected';
    connectLabel.className   = 'connect-status' + (connected ? ' connected' : '');
    connectBtn.style.display    = connected ? 'none' : '';
    disconnectBtn.style.display = connected ? '' : 'none';
    updateInstallButtons();
  }

  connectBtn.addEventListener('click', async function () {
    if (!('serial' in navigator)) {
      alert('Web Serial API not supported. Use Chrome 89+ or Edge 89+.');
      return;
    }
    try {
      var port = await navigator.serial.requestPort();
      activeDevice = new Device(port);
      await activeDevice.open();
      setConnected(true);

      /* Provoke a fresh prompt to confirm the shell is alive */
      await sleep(300);
      activeDevice.clearBuffer();
      await activeDevice.write('\r\n');
      await sleep(300);

      if (activeDevice.rxBuffer.indexOf('>') === -1) {
        connectLabel.textContent = 'Connected (make sure the shell is at a prompt)';
      }
      activeDevice.clearBuffer();
    } catch (e) {
      if (e.name !== 'NotFoundError') {
        alert('Connection failed: ' + (e.message || String(e)));
      }
    }
  });

  disconnectBtn.addEventListener('click', async function () {
    if (activeDevice) {
      try { await activeDevice.close(); } catch (e) {}
      activeDevice = null;
    }
    setConnected(false);
  });

  /* ── UI: Transfer overlay ─────────────────────────────────────── */
  function showOverlay(pkgName) {
    xferTitle.textContent      = 'Installing ' + pkgName + '\u2026';
    xferSub.textContent        = 'Transferring to device over serial.';
    xferProgress.style.width   = '0%';
    xferLog.innerHTML          = '';
    xferCloseBtn.style.display = 'none';
    xferOverlay.classList.add('visible');
  }

  function hideOverlay() {
    xferOverlay.classList.remove('visible');
  }

  function xferLogLine(text, cls) {
    var el = document.createElement('span');
    el.className = 'xfer-log-line ' + (cls || 'xfer-log-dim');
    el.textContent = text;
    xferLog.appendChild(el);
    xferLog.scrollTop = xferLog.scrollHeight;
  }

  xferCloseBtn.addEventListener('click', hideOverlay);

  /* ── _xfer protocol (shared by remote + local installs) ──────── */
  async function _doXfer(data, destPath, pkgName) {
    /* Send _xfer command and wait for device ready */
    xferLogLine('[:] Sending transfer command\u2026', 'xfer-log-info');
    activeDevice.clearBuffer();
    await activeDevice.write('_xfer ' + destPath + '\r');
    await activeDevice.waitFor('XFER_READY', 8000);
    xferLogLine('[@] Device ready. Sending data\u2026', 'xfer-log-ok');
    xferProgress.style.width = '15%';

    /* Send base64 chunks */
    var CHUNK       = 128;
    var totalChunks = Math.ceil(data.length / CHUNK);
    for (var i = 0; i < data.length; i += CHUNK) {
      var chunk   = data.slice(i, i + CHUNK);
      var b64Line = toBase64(chunk) + '\n';
      await activeDevice.write(b64Line);
      var chunkIdx = Math.floor(i / CHUNK) + 1;
      xferProgress.style.width = (15 + Math.round((chunkIdx / totalChunks) * 57)) + '%';
      await sleep(12);
    }

    xferLogLine('[:] All data sent (' + data.length + ' bytes). Finalizing\u2026', 'xfer-log-info');
    xferProgress.style.width = '74%';

    await activeDevice.write('XFER_END\n');
    await activeDevice.waitFor('XFER_OK', 10000);
    xferLogLine('[@] File written to device.', 'xfer-log-ok');
    xferProgress.style.width = '80%';

    xferLogLine('[:] Installing package on device\u2026', 'xfer-log-info');
    xferSub.textContent = 'Installing on device\u2026';

    var completeOut = await activeDevice.waitFor('XFER_COMPLETE', 30000);
    xferProgress.style.width = '100%';

    var installOk = false;
    if (completeOut.indexOf('XFER_INSTALLED') !== -1) {
      installOk = true;
      xferLogLine('[@] Package \'' + pkgName + '\' installed successfully!', 'xfer-log-ok');
      xferTitle.textContent = pkgName + ' installed!';
      xferSub.textContent   = 'The package is now available on the device.';
    } else if (completeOut.indexOf('XFER_INSTALL_FAILED') !== -1) {
      xferLogLine('[?] Package install reported failure. It may already be installed.', 'xfer-log-warn');
      xferTitle.textContent = 'Install issue';
      xferSub.textContent   = 'The package may already be installed. Check the device shell.';
    } else if (completeOut.indexOf('XFER_INSTALL_ERR') !== -1) {
      var errMatch = completeOut.match(/XFER_INSTALL_ERR:(.*)/);
      var errMsg = errMatch ? errMatch[1].trim() : 'unknown error';
      xferLogLine('[-] Install error: ' + errMsg, 'xfer-log-err');
      xferTitle.textContent = 'Install failed';
      xferSub.textContent   = errMsg;
    } else {
      xferLogLine('[@] Transfer complete.', 'xfer-log-ok');
      xferTitle.textContent = 'Transfer complete';
      xferSub.textContent   = 'File written to ' + destPath;
    }

    var rawLines = completeOut.split('\n');
    for (var li = 0; li < rawLines.length; li++) {
      var rl = rawLines[li].trim();
      if (rl && rl.indexOf('XFER_') === -1 && rl.length > 1) {
        xferLogLine('  ' + rl, 'xfer-log-dim');
      }
    }

    if (installOk) {
      if (activeDevice) {
        try { await activeDevice.close(); } catch (e) {}
        activeDevice = null;
      }
      setConnected(false);
      xferLogLine('[@] Device disconnected.', 'xfer-log-ok');
    }

    return installOk;
  }

  /* ── Install from repo URL ─────────────────────────────────────── */
  async function installToDevice(pkg) {
    if (!activeDevice) { alert('Connect a device first.'); return; }
    var pkgName = pkg.name;
    showOverlay(pkgName);
    try {
      xferLogLine('[:] Downloading ' + pkgName + '.pkg\u2026', 'xfer-log-info');
      var resp = await fetch(ensureHttps(pkg.url));
      if (!resp.ok) throw new Error('HTTP ' + resp.status + ' downloading package');
      var data = new Uint8Array(await resp.arrayBuffer());
      xferLogLine('[@] Downloaded ' + data.length + ' bytes.', 'xfer-log-ok');
      xferProgress.style.width = '10%';
      var destPath = '/Nebula/pkg/tmp_' + pkgName.toLowerCase() + '.pkg';
      await _doXfer(data, destPath, pkgName);
    } catch (e) {
      xferLogLine('[-] Error: ' + (e.message || String(e)), 'xfer-log-err');
      xferTitle.textContent = 'Transfer failed';
      xferSub.textContent   = e.message || String(e);
    }
    xferCloseBtn.style.display = '';
  }

  /* ── Install from local file ───────────────────────────────────── */
  async function installLocalToDevice(fileData, pkgName) {
    if (!activeDevice) { alert('Connect a device first.'); return; }
    showOverlay(pkgName);
    try {
      var data = new Uint8Array(fileData);
      xferLogLine('[@] Loaded ' + data.length + ' bytes from local file.', 'xfer-log-ok');
      xferProgress.style.width = '10%';
      var safeName = pkgName.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/\.pkg$/, '');
      var destPath = '/Nebula/pkg/tmp_' + safeName + '.pkg';
      await _doXfer(data, destPath, pkgName);
    } catch (e) {
      xferLogLine('[-] Error: ' + (e.message || String(e)), 'xfer-log-err');
      xferTitle.textContent = 'Transfer failed';
      xferSub.textContent   = e.message || String(e);
    }
    xferCloseBtn.style.display = '';
  }

  /* ── Render packages ──────────────────────────────────────────── */
  function updateInstallButtons() {
    var btns = document.querySelectorAll('.pkg-install-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].disabled = !activeDevice;
      btns[i].title    = activeDevice ? 'Install to connected device' : 'Connect a device first';
    }
  }

  function renderPackages(pkgs) {
    if (!pkgs || pkgs.length === 0) {
      pkgContainer.innerHTML = '<div class="pkg-empty">No packages found in the repository.</div>';
      return;
    }

    var html = '<div class="pkg-grid">';
    for (var i = 0; i < pkgs.length; i++) {
      var p = pkgs[i];
      html += '<div class="pkg-card">' +
        '<div class="pkg-card-header">' +
          '<span class="pkg-card-name">' + esc(p.name) + '</span>' +
          '<span class="pkg-card-ver">v' + esc(p.ver) + '</span>' +
        '</div>' +
        '<div class="pkg-card-author">by ' + esc(p.author || 'unknown') + '</div>' +
        '<div class="pkg-card-desc">' + esc(p.desc || 'No description.') + '</div>' +
        '<div class="pkg-card-actions">' +
          '<button class="pkg-install-btn" data-pkg-idx="' + i + '"' +
            (activeDevice ? '' : ' disabled') +
            ' title="' + (activeDevice ? 'Install to connected device' : 'Connect a device first') + '">' +
            'Install to Device</button>' +
          '<span class="pkg-cli-hint">pkg install ' + esc(p.name) + '</span>' +
        '</div>' +
      '</div>';
    }
    html += '</div>';
    pkgContainer.innerHTML = html;

    /* Bind click handlers */
    var btns = pkgContainer.querySelectorAll('.pkg-install-btn');
    for (var j = 0; j < btns.length; j++) {
      btns[j].addEventListener('click', (function (idx) {
        return function () { installToDevice(packages[idx]); };
      })(parseInt(btns[j].getAttribute('data-pkg-idx'), 10)));
    }
  }

  /* ── Fetch packages from repo ─────────────────────────────────── */
  var REPO_INDEX = 'https://raw.githubusercontent.com/dash1101/RPCortex-repo/main/repo/index.json';

  async function loadPackages() {
    try {
      var resp = await fetch(REPO_INDEX);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      var data = await resp.json();
      packages = data.packages || [];
      renderPackages(packages);
    } catch (e) {
      pkgContainer.innerHTML = '<div class="pkg-error">Failed to load packages: ' +
        esc(e.message || String(e)) + '</div>';
    }
  }

  /* ── Browser check ────────────────────────────────────────────── */
  if (!('serial' in navigator)) {
    connectBtn.disabled = true;
    connectBtn.title = 'Web Serial not supported in this browser';
    document.getElementById('serialNote').innerHTML =
      '<span style="color:var(--yellow);">Web Serial API not available.</span> ' +
      'Use Chrome 89+ or Edge 89+ to install packages directly to a device. ' +
      'You can still use <code>pkg install</code> from the shell.';
  }

  /* ── Local .pkg drag-and-drop ─────────────────────────────────── */
  var dropZone       = document.getElementById('pkgDropZone');
  var dropFileInfo   = document.getElementById('dropFileInfo');
  var dropFileName   = document.getElementById('dropFileName');
  var dropInstallBtn = document.getElementById('dropInstallBtn');
  var dropFileInput  = document.getElementById('pkgLocalFileInput');
  var _dropFile      = null;

  function setDropFile(file) {
    if (!file || !file.name.endsWith('.pkg')) {
      alert('Please select a .pkg file.');
      return;
    }
    _dropFile = file;
    dropFileName.textContent = file.name;
    dropFileInfo.style.display = '';
    dropInstallBtn.disabled = !activeDevice;
    dropZone.classList.add('has-file');
  }

  if (dropZone) {
    dropZone.addEventListener('dragover', function (e) {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', function () {
      dropZone.classList.remove('drag-over');
    });
    dropZone.addEventListener('drop', function (e) {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      var file = e.dataTransfer.files[0];
      if (file) setDropFile(file);
    });
  }

  if (dropFileInput) {
    dropFileInput.addEventListener('change', function () {
      if (dropFileInput.files[0]) setDropFile(dropFileInput.files[0]);
    });
  }

  if (dropInstallBtn) {
    dropInstallBtn.addEventListener('click', async function () {
      if (!_dropFile || !activeDevice) return;
      var buf = await _dropFile.arrayBuffer();
      installLocalToDevice(buf, _dropFile.name.replace(/\.pkg$/, ''));
    });
  }

  /* Keep drop install button enabled/disabled in sync with connection */
  var _origSetConnected = setConnected;
  setConnected = function (connected) {
    _origSetConnected(connected);
    if (dropInstallBtn && _dropFile) dropInstallBtn.disabled = !connected;
  };

  /* ── Init ─────────────────────────────────────────────────────── */
  loadPackages();

})();
