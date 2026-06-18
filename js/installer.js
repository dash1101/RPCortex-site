/**
 * RPCortex — OS installer logic for install.html.
 * Depends on: serial-device.js (window.RPC), JSZip.
 */
(function () {
  'use strict';

  var Device   = RPC.Device;
  var sleep    = RPC.sleep;
  var toBase64 = RPC.toBase64;

  /* ── Constants ────────────────────────────────────────────────── */
  var CHUNK = 512;

  function getSelectedVersion() {
    var sel = document.getElementById('versionSelect');
    if (!sel || !sel.value) return { file: 'releases/download/v0.9.1/RPC-Pulsar-b9-Release.rpc', label: 'RPCortex Pulsar v0.9.1' };
    var opt = sel.options[sel.selectedIndex];
    var label = opt ? opt.text.replace(/\s+\u2014.*$/, '').trim() : 'unknown';
    return { file: sel.value, label: label };
  }

  /* ── Version picker — populated from releases/releases.json ──── */
  async function loadReleases() {
    var sel = document.getElementById('versionSelect');
    if (!sel) return;
    try {
      var resp = await fetch('releases/releases.json');
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      var groups = await resp.json();

      sel.innerHTML = '';
      var defaultSet = false;

      for (var gi = 0; gi < groups.length; gi++) {
        var g     = groups[gi];
        var label = g.group + (g.groupLabel ? ' (' + g.groupLabel + ')' : '');
        var og    = document.createElement('optgroup');
        og.label  = label;

        var rels = g.releases || [];
        for (var ri = 0; ri < rels.length; ri++) {
          var r   = rels[ri];
          var opt = document.createElement('option');
          opt.value       = r.file;
          opt.textContent = r.name + ' ' + r.version + '-' + r.subversion +
                            (r.tag ? ' \u2014 ' + r.tag : '');
          if (r.default && !defaultSet) {
            opt.selected = true;
            defaultSet   = true;
          }
          og.appendChild(opt);
        }
        sel.appendChild(og);
      }

      sel.disabled = false;
    } catch (e) {
      sel.innerHTML = '<option value="releases/download/v0.9.1/RPC-Pulsar-b9-Release.rpc">RPCortex Pulsar v0.9.1 \u2014 latest</option>';
      sel.disabled  = false;
    }
  }

  /* ── File filter ──────────────────────────────────────────────── */
  function shouldInstall(relPath) {
    var skip = ['website/', 'repo/', '.git', '__pycache__', 'CLAUDE'];
    for (var i = 0; i < skip.length; i++) {
      var s = skip[i];
      if (relPath.startsWith(s) || relPath.includes('/' + s)) return false;
    }
    var exts = ['.py', '.cfg', '.lp', '.mpy', '.json'];   // .mpy: compiled; .json: bundled repo index
    for (var j = 0; j < exts.length; j++) {
      if (relPath.endsWith(exts[j])) return true;
    }
    return false;
  }

  /* ── Raw-REPL file helpers ────────────────────────────────────── */

  // Low-level write: stream base64 chunks to the device, appending.
  function writeFileRaw(device, devicePath, content) {
    return (async function () {
      if (content.length === 0) {
        await device.execRaw("f=open('" + devicePath + "','w');f.close()");
        return;
      }
      for (var i = 0; i < content.length; i += CHUNK) {
        var chunk = content.slice(i, i + CHUNK);
        var b64   = toBase64(chunk);
        var mode  = (i === 0) ? 'wb' : 'ab';
        await device.execRaw(
          "import ubinascii;f=open('" + devicePath + "','" + mode + "');" +
          "f.write(ubinascii.a2b_base64('" + b64 + "'));f.close()"
        );
      }
    })();
  }

  // Ask the device for a file's size, or -1 if it doesn't exist.
  async function deviceFileSize(device, devicePath) {
    var out = await device.execRaw(
      "import uos\n" +
      "try:\n print('SZ',uos.stat('" + devicePath + "')[6])\n" +
      "except Exception:\n print('SZ',-1)"
    );
    var m = (out || '').match(/SZ\s+(-?\d+)/);
    return m ? parseInt(m[1], 10) : -1;
  }

  // Verified write: write, then confirm the on-device byte count matches.
  // Retries up to 3x. This turns the old "silently missing/truncated file"
  // failure mode (raw-REPL marker desync after exiting a running RPCortex)
  // into either a correct write or a clear, named error.
  function writeFile(device, devicePath, content, onLog) {
    return (async function () {
      for (var attempt = 1; attempt <= 3; attempt++) {
        try {
          await writeFileRaw(device, devicePath, content);
          var got = await deviceFileSize(device, devicePath);
          if (got === content.length) return;            // verified OK
          if (onLog) onLog('[?] ' + devicePath + ' size ' + got + '/' +
                           content.length + ' — retry ' + attempt + '/3');
        } catch (e) {
          if (onLog) onLog('[?] write error on ' + devicePath + ': ' +
                           (e.message || e) + ' — retry ' + attempt + '/3');
        }
        await sleep(120);
      }
      throw new Error('Failed to write ' + devicePath +
                      ' (size never matched after 3 attempts)');
    })();
  }

  var _createdDirs = new Set();
  function ensureDirs(device, devicePath) {
    return (async function () {
      var parts = devicePath.split('/').filter(Boolean);
      var cur   = '';
      for (var i = 0; i < parts.length - 1; i++) {
        cur += '/' + parts[i];
        if (!_createdDirs.has(cur)) {
          await device.execRaw(
            "import uos\ntry:\n uos.mkdir('" + cur + "')\nexcept OSError:\n pass"
          );
          _createdDirs.add(cur);
        }
      }
    })();
  }

  /* ── Prepare device ───────────────────────────────────────────────
     Default (fullWipe=false): remove only the OS code (/Core) so stale
     modules can't linger, then let the install overwrite the built-in
     packages and main.py. User data is PRESERVED — /Users, /Vela
     (registry, WiFi, accounts, logs, pkg cache) and any installed
     packages are left untouched.
     fullWipe=true: erase the entire filesystem (factory clean install). */
  async function prepareDevice(device, onLog, fullWipe) {
    if (fullWipe) {
      onLog('[:] Clean install — wiping entire filesystem...');
      await device.execRaw(
        'import uos\n' +
        'def _d(p):\n' +
        ' for n in uos.listdir(p):\n' +
        '  f=p.rstrip("/")+"/"+n\n' +
        '  try:_d(f);uos.rmdir(f)\n' +
        '  except:uos.remove(f)\n' +
        '_d("/")\n'
      );
      onLog('[@] Device filesystem cleared.');
    } else {
      onLog('[:] Removing old OS code (/Core) — keeping your data...');
      await device.execRaw(
        'import uos\n' +
        'def _d(p):\n' +
        ' try:\n' +
        '  for n in uos.listdir(p):\n' +
        '   f=p.rstrip("/")+"/"+n\n' +
        '   try:_d(f);uos.rmdir(f)\n' +
        '   except:uos.remove(f)\n' +
        ' except OSError:\n' +
        '  pass\n' +
        '_d("/Core")\n'
      );
      onLog('[@] Old OS code removed.  Kept: /Users, /Vela, installed packages.');
    }
  }

  /* ── Main install function ────────────────────────────────────── */
  var _cancelInstall = false;

  async function runInstall(device, getZipData, onLog, onProgress, onDone, onError, fullWipe) {
    _cancelInstall = false;
    _createdDirs.clear();

    try {
      onLog('[:] Preparing device (exiting RPCortex if it is running)...');
      await device.enterRawREPL();
      onLog('[@] REPL ready.');

      var zipData;
      if (typeof getZipData === 'string') {
        onLog('[:] Downloading ' + getSelectedVersion().label + '...');
        var resp = await fetch(getZipData);
        if (!resp.ok) throw new Error('Download failed: HTTP ' + resp.status);
        zipData = await resp.arrayBuffer();
        onLog('[@] Downloaded ' + (zipData.byteLength / 1024).toFixed(0) + ' KB.');
      } else {
        zipData = getZipData;
        onLog('[@] Loaded ' + (zipData.byteLength / 1024).toFixed(0) + ' KB from file.');
      }

      onLog('[:] Extracting archive...');
      var zip = await JSZip.loadAsync(zipData);

      var allPaths = [];
      zip.forEach(function (p, e) { if (!e.dir) allPaths.push(p); });
      var prefix = '';
      if (allPaths.length > 0) {
        var slash = allPaths[0].indexOf('/');
        if (slash > 0) {
          var candidate = allPaths[0].slice(0, slash + 1);
          if (allPaths.every(function (p) { return p.startsWith(candidate); })) {
            prefix = candidate;
          }
        }
      }
      if (prefix) onLog('[:] Stripping archive prefix: ' + prefix);

      // .rpc images may be source (.py) OR compiled (.mpy) — both install fine
      // (main.py and Core/rpc_stub.py always stay source). The device loader
      // imports a module's .mpy transparently.
      var toInstall = [];
      zip.forEach(function (zipPath, entry) {
        if (entry.dir) return;
        var relPath = prefix ? zipPath.slice(prefix.length) : zipPath;
        if (relPath && shouldInstall(relPath)) {
          toInstall.push({ zipPath: zipPath, relPath: relPath, entry: entry });
        }
      });

      onLog('[@] ' + toInstall.length + ' files to install.');
      await prepareDevice(device, onLog, fullWipe);

      // Drop any stale .py/.mpy counterpart of a module we're about to write.
      // MicroPython imports X.py BEFORE X.mpy, so a leftover source file would
      // shadow a freshly-installed compiled module (and vice-versa) — this is
      // why a .py-install -> .mpy-update appeared to "do nothing". A clean wipe
      // already cleared everything; this matters for the keep-data path (where
      // /Packages built-ins are overwritten rather than removed).
      if (!fullWipe) {
        var counterparts = [];
        for (var k = 0; k < toInstall.length; k++) {
          var dp = '/' + toInstall[k].relPath, other = null;
          if (dp.slice(-4) === '.mpy') other = dp.slice(0, -4) + '.py';
          else if (dp.slice(-3) === '.py' && dp.slice(-7) !== 'main.py') other = dp.slice(0, -3) + '.mpy';
          if (other) counterparts.push(other);
        }
        if (counterparts.length) {
          var pyList = '[' + counterparts.map(function (p) { return JSON.stringify(p); }).join(',') + ']';
          await device.execRaw(
            'import uos\n' +
            'for _f in ' + pyList + ':\n' +
            ' try:uos.remove(_f)\n' +
            ' except:pass\n'
          );
          onLog('[@] Cleared stale .py/.mpy counterparts.');
        }
      }

      for (var i = 0; i < toInstall.length; i++) {
        if (_cancelInstall) { onLog('[?] Installation cancelled.'); return; }
        var item       = toInstall[i];
        var devicePath = '/' + item.relPath;
        var content    = await item.entry.async('uint8array');
        onProgress((i + 1) / toInstall.length);
        onLog('[:] [' + (i + 1) + '/' + toInstall.length + '] ' + devicePath);
        await ensureDirs(device, devicePath);
        await writeFile(device, devicePath, content, onLog);
      }

      onLog('[@] All files written & verified.');
      onLog('[:] Rebooting device...');
      await device.exitRawREPL();
      await sleep(200);
      try { await device.write('import machine; machine.reset()\r\n'); } catch (e) {}
      await sleep(500);
      await device.close();
      onLog('[@] Done! Device is rebooting.');
      onDone();
    } catch (e) {
      try { await device.close(); } catch (_) {}
      onError(e.message || String(e));
    }
  }

  /* ── UI State Machine ─────────────────────────────────────────── */
  var states   = ['Idle', 'Connected', 'Installing', 'Done', 'Error'];
  var stateEls = {
    Idle       : document.getElementById('stateIdle'),
    Connected  : document.getElementById('stateConnected'),
    Installing : document.getElementById('stateInstalling'),
    Done       : document.getElementById('stateDone'),
    Error      : document.getElementById('stateError')
  };

  var transferPanelEl = document.getElementById('transferPanel');

  function showState(name) {
    states.forEach(function (s) {
      stateEls[s].classList.toggle('active', s === name);
    });
    var showTransfer = (name === 'Connected');
    if (transferPanelEl) transferPanelEl.classList.toggle('visible', showTransfer);
  }

  /* ── Element refs ─────────────────────────────────────────────── */
  var connectBtn      = document.getElementById('connectBtn');
  var installBtn      = document.getElementById('installBtn');
  var disconnectLink  = document.getElementById('disconnectLink');
  var cancelBtn       = document.getElementById('cancelBtn');
  var retryBtn        = document.getElementById('retryBtn');
  var installAgainBtn = document.getElementById('installAgainBtn');
  var portLabel       = document.getElementById('portLabel');
  var progressFill    = document.getElementById('progressFill');
  var installStatus   = document.getElementById('installStatusText');
  var logBody         = document.getElementById('logBody');
  var errorMsg        = document.getElementById('errorMsg');
  var optGithub       = document.getElementById('optGithub');
  var optLocal        = document.getElementById('optLocal');
  var fileInputWrap   = document.getElementById('fileInputWrap');
  var localFileInput  = document.getElementById('localFileInput');

  /* ── File transfer refs ───────────────────────────────────────── */
  var transferFileInput = document.getElementById('transferFileInput');
  var transferFileName  = document.getElementById('transferFileName');
  var transferPathInput = document.getElementById('transferPath');
  var transferBtn       = document.getElementById('transferBtn');
  var transferLog       = document.getElementById('transferLog');

  if (transferFileInput) {
    transferFileInput.addEventListener('change', function () {
      var f = transferFileInput.files[0];
      if (f) {
        transferFileName.textContent = f.name;
        var dest = transferPathInput.value.trim();
        if (dest === '/' || dest === '') {
          transferPathInput.value = '/Packages/' + f.name;
        }
      }
    });
  }

  function appendTransferLog(text) {
    if (!transferLog) return;
    var line = document.createElement('div');
    if (text.startsWith('[@]'))      line.style.color = 'var(--green)';
    else if (text.startsWith('[:]')) line.style.color = 'var(--accent)';
    else if (text.startsWith('[-]')) line.style.color = 'var(--red)';
    else                             line.style.color = 'var(--text-muted)';
    line.textContent = text;
    transferLog.appendChild(line);
    transferLog.scrollTop = transferLog.scrollHeight;
  }

  if (transferBtn) {
    transferBtn.addEventListener('click', async function () {
      if (!activeDevice) { appendTransferLog('[-] Not connected.'); return; }
      var file = transferFileInput.files[0];
      if (!file) { appendTransferLog('[-] No file selected.'); return; }
      var dest = transferPathInput.value.trim();
      if (!dest || dest === '/') { appendTransferLog('[-] Enter a destination path.'); return; }

      transferBtn.disabled = true;
      transferLog.innerHTML = '';
      appendTransferLog('[:] Entering raw REPL...');
      try {
        await activeDevice.enterRawREPL();
        appendTransferLog('[@] REPL ready.');
        var content = new Uint8Array(await file.arrayBuffer());
        appendTransferLog('[:] Sending ' + file.name + ' (' + content.length + ' B) \u2192 ' + dest);
        await ensureDirs(activeDevice, dest);
        await writeFile(activeDevice, dest, content, appendTransferLog);
        await activeDevice.exitRawREPL();
        appendTransferLog('[@] Done!  ' + dest + ' written & verified.');
        appendTransferLog('    Install: pkg install ' + dest);
      } catch (e) {
        try { await activeDevice.exitRawREPL(); } catch (_) {}
        appendTransferLog('[-] Transfer failed: ' + (e.message || String(e)));
      }
      transferBtn.disabled = false;
    });
  }

  /* ── Optional clean-install (full wipe) toggle ────────────────────
     Default install preserves user data; this opt-in erases everything. */
  var fullWipe = false;
  var wipeConfirmCheck = document.getElementById('wipeConfirmCheck');
  var dataMsgTitle = document.getElementById('dataMsgTitle');
  var dataMsgBody  = document.getElementById('dataMsgBody');
  var installInfoBox = document.getElementById('installInfoBox');
  if (wipeConfirmCheck) {
    wipeConfirmCheck.addEventListener('change', function () {
      fullWipe = wipeConfirmCheck.checked;
      // The message must reflect what actually happens: a clean install wipes
      // EVERYTHING, so the "your data is kept" promise no longer holds.
      if (fullWipe) {
        if (dataMsgTitle) dataMsgTitle.innerHTML = '⚠ Your data will be ERASED.';
        if (dataMsgBody)  dataMsgBody.innerHTML  = 'Clean install wipes the entire filesystem first — accounts, WiFi networks, settings, and installed packages are <strong>all removed</strong>. The device runs first-run setup again afterwards.';
        if (installInfoBox) installInfoBox.classList.add('danger');
      } else {
        if (dataMsgTitle) dataMsgTitle.innerHTML = '✓ Your data is kept.';
        if (dataMsgBody)  dataMsgBody.innerHTML  = 'This installs or updates the OS and removes only the old OS code (<code>/Core</code>). Your accounts, WiFi networks, settings, and installed packages are preserved.';
        if (installInfoBox) installInfoBox.classList.remove('danger');
      }
    });
  }

  /* ── Download .rpc button — save the selected image to the computer ── */
  var downloadRpcBtn = document.getElementById('downloadRpcBtn');
  if (downloadRpcBtn) {
    downloadRpcBtn.addEventListener('click', function () {
      var sel = getSelectedVersion();
      var a = document.createElement('a');
      a.href = sel.file;
      a.download = sel.file.split('/').pop();   // suggest the .rpc filename
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });
  }

  /* ── Active device reference ──────────────────────────────────── */
  var activeDevice = null;

  /* ── Source radio toggle ──────────────────────────────────────── */
  var radios = document.querySelectorAll('input[name="source"]');
  radios.forEach(function (r) {
    r.addEventListener('change', function () {
      var isLocal = (r.value === 'local' && r.checked);
      optGithub.classList.toggle('selected', !isLocal);
      optLocal.classList.toggle('selected', isLocal);
      fileInputWrap.classList.toggle('visible', isLocal);
    });
  });

  /* ── Log / progress helpers ───────────────────────────────────── */
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

  function setProgress(fraction) {
    progressFill.style.width = Math.min(100, Math.round(fraction * 100)) + '%';
  }

  /* ── Connect ──────────────────────────────────────────────────── */
  connectBtn.addEventListener('click', async function () {
    try {
      var port = await navigator.serial.requestPort();
      activeDevice = new Device(port);
      await activeDevice.open();
      var info  = port.getInfo();
      var label = 'Connected';
      if (info && (info.usbVendorId || info.usbProductId)) {
        label = 'Connected &mdash; USB ' +
          (info.usbVendorId  ? '0x' + info.usbVendorId.toString(16).toUpperCase()  : '') +
          (info.usbProductId ? ':0x' + info.usbProductId.toString(16).toUpperCase() : '');
      }
      portLabel.innerHTML = label;
      showState('Connected');
    } catch (e) {
      if (e.name !== 'NotFoundError') {
        errorMsg.textContent = e.message || String(e);
        showState('Error');
      }
    }
  });

  /* ── Disconnect ───────────────────────────────────────────────── */
  disconnectLink.addEventListener('click', async function () {
    if (activeDevice) {
      try { await activeDevice.close(); } catch (e) {}
      activeDevice = null;
    }
    showState('Idle');
  });

  /* ── Install ──────────────────────────────────────────────────── */
  installBtn.addEventListener('click', async function () {
    if (!activeDevice) return;

    var sourceRadio = document.querySelector('input[name="source"]:checked');
    var sourceValue = sourceRadio ? sourceRadio.value : 'github';
    var getZipData;

    if (sourceValue === 'local') {
      var file = localFileInput.files[0];
      if (!file) { alert('Please select a .rpc file first.'); return; }
      getZipData = await file.arrayBuffer();
    } else {
      getZipData = getSelectedVersion().file;
    }

    clearLog();
    setProgress(0);
    installStatus.textContent = 'Preparing\u2026';
    showState('Installing');

    await runInstall(
      activeDevice,
      getZipData,
      function (msg) {
        appendLog(msg);
        var m = msg.match(/\[:\] \[(\d+)\/(\d+)\]/);
        if (m)                        installStatus.textContent = 'Installing\u2026 ' + m[1] + ' / ' + m[2] + ' files';
        else if (msg.includes('Downloading')) installStatus.textContent = 'Downloading\u2026';
        else if (msg.includes('Extracting'))  installStatus.textContent = 'Extracting archive\u2026';
        else if (msg.includes('Rebooting'))   installStatus.textContent = 'Rebooting device\u2026';
      },
      function (frac) { setProgress(frac); },
      function () { activeDevice = null; showState('Done'); },
      function (msg) { activeDevice = null; errorMsg.textContent = msg; showState('Error'); },
      fullWipe
    );
  });

  /* ── Cancel / retry ───────────────────────────────────────────── */
  cancelBtn.addEventListener('click', function () {
    _cancelInstall = true;
    appendLog('[?] Cancel requested\u2026');
  });

  retryBtn.addEventListener('click', function () {
    activeDevice = null;
    showState('Idle');
  });

  installAgainBtn.addEventListener('click', function () {
    activeDevice = null;
    clearLog();
    setProgress(0);
    showState('Idle');
  });

  /* ── Browser compatibility check ──────────────────────────────── */
  if (!('serial' in navigator)) {
    document.getElementById('compatBanner').classList.add('visible');
    document.getElementById('installerContent').style.display = 'none';
  }

  /* ── Populate version picker from JSON ──────────────────────── */
  loadReleases();

})();
