#!/usr/bin/env python3
"""Tests for js/picoboot.js, run in headless Chromium against a mock of the boot ROM.

    python3 site/test_picoboot.py

The mock enforces what the real boot ROM does: a command is 32 bytes with the magic and a
token; erase and write need XIP exited first; erase is sector-aligned and write page-aligned;
a bad command stalls the endpoints and leaves a status to read. It cannot say whether the real
ROM agrees, which is why picoboot.js is marked DEVICE-UNCONFIRMED until it has run on a board.

Needs Playwright with Chromium. Real images from the OS repository are also flashed if they are
beside this one (../RPCortex-v2/out) or named by RPC_IMAGES; the synthetic UF2 always runs.
"""
import json
import os
import struct
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

MOCK = r"""
window.makeMock = function (pid, opts) {
  opts = opts || {};
  var BASE = 0x10000000, SIZE = 4 * 1024 * 1024;
  var m = { productId: pid, vendorId: 0x2e8a, flash: new Uint8Array(SIZE).fill(0xff), log: [], xip: true, excl: false,
            token: 0, stalled: false, lastStatus: { token: 0, code: 0, cmd: 0 }, state: 'cmd', cur: null, rebooted: null,
            opened: false, claimed: false };
  m.configuration = { interfaces: [
    { interfaceNumber: 0, alternates: [{ interfaceClass: 8, endpoints: [{ direction: 'out', endpointNumber: 1 }, { direction: 'in', endpointNumber: 1 }] }] },
    { interfaceNumber: 1, alternates: [{ interfaceClass: 0xff, endpoints: [{ direction: 'out', endpointNumber: 4 }, { direction: 'in', endpointNumber: 5 }] }] } ] };
  m.open = async function () { m.opened = true; };
  m.close = async function () { m.opened = false; };
  m.selectConfiguration = async function () {};
  m.claimInterface = async function (n) { if (n !== 1) throw new Error('claimed the wrong interface'); m.claimed = true; };
  m.releaseInterface = async function () {};
  m.clearHalt = async function () { m.stalled = false; };
  m.controlTransferOut = async function (s) {
    m.log.push('ctl-out:' + s.request.toString(16));
    if (s.request === 0x41) { m.stalled = false; m.state = 'cmd'; m.cur = null; }
    return { status: 'ok' };
  };
  m.controlTransferIn = async function (s, len) {
    m.log.push('ctl-in:' + s.request.toString(16));
    var b = new DataView(new ArrayBuffer(16));
    b.setUint32(0, m.lastStatus.token, true); b.setUint32(4, m.lastStatus.code, true); b.setUint8(8, m.lastStatus.cmd);
    return { status: 'ok', data: b };
  };
  function err(code) { m.stalled = true; m.state = 'cmd'; m.lastStatus = { token: m.cur ? m.cur.token : 0, code: code, cmd: m.cur ? m.cur.id : 0 }; return { status: 'stall' }; }
  m.transferOut = async function (ep, data) {
    if (ep !== 4) throw new Error('OUT on the wrong endpoint ' + ep);
    if (m.stalled) return { status: 'stall' };
    data = new Uint8Array(data.buffer ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data);
    if (m.state === 'cmd') {
      if (data.length !== 32) return err(2);
      var dv = new DataView(data.buffer);
      if (dv.getUint32(0, true) !== 0x431fd10b) return err(1);
      var tok = dv.getUint32(4, true);
      if (tok !== m.token + 1) throw new Error('token out of order: ' + tok + ' after ' + m.token);
      m.token = tok;
      var c = { token: tok, id: dv.getUint8(8), size: dv.getUint8(9), len: dv.getUint32(12, true),
                a0: dv.getUint32(16, true), a1: dv.getUint32(20, true), a2: dv.getUint32(24, true), a3: dv.getUint32(28, true), b0: dv.getUint8(16) };
      m.cur = c;
      var inCmd = (c.id & 0x80) !== 0;
      m.log.push('cmd:' + c.id.toString(16) + (c.id === 3 || c.id === 5 || c.id === 0x84 ? ':' + c.a0.toString(16) + ':' + c.a1 : ''));
      var sizes = { 1: 1, 2: 12, 3: 8, 0x84: 8, 5: 8, 6: 0, 7: 0, 0x0a: 16 };
      if (!(c.id in sizes)) return err(1);
      if (c.size !== sizes[c.id]) return err(2);
      if (c.id === 3 || c.id === 5 || c.id === 0x84) {
        if (c.a0 < BASE || c.a0 + c.a1 > BASE + SIZE) return err(4);
        if (c.id === 3 && (c.a0 % 4096 || c.a1 % 4096)) return err(5);
        if (c.id === 5 && (c.a0 % 256 || c.a1 % 256)) return err(5);
        if ((c.id === 3 || c.id === 5) && m.xip) return err(9);                  // must exit XIP first
        if (c.id === 0x84 && !m.xip) return err(9);                              // flash reads need command XIP
        if (c.id === 5 && c.len !== c.a1) return err(3);
        if (c.id === 0x84 && c.len !== c.a1) return err(3);
      }
      if (c.id === 3) m.flash.fill(0xff, c.a0 - BASE, c.a0 - BASE + c.a1);
      if (c.id === 1) m.excl = c.b0 === 1;
      if (c.id === 6) m.xip = false;
      if (c.id === 7) m.xip = true;
      if (c.id === 2) m.rebooted = { id: 2, pc: c.a0, sp: c.a1, delay: c.a2 };
      if (c.id === 0x0a) m.rebooted = { id: 0x0a, flags: c.a0, delay: c.a1 };
      m.state = c.len ? (inCmd ? 'in-data' : 'out-data') : (inCmd ? 'ack-out' : 'ack-in');
      return { status: 'ok' };
    }
    if (m.state === 'out-data') {
      if (data.length !== m.cur.len) return err(3);
      var p = m.cur.a0 - BASE;
      for (var i = 0; i < data.length; i++) {
        if (m.flash[p + i] !== 0xff && !opts.allowOverwrite) return err(14);       // writing without erasing
        m.flash[p + i] = data[i];
      }
      m.state = 'ack-in';
      return { status: 'ok' };
    }
    if (m.state === 'ack-out') { if (data.length) return err(2); m.state = 'cmd'; return { status: 'ok' }; }
    return err(9);
  };
  m.transferIn = async function (ep, len) {
    if (ep !== 5) throw new Error('IN on the wrong endpoint ' + ep);
    if (m.stalled) return { status: 'stall' };
    if (m.state === 'in-data') {
      if (opts.failRead) return err(8);
      var p = m.cur.a0 - BASE, out = m.flash.slice(p, p + m.cur.a1);
      if (opts.corruptAt != null && m.cur.a0 <= opts.corruptAt && opts.corruptAt < m.cur.a0 + m.cur.a1) out[opts.corruptAt - m.cur.a0] ^= 0xff;
      m.state = 'ack-out';
      return { status: 'ok', data: new DataView(out.buffer) };
    }
    if (m.state === 'ack-in') { m.state = 'cmd'; return { status: 'ok', data: new DataView(new ArrayBuffer(0)) }; }
    return err(9);
  };
  return m;
};
"""


