/**
 * RPCortex — OS update logic for update.html.
 * Depends on: serial-device.js (window.RPC), JSZip.
 *
 * Connects to a running RPCortex Launchpad shell and pushes OS files
 * one at a time via the _xfer shell command.  User data is preserved:
 *   /Users/          — home directories kept intact
 *   /Nebula/         — registry, package cache, logs kept intact
 *
 * After all files are transferred the page sends `reboot` to restart
 * the device with the updated OS.
 */
(function () {
  'use strict';

  var Device   = RPC.Device;
  var sleep    = RPC.sleep;
  var toBase64 = RPC.toBase64;
  var esc      = RPC.esc;

  /* ── Constants ────────────────────────────────────────────────── */
  var CHUNK_SIZE   = 128;   // base64 chunk bytes (matches packages.js)
  var XFER_TIMEOUT = 30000; // ms to wait for XFER_COMPLETE per file

  /* ── File filter ──────────────────────────────────────────────── */

  /**
   * Return true if this relative path from the .rpc archive should
   * be pushed to the device during an OS update.
   *
   * Skips:  website/, repo/, dev artifacts, AND all of /Nebula/ and
   *         /Users/ to preserve user data and settings.
   */
  function shouldUpdate(relPath) {
    var skip = [
      'website/', 'repo/', '.git/', '.git',
      '__pycache__/', 'CLAUDE', 'temp/', 'tests/',
      'Users/', 'Nebula/'
    ];
    for (var i = 0; i < skip.length; i++) {
      var s = skip[i];
      if (relPath === s || relPath.startsWith(s) ||
          relPath.indexOf('/' + s) !== -1) return false;
    }
    /* Preserve user-installed package entries (matches rpc_install.py behaviour) */
    if (relPath.endsWith('programs.lp')) return false;
    var exts = ['.py', '.cfg', '.lp'];
    for (var j = 0; j < exts.length; j++) {
      if (relPath.endsWith(exts[j])) return true;
    }
    return relPath === 'main.py';
  }

  /* ── UI helpers ───────────────────────────────────────────────── */

  var connectBtn    = document.getElementById('connectBtn');
  var disconnectBtn = document.getElementById('disconnectBtn');
  var connectDot    = document.getElementById('connectDot');
  var connectLabel  = document.getElementById('connectLabel');
  var startBtn      = document.getElementById('startBtn');
  var cancelBtn     = document.getElementById('cancelBtn');
  var progressFill  = document.getElementById('progressFill');
  var statusText    = document.getElementById('statusText');
  var logBody       = document.getElementById('logBody');
  var optServer     = document.getElementById('optServer');
  var optLocal      = document.getElementById('optLocal');
  var versionSelect = document.getElementById('versionSelect');
  var localInput    = document.getElementById('localInput');
  var localLabel    = document.getElementById('localLabel');
  var localName     = document.getElementById('localName');
  var sourcePanel   = document.getElementById('sourcePanel');
  var progressPanel = document.getElementById('progressPanel');

  var activeDevice = null;
  var _cancel      = false;

  function setConnected(connected) {
    connectDot.className     = 'connect-dot ' + (connected ? 'on' : 'off');
    connectLabel.textContent = connected ? 'Device connected' : 'No device connected';
    connectLabel.className   = 'connect-status' + (connected ? ' connected' : '');
    connectBtn.style.display    = connected ? 'none' : '';
    disconnectBtn.style.display = connected ? '' : 'none';
    startBtn.disabled = !connected;
    startBtn.title    = connected ? 'Start OS update' : 'Connect a device first';
  }

  function appendLog(text) {
    var line = document.createElement('span');
    line.className = 'log-line';
    if      (text.startsWith('[@]')) line.classList.add('log-ok');
    else if (text.startsWith('[:]')) line.classList.add('log-info');
    else if (text.startsWith('[?]')) line.classList.add('log-warn');
    else if (text.startsWith('[-]')) line.classList.add('log-err');
    else                             line.classList.add('log-muted');
    line.textContent = text;
    logBody.appendChild(line);
    logBody.scrollTop = logBody.scrollHeight;
  }

  function clearLog() { logBody.innerHTML = ''; }

  function setProgress(pct) {
    progressFill.style.width = Math.min(100, Math.round(pct)) + '%';
  }

  function setStatus(msg) {
    statusText.textContent = msg;
  }

  /* ── Source radio toggle ──────────────────────────────────────── */
  var radios = document.querySelectorAll('input[name="source"]');
  radios.forEach(function (r) {
    r.addEventListener('change', function () {
      var isLocal = document.querySelector('input[name="source"]:checked').value === 'local';
      optServer.classList.toggle('selected', !isLocal);
      optLocal.classList.toggle('selected', isLocal);
      localLabel.style.display = isLocal ? '' : 'none';
      versionSelect.disabled = isLocal;
    });
  });

  localInput.addEventListener('change', function () {
    var f = localInput.files[0];
    if (f) localName.textContent = f.name;
  });

  /* ── Connect / disconnect ─────────────────────────────────────── */
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

      /* Tap Enter to confirm the shell is alive */
      await sleep(300);
      activeDevice.clearBuffer();
      await activeDevice.write('\r\n');
      await sleep(400);

      var buf = activeDevice.rxBuffer;
      if (buf.indexOf('>') === -1) {
        connectLabel.textContent = 'Connected — make sure the shell is at a prompt';
        connectLabel.style.color = 'var(--yellow)';
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

  /* ── Single-file transfer via _xfer ──────────────────────────── */
  async function xferFile(devicePath, content) {
    activeDevice.clearBuffer();
    await activeDevice.write('_xfer ' + devicePath + '\r');

    await activeDevice.waitFor('XFER_READY', 8000);

    var totalChunks = Math.ceil(content.length / CHUNK_SIZE);
    for (var i = 0; i < content.length; i += CHUNK_SIZE) {
      var chunk   = content.slice(i, i + CHUNK_SIZE);
      var b64Line = toBase64(chunk) + '\n';
      await activeDevice.write(b64Line);
      await sleep(12);
    }

    await activeDevice.write('XFER_END\n');
    await activeDevice.waitFor('XFER_OK', 10000);
    await activeDevice.waitFor('XFER_COMPLETE', XFER_TIMEOUT);
  }

  /* ── Main update flow ─────────────────────────────────────────── */
  async function runUpdate(zipData) {
    _cancel = false;
    clearLog();
    setProgress(0);
    setStatus('Extracting archive\u2026');
    sourcePanel.style.display  = 'none';
    progressPanel.style.display = '';
    cancelBtn.style.display = '';
    startBtn.style.display  = 'none';

    try {
      appendLog('[:] Extracting archive\u2026');
      var zip  = await JSZip.loadAsync(zipData);
      var all  = [];
      zip.forEach(function (p, e) { if (!e.dir) all.push(p); });

      /* Detect and strip top-level directory prefix */
      var prefix = '';
      if (all.length > 0) {
        var slash = all[0].indexOf('/');
        if (slash > 0) {
          var cand = all[0].slice(0, slash + 1);
          if (all.every(function (p) { return p.startsWith(cand); })) {
            prefix = cand;
          }
        }
      }
      if (prefix) appendLog('[:] Stripping prefix: ' + prefix);

      /* Build filtered list */
      var toSend = [];
      zip.forEach(function (zipPath, entry) {
        if (entry.dir) return;
        var rel = prefix ? zipPath.slice(prefix.length) : zipPath;
        if (rel && shouldUpdate(rel)) {
          toSend.push({ zipPath: zipPath, devicePath: '/' + rel, entry: entry });
        }
      });

      appendLog('[@] ' + toSend.length + ' file(s) to transfer.');
      if (toSend.length === 0) {
        appendLog('[-] No installable files found in archive. Is this a valid .rpc file?');
        _finish(false);
        return;
      }

      /* Transfer files one by one */
      for (var i = 0; i < toSend.length; i++) {
        if (_cancel) {
          appendLog('[?] Update cancelled by user.');
          _finish(false);
          return;
        }

        var item    = toSend[i];
        var content = await item.entry.async('uint8array');
        var pct     = (i / toSend.length) * 90;

        setProgress(pct);
        setStatus('Transferring ' + (i + 1) + ' / ' + toSend.length + '\u2026');
        appendLog('[:] [' + (i + 1) + '/' + toSend.length + '] ' + item.devicePath);

        try {
          await xferFile(item.devicePath, content);
        } catch (e) {
          appendLog('[-] Transfer failed for ' + item.devicePath + ': ' + (e.message || String(e)));
          appendLog('[?] Update aborted. Partial files may have been written.');
          _finish(false);
          return;
        }
      }

      appendLog('[@] All files transferred successfully.');
      setProgress(95);
      setStatus('Rebooting device\u2026');
      appendLog('[:] Sending reboot command\u2026');

      await sleep(500);
      activeDevice.clearBuffer();
      try {
        await activeDevice.write('reboot\r\n');
      } catch (e) { /* ignore — device may close the port on reboot */ }

      await sleep(1000);
      setProgress(100);
      appendLog('[@] Reboot command sent. Device is restarting with the new OS.');
      _finish(true);

    } catch (e) {
      appendLog('[-] Error: ' + (e.message || String(e)));
      _finish(false);
    }
  }

  function _finish(success) {
    cancelBtn.style.display = 'none';
    if (success) {
      setStatus('Update complete! Device is rebooting\u2026');
      document.getElementById('donePanel').style.display = '';
    } else {
      setStatus('Update failed or cancelled.');
      document.getElementById('retryBtn').style.display  = '';
      startBtn.style.display = '';
    }
  }

  /* ── Start button ─────────────────────────────────────────────── */
  startBtn.addEventListener('click', async function () {
    if (!activeDevice) { alert('Connect a device first.'); return; }

    var sourceVal = document.querySelector('input[name="source"]:checked').value;
    var zipData;

    if (sourceVal === 'local') {
      var file = localInput.files[0];
      if (!file) { alert('Please select a .rpc file.'); return; }
      zipData = await file.arrayBuffer();
    } else {
      var url = versionSelect.value;
      setStatus('Downloading\u2026');
      clearLog();
      sourcePanel.style.display   = 'none';
      progressPanel.style.display = '';
      cancelBtn.style.display = '';
      startBtn.style.display  = 'none';
      appendLog('[:] Downloading ' + url + '\u2026');
      try {
        var resp = await fetch(url);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        zipData = await resp.arrayBuffer();
        appendLog('[@] Downloaded ' + (zipData.byteLength / 1024).toFixed(0) + ' KB.');
      } catch (e) {
        appendLog('[-] Download failed: ' + (e.message || String(e)));
        _finish(false);
        return;
      }
    }

    await runUpdate(zipData);
  });

  /* ── Cancel ───────────────────────────────────────────────────── */
  cancelBtn.addEventListener('click', function () {
    _cancel = true;
    appendLog('[?] Cancel requested\u2026');
  });

  /* ── Retry ────────────────────────────────────────────────────── */
  document.getElementById('retryBtn').addEventListener('click', function () {
    document.getElementById('retryBtn').style.display  = 'none';
    document.getElementById('donePanel').style.display = 'none';
    sourcePanel.style.display   = '';
    progressPanel.style.display = 'none';
    startBtn.style.display      = '';
    clearLog();
    setProgress(0);
    setStatus('Ready.');
  });

  /* ── Browser check ────────────────────────────────────────────── */
  if (!('serial' in navigator)) {
    connectBtn.disabled = true;
    connectBtn.title    = 'Web Serial not supported in this browser';
    document.getElementById('serialNote').innerHTML =
      '<span style="color:var(--yellow);">Web Serial API not available.</span> ' +
      'Use Chrome 89+ or Edge 89+ to update over USB. ' +
      'You can also update from the shell: <code>update from-file /path/to/os.rpc</code>';
  }

  /* ── Init ─────────────────────────────────────────────────────── */
  setConnected(false);
  progressPanel.style.display = 'none';

})();
