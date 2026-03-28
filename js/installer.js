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
    if (!sel || !sel.value) return { file: 'releases/RPC-Nebula-b81-Beta.rpc', label: 'RPCortex Nebula v0.8.1-beta3' };
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
      sel.innerHTML = '<option value="releases/RPC-Nebula-b81-Beta.rpc">RPCortex Nebula v0.8.1-beta3 \u2014 latest</option>';
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
    var exts = ['.py', '.cfg', '.lp'];
    for (var j = 0; j < exts.length; j++) {
      if (relPath.endsWith(exts[j])) return true;
    }
    return false;
  }

  /* ── Raw-REPL file helpers ────────────────────────────────────── */
  function writeFile(device, devicePath, content) {
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

  /* ── Device wipe ──────────────────────────────────────────────── */
  async function wipeDevice(device, onLog) {
    onLog('[:] Wiping device filesystem...');
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
  }

  /* ── Main install function ────────────────────────────────────── */
  var _cancelInstall = false;

  async function runInstall(device, getZipData, onLog, onProgress, onDone, onError) {
    _cancelInstall = false;
    _createdDirs.clear();

    try {
      onLog('[:] Entering raw REPL...');
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

      var toInstall = [];
      zip.forEach(function (zipPath, entry) {
        if (entry.dir) return;
        var relPath = prefix ? zipPath.slice(prefix.length) : zipPath;
        if (relPath && shouldInstall(relPath)) {
          toInstall.push({ zipPath: zipPath, relPath: relPath, entry: entry });
        }
      });

      onLog('[@] ' + toInstall.length + ' files to install.');
      onLog('[:] Wiping existing filesystem...');
      await wipeDevice(device, onLog);

      for (var i = 0; i < toInstall.length; i++) {
        if (_cancelInstall) { onLog('[?] Installation cancelled.'); return; }
        var item       = toInstall[i];
        var devicePath = '/' + item.relPath;
        var content    = await item.entry.async('uint8array');
        onProgress((i + 1) / toInstall.length);
        onLog('[:] [' + (i + 1) + '/' + toInstall.length + '] ' + devicePath);
        await ensureDirs(device, devicePath);
        await writeFile(device, devicePath, content);
      }

      onLog('[@] All files written.');
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
        await writeFile(activeDevice, dest, content);
        await activeDevice.exitRawREPL();
        appendTransferLog('[@] Done!  ' + dest + ' written successfully.');
        appendTransferLog('    Install: pkg install ' + dest);
      } catch (e) {
        try { await activeDevice.exitRawREPL(); } catch (_) {}
        appendTransferLog('[-] Transfer failed: ' + (e.message || String(e)));
      }
      transferBtn.disabled = false;
    });
  }

  /* ── Wipe confirmation checkbox ───────────────────────────────── */
  var wipeConfirmCheck = document.getElementById('wipeConfirmCheck');
  if (wipeConfirmCheck) {
    installBtn.disabled = true;
    wipeConfirmCheck.addEventListener('change', function () {
      installBtn.disabled = !wipeConfirmCheck.checked;
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
      function (msg) { activeDevice = null; errorMsg.textContent = msg; showState('Error'); }
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
