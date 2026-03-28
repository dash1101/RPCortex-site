# RPCortex Nebula — v0.8.1-beta3
### `v0.8.1-beta3` | Codenamed **Nebula** | β81

> Full feature reference: [NebulaDocs](https://rpc.novalabs.app/NebulaDocs.html)

---

## Status

**Beta.** Stable on RP2040, RP2350, and ESP32-S3. Recommended upgrade from beta2.

---

## What's New in beta3

**Shell — multi-command lines**
- Multiple commands can be run on one line with `;` as a separator: `mkdir /data; cd /data; touch file.txt`
- Quote-aware splitting — `;` inside single or double quotes is treated as literal text

**Shell — new commands**
- `grep <pattern> <file>` — substring search with line numbers and match count; line-by-line for low RAM
- `wc <file>` — line / word / byte count
- `find [dir] [pattern]` — recursive file search by name substring (max depth 8)
- `sort <file>` — alphabetical sort with 8 KB RAM warning
- `uniq <file>` — consecutive duplicate line filter
- `hex <file> [n]` — 16-byte-per-row hexdump with address, hex, and ASCII columns
- `basename <path>` / `dirname <path>` — path component extraction
- `sleep <secs>` — pause the shell (supports decimal, e.g. `sleep 0.5`)
- `which <cmd>` — shows where a command is defined: built-in, `.lp` registry entry, or alias
- `rawrepl` — cleanly exit the OS and return to MicroPython REPL (for Web Installer use)

**Shell — performance**
- Removed redundant re-inject on every cached command call — saves 6 `setattr` calls per dispatch

**Browser tools**
- **OS Update page** — version picker now driven by `releases/updates.json`; add new versions to the JSON without touching HTML
- **Install page** — version picker driven by `releases/releases.json`; same pattern
- **Package Browser** — auto-disconnects the device after a successful package install
- **Package Browser** — each package card now has a **Download .pkg** button (fetch + blob, no CORS issues)

---

## What's New in beta2 (included)

**Shell overhaul**
- Tab completion with ghost text — partial command names show a dim gray suffix; press Tab to accept
- Shell aliases — `alias name=cmd` creates session aliases; `unalias` removes them; bare `alias` lists all
- Full cursor navigation: left/right arrows, Home/End, Ctrl+A/E, Delete-forward, character insertion mid-line

**OS management — from the shell**
- `update from-file <path>` — apply a `.rpc` update archive while preserving all user data
- `factoryreset` — wipe users, packages, and logs; OS files untouched; reboots into first-run setup
- `reinstall` — full OS wipe with optional `.rpc` auto-install; use when recovery isn't enough

**Browser tools**
- **Web Installer** — flash RPCortex from any Chromium browser over USB; no software, no drivers; wipes device before install for a clean slate
- **Browser update page** — push a `.rpc` update from a browser tab to a running device; no WiFi, no raw REPL
- **Web package browser** — install packages from the browser to a running shell over USB; no reboot required

**Registry & boot**
- Config cached in memory — registry reads no longer touch the filesystem on every call
- `Settings.Verbose_Boot` — toggle how much POST prints at boot
- `Settings.OC_On_Boot` — apply stored overclock on every boot automatically
- Log directory auto-created by POST on first boot

**Serial file transfer (`_xfer`)**
- Built-in protocol for receiving files from the browser over serial using base64
- Used by the web package browser and update page to push files without leaving the shell

**First-run setup**
- Official package repo added automatically
- `guest` account created silently
- Post-update login banner shows the new version after a successful update

**Bug fixes (beta2)**
- `ls` no longer changes CWD when given a path argument
- POST beeper crash fixed
- Recovery shell crash in `initialization.py` fixed
- Startup mode 7 (boot-clock crash) now shows a login notification

**Bug fixes (beta3)**
- Ctrl+C cancel fixed
- Tab completion ghost-text edge case fixed
- `rm` recursion fix

---

## Installation

**Fresh install:** [Web Installer](https://rpc.novalabs.app/install.html) — flash from your browser, no software needed.

**Update from beta2:** [OS Update page](https://rpc.novalabs.app/update.html) or `update from-file /path/to/os.rpc` from the shell. User data and settings are preserved.

**Manual:** Flash MicroPython v1.25+ (v1.28 recommended), copy files, connect at 115200 baud, reboot.

---

## Using rawrepl for a fresh install

If RPCortex is already installed and you want a completely fresh flash:

1. At the shell prompt, run `rawrepl`
2. The MicroPython REPL (`>>>`) becomes active in your terminal
3. Open [rpc.novalabs.app/install.html](https://rpc.novalabs.app/install.html) in Chrome or Edge
4. Click **Connect Device** and flash as normal

No need for `reinstall` or a full wipe — `rawrepl` simply exits the OS and hands control back to MicroPython.

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
