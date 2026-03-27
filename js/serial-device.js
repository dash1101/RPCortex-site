/**
 * RPCortex — Shared Web Serial device class.
 *
 * Used by both the OS installer (install.html) and the
 * package installer (packages.html).
 *
 * Exports onto window.RPC:
 *   RPC.Device        — serial device wrapper
 *   RPC.sleep(ms)     — promise-based delay
 *   RPC.toBase64(u8)  — Uint8Array to base64 string
 *   RPC.esc(s)        — HTML-escape a string
 */
(function () {
  'use strict';

  var RPC = window.RPC || {};

  /* ── Helpers ──────────────────────────────────────────────────── */

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  function toBase64(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ── Device class ─────────────────────────────────────────────── */

  function Device(port) {
    this.port     = port;
    this.rxBuffer = '';
    this._active  = false;
  }

  Device.prototype.open = async function () {
    await this.port.open({ baudRate: 115200 });
    // Suppress DTR/RTS immediately — prevents ESP32 auto-reset circuit and
    // Pico DTR-triggered soft-reset from firing when the browser opens the port.
    try { await this.port.setSignals({ dataTerminalReady: false, requestToSend: false }); } catch (e) {}
    this._active = true;
    this._startReadLoop();
  };

  Device.prototype._startReadLoop = function () {
    var dec  = new TextDecoder();
    var self = this;
    (async function () {
      while (self._active) {
        var reader;
        try {
          reader = self.port.readable.getReader();
          while (self._active) {
            var res = await reader.read();
            if (res.done) break;
            self.rxBuffer += dec.decode(res.value);
          }
        } catch (e) {
          if (!self._active) break;
        } finally {
          if (reader) { try { reader.releaseLock(); } catch (e) {} }
        }
        if (!self._active) break;
        await sleep(50);
      }
    })();
  };

  Device.prototype.write = async function (data) {
    var writer = this.port.writable.getWriter();
    try {
      var bytes = (typeof data === 'string') ? new TextEncoder().encode(data) : data;
      await writer.write(bytes);
    } finally {
      writer.releaseLock();
    }
  };

  Device.prototype.clearBuffer = function () {
    this.rxBuffer = '';
  };

  Device.prototype.waitFor = async function (marker, ms) {
    ms = ms || 8000;
    var deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      var idx = this.rxBuffer.indexOf(marker);
      if (idx !== -1) {
        var before = this.rxBuffer.slice(0, idx);
        this.rxBuffer = this.rxBuffer.slice(idx + marker.length);
        return before;
      }
      await sleep(30);
    }
    throw new Error('Timeout waiting for ' + JSON.stringify(marker));
  };

  /* ── Raw REPL helpers (used by the OS installer) ──────────────── */

  Device.prototype.enterRawREPL = async function () {
    await this.write('\x03\x03');
    await sleep(400);
    this.clearBuffer();
    await this.write('\x01');
    await this.waitFor('raw REPL', 5000);
    this.clearBuffer();
  };

  Device.prototype.execRaw = async function (code, timeout) {
    timeout = timeout || 25000;
    this.clearBuffer();
    await this.write(code + '\x04');
    await this.waitFor('OK', 6000);
    var out = await this.waitFor('\x04\x04>', timeout);
    if (out.includes('Traceback') || out.includes('Error:')) {
      throw new Error('Device error: ' + out.trim().slice(0, 200));
    }
    return out.trim();
  };

  Device.prototype.exitRawREPL = async function () {
    await this.write('\x02');
    await sleep(300);
  };

  Device.prototype.close = async function () {
    this._active = false;
    await sleep(300);
    try { await this.port.close(); } catch (e) {}
  };

  /* ── Expose ───────────────────────────────────────────────────── */

  RPC.Device   = Device;
  RPC.sleep    = sleep;
  RPC.toBase64 = toBase64;
  RPC.esc      = esc;
  window.RPC   = RPC;

})();
