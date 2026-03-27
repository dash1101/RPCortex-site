# RPCortex Nebula — v0.8.1-beta2
### `v0.8.1-beta2` | Codenamed **Nebula** | β81

> Full feature reference: [NebulaDocs](https://rpc.novalabs.app/NebulaDocs.html)

---

## Status

**Stable.** Ships in a clean factory-default state. Confirmed working on RP2040, RP2350, and ESP32-S3.

---

## What's New

**Shell overhaul**
- Tab completion with ghost text — partial command names show a dim gray suffix; press Tab to accept
- Shell aliases — `alias name=cmd` creates session aliases; `unalias` removes them; bare `alias` lists all
- Full cursor navigation: left/right arrows, Home/End, Ctrl+A/E, Delete-forward, character insertion mid-line

**OS management — from the shell**
- `update from-file <path>` — apply a `.rpc` update archive while preserving all user data
- `factoryreset` — wipe users, packages, and logs; OS files untouched; reboots into first-run setup
- `reinstall` — full OS wipe with optional `.rpc` auto-install; use when recovery isn't enough

**Browser tools**
- **Web Installer** — flash RPCortex from any Chromium browser over USB; no software, no drivers; now wipes device before install for a clean slate
- **Browser update page** — push a `.rpc` update from a browser tab to a running device; no WiFi, no raw REPL
- **Web package browser** — install packages from the browser to a running shell over USB; no reboot required

**Registry & boot**
- Config cached in memory — registry reads no longer touch the filesystem on every call
- `Settings.Verbose_Boot` — toggle how much POST prints at boot (on/off)
- `Settings.OC_On_Boot` — apply stored overclock on every boot automatically
- Log directory auto-created by POST on first boot

**Serial file transfer (`_xfer`)**
- New built-in protocol for receiving files from the browser over serial using base64
- Used by the web package browser and update page to push files without leaving the shell

**First-run setup**
- Official package repo added automatically — no extra setup step
- `guest` account created silently
- Verbose boot preference asked during setup
- Post-update login banner shows the new version after a successful update

**Bug fixes**
- `ls` no longer changes CWD when given a path argument
- POST beeper crash fixed
- Recovery shell crash in `initialization.py` fixed
- Startup mode 7 (boot-clock crash) now shows a login notification

---

## Installation

**Fresh install:** [Web Installer](https://rpc.novalabs.app/install.html) — flash from your browser, no software needed.

**Update:** [OS Update page](https://rpc.novalabs.app/update.html) or `update from-file /path/to/os.rpc` from the shell. User data is preserved.

**Manual:** Flash MicroPython v1.25+ (v1.28 recommended), copy files, connect at 115200 baud, reboot.

---

## Known Limitations

- MemoryError after heavy use — run `freeup`; `reboot` clears completely
- ESP32-S3 temperature reads ~300–450 °C — hardware calibration issue, not a bug
- No real-time clock on base Pico — `date` shows time since boot epoch
- HTTPS on Pico 1 W needs ~9.5 KB contiguous heap — run `freeup` first
- WiFi passwords stored plaintext in registry — no secure enclave on this hardware
- Editor requires a real terminal — Thonny REPL won't render it

---

## What's Next

- SD card support
- `update check` — online update check (reserved)

---

**Author:** [dash1101](https://github.com/dash1101). Issues and PRs welcome.
