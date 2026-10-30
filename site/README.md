# Working on rpc.novalabs.app

The site is static and is served from this repository as it stands, so **a push to `main` is a
deployment**. Pages are generated from sources in `site/`; the generated `.html` files are committed
next to them.

```
python3 site/build.py            # rebuild the site into the repository root
python3 site/build.py --check    # build to a scratch folder and only check links
python3 site/build.py --out DIR --status "Draft preview"   # a complete copy for a preview
```

A build fails on a broken link, a missing anchor, or a `{{placeholder}}` left unfilled.

## How a release reaches the site

It does without anyone editing this repository.

1. A release is cut in the OS repository with `tools/release.py` (see `RELEASING.md` there). That
   writes `releases/releases.json` (the history) and `releases/boards.json` (which boards have run
   which build) on its `main` branch.
2. The browser reads both files from `raw.githubusercontent.com` (`js/releases.js`). So the moment the
   release commit is pushed:
   - the green **release bar** above the nav on every page names the newest build and links to its notes,
   - the **Releases** page lists it, with its summary and its Added / Changed / Fixed / Known limitations,
   - the **Get** page offers its images for each board, with size and SHA-256, and shows which boards have run it,
   - the **home** page's version and hardware table follow.
3. Older releases (v1 and before) are in `data/legacy.json` on this site; they are not in the OS
   repository's history.

If the data cannot be read, every page keeps the static text it was built with, and the Get page falls
back to the images the update channel always points at. Nothing breaks.

To change what a release says, change the notes in the OS repository's `CHANGELOG.md` before cutting it.
To change which boards show as run on hardware, edit `releases/boards.json` in the OS repository.

## Where things live

| To change | Edit |
|---|---|
| Wording on the home, Get, Releases or Roadmap page | `site/pages/<page>.html` |
| The roadmap | `site/data/roadmap.json` (one entry per release; each block is a paragraph, a label, a list of items with `done`, or a note) |
| Which documentation versions exist, and their order | `site/data/docs.json`, and a body in `site/docs/` |
| The nav, the footer, a one-line notice on every page | `site/data/site.json` (`status.text`; empty hides it) |
| Releases older than the OS repository's history | `data/legacy.json` |
| Look and feel | `ds/` (shared with novalabs.app, see `ds/README.md`) and `css/rpc.css` |

## Carried pages

The web installer, the updater and the package browser (`install`, `update`, `packages`) and the
long-form pages (documentation bodies, release notes for v1 and earlier, the package guides, privacy)
were carried over from the previous site. Their markup and scripts are unchanged, so the class names
and element ids in `site/pages/install.html`, `update.html`, `packages.html` and in `js/installer.js`,
`js/update.js`, `js/packages.js` and `js/serial-device.js` must stay as they are. `css/legacy.css` maps
their old styles onto the shared design system; retire a section of it when its page is rebuilt.

Links inside carried content are written the old way (`packages`, `docs?v=v1.0.0#x`). The generator
rewrites them so they work from any folder.

Hardware pages cannot be tested without a device: the installer and updater use Web Serial, and the
package browser reads a board's installed packages. After changing any of them, try them against a real board.

## The browser installer (v2)

`flash.html` flashes a Pico from the browser: it downloads the `.uf2` from the OS repository
(`raw.githubusercontent.com`, which allows cross-origin downloads; GitHub release downloads do not),
checks it against the SHA-256 in `releases.json`, and writes it through the boot ROM's PICOBOOT
interface over WebUSB (`js/picoboot.js`). A running board can be restarted into BOOTSEL from the
page with a 1200-baud serial touch. It is optional: the drag-and-drop install on the Get page always works.

`python3 site/test_picoboot.py` runs the protocol against a mock of the boot ROM in headless Chromium
(it needs Playwright) and flashes the real images if the OS repository is checked out beside this one.
**It has not been run against a real board.** The first run on hardware is the test that matters; see the
DEVICE-UNCONFIRMED notes at the top of `js/picoboot.js` for what is most likely to need a change.

## Why release images are committed to the OS repository

A browser can only download a file cross-origin if the host sends `Access-Control-Allow-Origin`.
`raw.githubusercontent.com`, GitHub Pages and jsDelivr do; GitHub release downloads redirect to a host that
does not. So the images the update channel and the browser installer read stay in the OS repository's
`releases/` folder, and the web installer's `.rpc` archives stay on this site.

## Things that must not move

- **`releases/`** holds the v1 over-the-air manifest (`latest.json`), the version pickers and the
  `.rpc` archives that v1 devices download. v1 devices fetch these URLs; do not rename or rebuild them.
- **The four file filters** (`js/installer.js`, `js/update.js` here; `Core/rpc_install.py`,
  `Core/rpc_stub.py` in the v1 OS repository) must agree. Change one, change all four.
- **Existing public URLs** (`/get`, `/install`, `/update`, `/packages`, `/roadmap`, `/release-vela2`,
  `/docs?v=v1.0.0`) keep working.

## Statements that must follow the products

- What is current: the home page copy, the Get page's v1 card, `data/legacy.json`.
- The privacy page describes v1 (for example how Wi-Fi passwords are stored). v2 seals them.
