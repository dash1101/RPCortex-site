/* Flash an RP2040 or RP2350 from the browser, through the boot ROM's PICOBOOT interface.
   ------------------------------------------------------------------------
   A Pico held in BOOTSEL shows the host two things: a mass-storage drive (the
   drag-and-drop install) and a vendor-specific USB interface called PICOBOOT,
   which is what picotool talks to. WebUSB can claim a vendor interface, so a page
   can do what picotool does: erase, write, read back, reboot. The mass-storage
   drive stays the primary way to install; this is the optional one.

   The protocol is the one in the SDK's boot/picoboot.h:
     a 32-byte command on the bulk OUT endpoint (magic, token, id, size, transfer
     length, 16 bytes of arguments), then an optional data stage (IN for ids with the
     top bit set, OUT otherwise), then an acknowledgement: a zero-length packet the
     opposite way. A failed command stalls the endpoints; control request 0x42 reads
     its status and 0x41 resets the interface.

   DEVICE-UNCONFIRMED. The framing and the sequence are checked against a mock of the
   boot ROM (site/test_picoboot.py) and written from the SDK header, but this has not
   been run against a real board in BOOTSEL. Things most likely to need a change on
   the first real run: the verify step (it re-enters command XIP before reading flash),
   and the RP2350 reboot flags. A browser cannot do this on Windows unless the PICOBOOT
   interface has a WinUSB driver bound to it.

   Exported as window.RPCPicoboot, and as a CommonJS module so the pure parts can be
   tested without a browser. */