def uf2(blocks, family, extra_abs=True):
    """A UF2 of 256-byte blocks. blocks = [(addr, bytes)]; an 'absolute' block is added like the SDK does."""
    out = b""
    allb = list(blocks)
    n = len(allb) + (1 if extra_abs else 0)
    for i, (addr, data) in enumerate(allb):
        out += struct.pack("<IIIIIIII", 0x0A324655, 0x9E5D5157, 0x2000, addr, len(data), i, n, family) \
            + data.ljust(476, b"\0") + struct.pack("<I", 0x0AB16F30)
    if extra_abs:
        out += struct.pack("<IIIIIIII", 0x0A324655, 0x9E5D5157, 0x2000, 0x10FFFF00, 256, n - 1, n, 0xE48BFF57) \
            + b"\xef" * 256 + b"\0" * 220 + struct.pack("<I", 0x0AB16F30)
    return out


def synthetic(size=9000, base=0x10000000, family=0xE48BFF59, absolute=True):
    data = bytes((i * 7 + 3) & 0xFF for i in range(size))
    blocks = [(base + o, data[o:o + 256]) for o in range(0, size, 256)]
    return uf2(blocks, family, absolute), data


class Picoboot(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from playwright.sync_api import sync_playwright
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch()
        cls.page = cls.browser.new_page()
        cls.page.set_content("<html><body></body></html>")
        cls.page.add_script_tag(path=os.path.join(ROOT, "js", "picoboot.js"))
        cls.page.add_script_tag(content=MOCK)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()

    def run_js(self, body, **args):
        return self.page.evaluate("async (a) => { const P = window.RPCPicoboot; " + body + " }", args)

    def flash(self, image, pid, opts="{}", mock_opts="{}", family="P.FAMILY.RP2350"):
        return self.run_js("""
          const bytes = Uint8Array.from(atob(a.b64), c => c.charCodeAt(0));
          const dev = window.makeMock(a.pid, %s);
          const pb = new P.Picoboot(dev);
          await pb.open();
          const uf2 = P.parseUF2(bytes, %s);
          let res = null, error = null, stages = {};
          try { res = await pb.flash(uf2, Object.assign({ progress: (s) => { stages[s] = (stages[s] || 0) + 1; } }, %s)); }
          catch (e) { error = e.message; }
          return { res, error, stages, log: dev.log, rebooted: dev.rebooted, excl: dev.excl,
                   flash: Array.from(dev.flash.slice(0, a.n)), skipped: uf2.skipped, blocks: uf2.blocks.length };
        """ % (mock_opts, family, opts), b64=__import__("base64").b64encode(image).decode(), pid=pid, n=len(image) // 512 * 256 + 4096)

    # ---- the pure parts ---------------------------------------------------------------
    def test_parse_skips_the_absolute_block(self):
        img, _ = synthetic()
        r = self.run_js("const u = P.parseUF2(Uint8Array.from(atob(a.b64), c => c.charCodeAt(0)), P.FAMILY.RP2350); return { n: u.blocks.length, skipped: u.skipped };",
                        b64=__import__("base64").b64encode(img).decode())
        self.assertEqual(r["n"], 36)
        self.assertEqual(r["skipped"], 1)

    def test_parse_refuses_junk(self):
        for junk in (b"x" * 100, b"\0" * 512):
            r = self.run_js("try { P.parseUF2(Uint8Array.from(atob(a.b64), c => c.charCodeAt(0)), null); return 'accepted'; } catch (e) { return e.message; }",
                            b64=__import__("base64").b64encode(junk).decode())
            self.assertNotEqual(r, "accepted")

    def test_parse_refuses_an_address_outside_flash(self):
        img = uf2([(0x20000000, b"\1" * 256)], 0xE48BFF59, extra_abs=False)
        r = self.run_js("try { P.parseUF2(Uint8Array.from(atob(a.b64), c => c.charCodeAt(0)), P.FAMILY.RP2350); return 'accepted'; } catch (e) { return e.message; }",
                        b64=__import__("base64").b64encode(img).decode())
        self.assertIn("outside flash", r)

    def test_a_chip_with_nothing_in_the_file_is_refused(self):
        img, _ = synthetic(family=0xE48BFF56, absolute=False)
        r = self.run_js("try { P.parseUF2(Uint8Array.from(atob(a.b64), c => c.charCodeAt(0)), P.FAMILY.RP2350); return 'accepted'; } catch (e) { return e.message; }",
                        b64=__import__("base64").b64encode(img).decode())
        self.assertIn("nothing for this chip", r)

    def test_frame_layout(self):
        r = self.run_js("""
          const f = P.frame(7, P.CMD.ERASE, [0x10001000, 0x2000], 0), x = P.frame(8, P.CMD.EXCLUSIVE, [1], 0);
          return { f: Array.from(f), x: Array.from(x) };""")
        f = bytes(r["f"])
        self.assertEqual(struct.unpack("<IIBBHI", f[:16]), (0x431FD10B, 7, 3, 8, 0, 0))
        self.assertEqual(struct.unpack("<II", f[16:24]), (0x10001000, 0x2000))
        self.assertEqual(len(f), 32)
        x = bytes(r["x"])
        self.assertEqual((x[8], x[9], x[16]), (1, 1, 1))

    # ---- a whole flash --------------------------------------------------------------------
    def test_flashes_an_rp2350_image_and_reads_it_back(self):
        img, data = synthetic()
        r = self.flash(img, 0x000F)
        self.assertIsNone(r["error"])
        self.assertTrue(r["res"]["verified"])
        n = len(data)
        self.assertEqual(bytes(r["flash"][:n]), data)
        # the bytes after the image, up to the end of its last sector, were erased
        self.assertTrue(all(b == 0xFF for b in r["flash"][n:4096 * 3]))
        self.assertEqual(r["skipped"], 1)

    def test_the_sequence_is_the_one_picotool_uses(self):
        img, _ = synthetic()
        log = self.flash(img, 0x000F)["log"]
        cmds = [l for l in log if l.startswith("cmd:")]
        names = [c.split(":")[1] for c in cmds]
        self.assertEqual(log[0], "ctl-out:41", "the interface is reset first")
        self.assertEqual(names[0:2], ["1", "6"], "exclusive access, then exit XIP")
        first_write = names.index("5")
        self.assertTrue(all(n == "3" for n in names[2:first_write]), "every erase comes before the first write")
        self.assertNotIn("3", names[first_write:], "no erase after writing starts")
        self.assertEqual(names[-1], "a", "the last command is the RP2350 reboot")
        self.assertIn("7", names, "command XIP is entered before reading back")
        self.assertLess(names.index("7"), names.index("84"))
        self.assertLess(max(i for i, n in enumerate(names) if n == "5"), names.index("84"), "reading back follows writing")

    def test_rp2350_reboots_normally_and_rp2040_uses_the_old_command(self):
        img, _ = synthetic()
        r = self.flash(img, 0x000F)
        self.assertEqual(r["rebooted"], {"id": 10, "flags": 0, "delay": 400})
        img40, _ = synthetic(family=0xE48BFF56, absolute=False)
        r = self.flash(img40, 0x0003, family="P.FAMILY.RP2040")
        self.assertEqual(r["rebooted"], {"id": 2, "pc": 0, "sp": 0, "delay": 400})

    def test_progress_reports_every_stage(self):
        img, _ = synthetic()
        s = self.flash(img, 0x000F)["stages"]
        for stage in ("erase", "write", "verify"):
            self.assertGreater(s.get(stage, 0), 0, stage)

    def test_a_read_back_that_does_not_match_stops_before_the_reboot(self):
        img, _ = synthetic()
        r = self.flash(img, 0x000F, mock_opts="{ corruptAt: 0x10000800 }")
        self.assertIn("does not match", r["error"])
        self.assertIsNone(r["rebooted"])

    def test_a_read_that_cannot_be_done_is_not_a_bad_write(self):
        img, _ = synthetic()
        r = self.flash(img, 0x000F, mock_opts="{ failRead: true }")
        self.assertIsNone(r["error"])
        self.assertFalse(r["res"]["verified"])
        self.assertIsNotNone(r["rebooted"])
        self.assertIn("verify-skipped", r["stages"])

    def test_verification_can_be_turned_off(self):
        img, _ = synthetic()
        r = self.flash(img, 0x000F, opts="{ verify: false }")
        self.assertNotIn("84", [l.split(":")[1] for l in r["log"] if l.startswith("cmd:")])

    def test_a_refused_command_reports_the_reason_from_the_status(self):
        r = self.run_js("""
          const dev = window.makeMock(0x000f); const pb = new P.Picoboot(dev); await pb.open();
          await pb.exitXip();
          try { await pb.erase(0x10000001, 4096); return 'accepted'; } catch (e) { return e.message; }""")
        self.assertIn("bad alignment", r)

    def test_flash_cannot_be_touched_before_exiting_xip(self):
        r = self.run_js("""
          const dev = window.makeMock(0x000f); const pb = new P.Picoboot(dev); await pb.open();
          try { await pb.erase(0x10000000, 4096); return 'accepted'; } catch (e) { return e.message; }""")
        self.assertIn("invalid state", r)

    def test_it_claims_the_vendor_interface_not_the_mass_storage_one(self):
        r = self.run_js("const dev = window.makeMock(0x000f); const pb = new P.Picoboot(dev); await pb.open(); return { n: pb.ifnum, o: pb.epOut, i: pb.epIn, c: dev.claimed };")
        self.assertEqual(r, {"n": 1, "o": 4, "i": 5, "c": True})

    def test_a_board_that_is_not_in_bootsel_is_explained(self):
        r = self.run_js("""
          const dev = window.makeMock(0x000f); dev.configuration.interfaces.pop();
          const pb = new P.Picoboot(dev);
          try { await pb.open(); return 'opened'; } catch (e) { return e.message; }""")
        self.assertIn("BOOTSEL", r)

    # ---- the real images --------------------------------------------------------------------
    def test_the_real_images(self):
        base = os.environ.get("RPC_IMAGES") or os.path.join(ROOT, "..", "RPCortex-v2", "out")
        ran = 0
        for board, pid, fam in (("pico2_w", 0x000F, "RP2350"), ("pico2", 0x000F, "RP2350"),
                                ("pico_w", 0x0003, "RP2040"), ("pico", 0x0003, "RP2040")):
            p = os.path.join(base, "rpcortex-v2-%s.uf2" % board)
            if not os.path.exists(p):
                continue
            img = open(p, "rb").read()
            r = self.flash(img, pid, family="P.FAMILY." + fam)
            self.assertIsNone(r["error"], board)
            self.assertTrue(r["res"]["verified"], board)
            # the image as the UF2 describes it is what is in flash
            expect = {}
            for o in range(0, len(img), 512):
                flags, addr, size, _, _, famid = struct.unpack("<IIIIII", img[o + 8:o + 32])
                if famid == (0xE48BFF59 if fam == "RP2350" else 0xE48BFF56):
                    expect[addr] = img[o + 32:o + 32 + size]
            lo = min(expect)
            for addr, data in list(expect.items())[::37]:
                self.assertEqual(bytes(r["flash"][addr - lo:addr - lo + len(data)]), data, "%s at %x" % (board, addr))
            ran += 1
        if not ran:
            self.skipTest("no real images beside this repository")


if __name__ == "__main__":
    unittest.main()
