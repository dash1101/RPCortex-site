/* The browser installer for v2 (flash.html). The protocol is in js/picoboot.js; this is the
   page around it: choose a board, fetch the image, check it, open the board, write it. */
(function () {
  'use strict';
  var R = window.RPCReleases, PB = window.RPCPicoboot;
  var esc = R.esc;
  var $ = function (id) { return document.getElementById(id); };

  var CHIP = { pico2_w: 'RP2350', pico2: 'RP2350', pico_w: 'RP2040', pico: 'RP2040' };
  var FALLBACK = [
    { id: 'pico2_w', name: 'Pico 2 W', chip: 'RP2350', status: 'verified' },
    { id: 'pico2', name: 'Pico 2', chip: 'RP2350', status: 'untested' },
    { id: 'pico_w', name: 'Pico W', chip: 'RP2040', status: 'untested' },
    { id: 'pico', name: 'Pico', chip: 'RP2040', status: 'untested' }
  ];
  var data, rel, board = null, busy = false;

  if (!('usb' in navigator)) { $('noUsb').classList.remove('is-hidden'); $('goBtn').disabled = true; $('goBtn').title = 'This browser has no WebUSB'; }
  if (!('serial' in navigator)) $('touchBox').classList.add('is-hidden');

  function log(text, cls) {
    var el = $('log');
    el.classList.remove('is-hidden');
    var line = document.createElement('div');
    if (cls) line.className = cls;
    line.textContent = text;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
  }
  function say(t) { $('stage').textContent = t; }
  function bar(f) { $('barWrap').classList.remove('is-hidden'); $('barFill').style.width = Math.round(f * 100) + '%'; }

  function renderBoards() {
    var el = $('boardCards');
    el.innerHTML = '';
    var want = (/[?&]board=([\w]+)/.exec(location.search) || [])[1];
    (data.boards || FALLBACK).forEach(function (b) {
      var ran = b.status === 'verified';
      var c = document.createElement('button');
      c.type = 'button'; c.className = 'get-card'; c.setAttribute('aria-pressed', 'false');
      c.innerHTML = '<b>' + esc(b.name) + '</b><small>' + esc(b.chip) + '</small><span class="badge ' + (ran ? 'b-done' : 'b-part') + '">' +
        (ran ? 'run on hardware' : 'not booted yet') + '</span>';
      c.addEventListener('click', function () {
        Array.prototype.forEach.call(el.children, function (x) { x.setAttribute('aria-pressed', 'false'); });
        c.setAttribute('aria-pressed', 'true');
        board = b; choose();
      });
      el.appendChild(c);
      if (want === b.id) c.click();
    });
  }

  function asset(kind) {
    if (!rel) return null;
    for (var i = 0; i < rel.assets.length; i++) if (rel.assets[i].board === board.id && rel.assets[i].kind === kind) return rel.assets[i];
    return null;
  }

  function choose() {
    var a = asset('uf2');
    $('what').textContent = (rel ? R.longName(rel) : 'The latest build') + ' for ' + board.name + (a ? ' · ' + Math.round(a.size / 1024) + ' KB' : '') + '.';
    $('untested').classList.toggle('is-hidden', board.status === 'verified');
    if ('usb' in navigator) $('goBtn').disabled = busy;
  }

  async function install() {
    if (busy || !board) return;
    busy = true; $('goBtn').disabled = true; $('log').innerHTML = ''; $('log').classList.add('is-hidden');
    try {
      var chip = CHIP[board.id];
      say('Downloading the image…'); bar(0);
      var res = await fetch(R.BASE + 'rpcortex-v2-' + board.id + '.uf2', { cache: 'no-cache' });
      if (!res.ok) throw new Error('The image could not be downloaded (' + res.status + ').');
      var bytes = new Uint8Array(await res.arrayBuffer());
      log('Downloaded ' + bytes.length + ' bytes.');

      var a = asset('uf2');
      if (a) {
        var got = await PB.sha256(bytes);
        if (got !== a.sha256) throw new Error('The downloaded file does not match the published checksum, so it was not written. A release may have just been published; wait a few minutes and try again.');
        log('Checksum matches the release (' + got.slice(0, 16) + '…).', 'ok');
      } else {
        log('No published checksum to compare with; the file is the one on the update channel.');
      }
      var uf2 = PB.parseUF2(bytes, PB.FAMILY[chip]);
      log(uf2.blocks.length + ' blocks for the ' + chip + (uf2.skipped ? ' (' + uf2.skipped + ' skipped)' : '') + '.');

      say('Choose the board in the browser’s prompt…');
      var usb = await PB.Picoboot.request();
      var pb = new PB.Picoboot(usb);
      if (pb.chip !== chip) throw new Error('That board is an ' + pb.chip + ' and the image is for an ' + chip + '. Pick the matching board above.');
      await pb.open();
      log('Opened the ' + pb.chip + ' in BOOTSEL mode.');

      var labels = { erase: 'Erasing', write: 'Writing', verify: 'Checking' };
      var res2 = await pb.flash(uf2, { progress: function (stage, done, total) {
        if (stage === 'verify-skipped') { log('The board did not allow reading back; carrying on without the check.'); return; }
        say(labels[stage] + '…'); bar(({ erase: 0, write: 1, verify: 2 }[stage] + done / total) / 3);
      } });
      bar(1);
      log('Wrote ' + res2.bytes + ' bytes' + (res2.verified ? ' and read them back.' : '.'), 'ok');
      say('Done. The board is restarting. Open a serial terminal at 115200 baud.');
      log('Restarting.', 'ok');
      await pb.close();
    } catch (e) {
      var msg = e && e.message ? e.message : String(e);
      if (e && e.name === 'NotFoundError') msg = 'No board was chosen. Put it in BOOTSEL mode first (hold BOOTSEL while plugging in), then try again.';
      else if (e && (e.name === 'SecurityError' || /claim|access denied|busy/i.test(msg))) msg += ' The board could not be opened: close any other program using it, and on Windows the browser needs a WinUSB driver on its boot interface. The drag-and-drop install always works.';
      say('Stopped.'); log(msg, 'bad');
    } finally {
      busy = false; if ('usb' in navigator && board) $('goBtn').disabled = false;
    }
  }

  async function touch() {
    try {
      say('Choose the board’s serial port…');
      await PB.touchBootsel();
      say('Restarting it into BOOTSEL. Then press Connect and install.');
    } catch (e) {
      say(e && e.name === 'NotFoundError' ? 'No port was chosen.' : 'Could not do that: ' + (e && e.message ? e.message : e));
    }
  }

  $('goBtn').addEventListener('click', install);
  $('touchBtn').addEventListener('click', touch);

  R.load().then(function (d) {
    data = d; rel = d.live ? R.newest(d) : null;
    renderBoards();
  });
})();