(function (root) {
  'use strict';

  var MAGIC = 0x431fd10b;
  var CMD = { EXCLUSIVE: 0x01, REBOOT: 0x02, ERASE: 0x03, READ: 0x84, WRITE: 0x05,
              EXIT_XIP: 0x06, ENTER_CMD_XIP: 0x07, REBOOT2: 0x0a };
  var IF_RESET = 0x41, IF_STATUS = 0x42;
  var VID = 0x2e8a;
  var PID = { 0x0003: 'RP2040', 0x000f: 'RP2350' };
  // UF2 family ids. A block of any other family (the RP2350 images carry an "absolute"
  // block at 0x10ffff00 that is not meant to be written) is skipped.
  var FAMILY = { RP2040: 0xe48bff56, RP2350: 0xe48bff59 };
  var SECTOR = 4096, PAGE = 256, FLASH_BASE = 0x10000000, FLASH_MAX = 0x10000000 + 16 * 1024 * 1024;
  var STATUS = ['ok', 'unknown command', 'invalid command length', 'invalid transfer length', 'invalid address',
    'bad alignment', 'interleaved write', 'rebooting', 'unknown error', 'invalid state', 'not permitted',
    'invalid argument', 'buffer too small', 'precondition not met', 'modified data', 'invalid data', 'not found',
    'unsupported modification'];

  // ---- UF2 ----------------------------------------------------------------------
  // 512-byte blocks: magic, magic, flags, target address, payload size, block no,
  // block count, family id, 476 data bytes, end magic.
  function parseUF2(bytes, family) {
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.byteLength % 512) throw new Error('This is not a UF2 file (its length is not a multiple of 512).');
    var blocks = [], skipped = 0;
    for (var o = 0; o < bytes.byteLength; o += 512) {
      if (dv.getUint32(o, true) !== 0x0a324655 || dv.getUint32(o + 4, true) !== 0x9e5d5157 ||
          dv.getUint32(o + 508, true) !== 0x0ab16f30) throw new Error('Block ' + (o / 512) + ' is not a UF2 block.');
      var flags = dv.getUint32(o + 8, true);
      var addr = dv.getUint32(o + 12, true);
      var size = dv.getUint32(o + 16, true);
      var fam = (flags & 0x2000) ? dv.getUint32(o + 28, true) : null;
      if (flags & 1) { skipped++; continue; }                      // not main flash
      if (fam !== null && family != null && fam !== family) { skipped++; continue; }
      if (size < 1 || size > 476) throw new Error('Block ' + (o / 512) + ' has a payload of ' + size + ' bytes.');
      if (addr < FLASH_BASE || addr + size > FLASH_MAX) throw new Error('Block ' + (o / 512) + ' targets ' + addr.toString(16) + ', outside flash.');
      blocks.push({ addr: addr, data: bytes.slice(o + 32, o + 32 + size) });
    }
    if (!blocks.length) throw new Error('This UF2 has nothing for this chip.');
    return { blocks: blocks, skipped: skipped };
  }

  // Blocks into contiguous, sector-aligned segments, erased bytes (0xff) wherever a
  // sector is only partly covered.
  function segments(blocks) {
    var sorted = blocks.slice().sort(function (a, b) { return a.addr - b.addr; });
    var segs = [];
    sorted.forEach(function (b) {
      var s = Math.floor(b.addr / SECTOR) * SECTOR;
      var e = Math.ceil((b.addr + b.data.length) / SECTOR) * SECTOR;
      var last = segs[segs.length - 1];
      if (last && s <= last.end) { if (e > last.end) last.end = e; last.blocks.push(b); }
      else segs.push({ start: s, end: e, blocks: [b] });
    });
    return segs.map(function (g) {
      var data = new Uint8Array(g.end - g.start).fill(0xff);
      g.blocks.forEach(function (b) { data.set(b.data, b.addr - g.start); });
      return { addr: g.start, data: data };
    });
  }

  // ---- the command frame ----------------------------------------------------------
  function frame(token, id, args, transferLength) {
    var buf = new ArrayBuffer(32), dv = new DataView(buf);
    dv.setUint32(0, MAGIC, true);
    dv.setUint32(4, token >>> 0, true);
    dv.setUint8(8, id);
    dv.setUint8(9, args.length * 4 - (id === CMD.EXCLUSIVE ? 3 : 0));      // bCmdSize
    dv.setUint16(10, 0, true);
    dv.setUint32(12, transferLength >>> 0, true);
    if (id === CMD.EXCLUSIVE) dv.setUint8(16, args[0] & 0xff);            // one byte
    else args.forEach(function (a, i) { dv.setUint32(16 + i * 4, a >>> 0, true); });
    return new Uint8Array(buf);
  }

  // ---- the device ------------------------------------------------------------------
  function Picoboot(usb) { this.usb = usb; this.token = 1; this.ifnum = -1; this.epOut = 0; this.epIn = 0; this.chip = PID[usb.productId] || null; }

  Picoboot.request = function () {
    return navigator.usb.requestDevice({ filters: [{ vendorId: VID, productId: 0x0003 }, { vendorId: VID, productId: 0x000f }] });
  };

  Picoboot.prototype.open = async function () {
    var d = this.usb;
    await d.open();
    if (d.configuration === null) await d.selectConfiguration(1);
    var cfg = d.configuration;
    for (var i = 0; i < cfg.interfaces.length; i++) {
      var alt = cfg.interfaces[i].alternates[0];
      if (alt.interfaceClass === 0xff && alt.endpoints.length === 2) {
        this.ifnum = cfg.interfaces[i].interfaceNumber;
        alt.endpoints.forEach(function (e) { if (e.direction === 'out') this.epOut = e.endpointNumber; else this.epIn = e.endpointNumber; }, this);
      }
    }
    if (this.ifnum < 0) throw new Error('This board has no PICOBOOT interface. Is it in BOOTSEL mode?');
    await d.claimInterface(this.ifnum);
    await this.reset();
  };

  Picoboot.prototype.close = async function () { try { await this.usb.releaseInterface(this.ifnum); await this.usb.close(); } catch (e) { /* gone */ } };

  Picoboot.prototype.reset = function () {
    return this.usb.controlTransferOut({ requestType: 'vendor', recipient: 'interface', request: IF_RESET, value: 0, index: this.ifnum });
  };

  Picoboot.prototype.status = async function () {
    var r = await this.usb.controlTransferIn({ requestType: 'vendor', recipient: 'interface', request: IF_STATUS, value: 0, index: this.ifnum }, 16);
    var dv = r.data;
    return { token: dv.getUint32(0, true), code: dv.getUint32(4, true), cmd: dv.getUint8(8), busy: dv.getUint8(9) };
  };

  // One command: frame, data stage, acknowledgement. `data` is the OUT payload for a
  // write; `inLength` is how much an IN command returns.
  Picoboot.prototype.cmd = async function (id, args, data, inLength) {
    var isIn = (id & 0x80) !== 0;
    var len = isIn ? inLength : (data ? data.length : 0);
    var res = await this.usb.transferOut(this.epOut, frame(this.token++, id, args, len));
    if (res.status !== 'ok') return this.fail(id, res.status);
    var out = null;
    if (len) {
      if (isIn) {
        var r = await this.usb.transferIn(this.epIn, len);
        if (r.status !== 'ok') return this.fail(id, r.status);
        out = new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength);
      } else {
        var w = await this.usb.transferOut(this.epOut, data);
        if (w.status !== 'ok') return this.fail(id, w.status);
      }
    }
    var ack = isIn ? await this.usb.transferOut(this.epOut, new Uint8Array(0)) : await this.usb.transferIn(this.epIn, 1);
    if (ack.status !== 'ok') return this.fail(id, ack.status);
    return out;
  };

  Picoboot.prototype.fail = async function (id, why) {
    var detail = 'transfer ' + why;
    try {
      if (why === 'stall') { await this.usb.clearHalt('out', this.epOut); await this.usb.clearHalt('in', this.epIn); }
      var st = await this.status();
      detail = STATUS[st.code] || ('status ' + st.code);
      await this.reset();
    } catch (e) { /* the status read is best effort */ }
    throw new Error('The board refused command 0x' + id.toString(16) + ': ' + detail + '.');
  };

  Picoboot.prototype.exclusive = function (on) { return this.cmd(CMD.EXCLUSIVE, [on ? 1 : 0]); };
  Picoboot.prototype.exitXip = function () { return this.cmd(CMD.EXIT_XIP, []); };
  Picoboot.prototype.enterXip = function () { return this.cmd(CMD.ENTER_CMD_XIP, []); };
  Picoboot.prototype.erase = function (addr, size) { return this.cmd(CMD.ERASE, [addr, size]); };
  Picoboot.prototype.write = function (addr, data) { return this.cmd(CMD.WRITE, [addr, data.length], data); };
  Picoboot.prototype.read = function (addr, size) { return this.cmd(CMD.READ, [addr, size], null, size); };

  // The reboot answers with an error or no answer at all as the device goes away; that is success.
  Picoboot.prototype.reboot = async function (delayMs) {
    try {
      if (this.chip === 'RP2350') await this.cmd(CMD.REBOOT2, [0, delayMs, 0, 0]);   // normal boot
      else await this.cmd(CMD.REBOOT, [0, 0, delayMs]);                                // pc 0: the regular path
    } catch (e) { /* rebooting */ }
  };

  // Erase, write, read back, reboot. `progress(stage, done, total)` is called as it goes.
  Picoboot.prototype.flash = async function (uf2, opts) {
    opts = opts || {};
    var progress = opts.progress || function () {};
    var segs = segments(uf2.blocks);
    var total = segs.reduce(function (n, s) { return n + s.data.length; }, 0);
    var done, s, o;

    await this.exclusive(true);
    await this.exitXip();

    done = 0;
    for (s = 0; s < segs.length; s++) {
      for (o = 0; o < segs[s].data.length; o += 8 * SECTOR) {
        var n = Math.min(8 * SECTOR, segs[s].data.length - o);
        await this.erase(segs[s].addr + o, n);
        done += n; progress('erase', done, total);
      }
    }
    done = 0;
    for (s = 0; s < segs.length; s++) {
      for (o = 0; o < segs[s].data.length; o += SECTOR) {
        await this.write(segs[s].addr + o, segs[s].data.subarray(o, o + SECTOR));
        done += SECTOR; progress('write', done, total);
      }
    }

    var verified = false;
    if (opts.verify !== false) {
      try {
        await this.enterXip();
        done = 0;
        for (s = 0; s < segs.length; s++) {
          for (o = 0; o < segs[s].data.length; o += SECTOR) {
            var got = await this.read(segs[s].addr + o, SECTOR), want = segs[s].data.subarray(o, o + SECTOR);
            for (var i = 0; i < SECTOR; i++) {
              if (got[i] !== want[i]) throw new Error('MISMATCH at 0x' + (segs[s].addr + o + i).toString(16));
            }
            done += SECTOR; progress('verify', done, total);
          }
        }
        verified = true;
      } catch (e) {
        if (/^MISMATCH/.test(e.message)) throw new Error('What was read back does not match what was written (' + e.message + '). Not restarting. Try again, or use the drag-and-drop install.');
        // A read that could not be done is not a bad write; say so and carry on.
        progress('verify-skipped', 0, 0);
      }
    }

    await this.exclusive(false).catch(function () {});
    await this.reboot(400);
    return { bytes: total, verified: verified };
  };

  // A board that is running RPCortex goes to BOOTSEL when a serial port is opened at 1200 baud and closed.
  async function touchBootsel() {
    var port = await navigator.serial.requestPort({ filters: [{ usbVendorId: VID }] });
    await port.open({ baudRate: 1200 });
    await port.close();
  }

  async function sha256(bytes) {
    var d = await crypto.subtle.digest('SHA-256', bytes);
    return Array.prototype.map.call(new Uint8Array(d), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }

  var api = { Picoboot: Picoboot, parseUF2: parseUF2, segments: segments, frame: frame, touchBootsel: touchBootsel,
              sha256: sha256, CMD: CMD, FAMILY: FAMILY, PID: PID, SECTOR: SECTOR, STATUS: STATUS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.RPCPicoboot = api;
})(typeof window !== 'undefined' ? window : this);
