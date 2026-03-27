# RPCortex — Website

Source for [rpc.novalabs.app](https://rpc.novalabs.app) — the official website for [RPCortex Nebula](https://github.com/dash1101/RPCortex).

Hosted on GitHub Pages with a custom domain.

---

## Pages

| File | URL | Description |
|------|-----|-------------|
| `index.html` | `/` | Landing page |
| `install.html` | `/install.html` | Web Installer — flash RPCortex from your browser |
| `update.html` | `/update.html` | Apply an OS update over USB |
| `packages.html` | `/packages.html` | Package browser + USB installer |
| `PackageDev.html` | `/PackageDev.html` | Package development guide |
| `NebulaDocs.html` | `/NebulaDocs.html` | Full documentation reference |
| `release.html` | `/release.html` | Release notes |

---

## Structure

```
index.html / install.html / ...   ← site pages
style.css                          ← shared stylesheet
js/
  installer.js                     ← web installer logic
  packages.js                      ← package browser + xfer
  serial-device.js                 ← Web Serial API wrapper
  terminal-demo.js                 ← animated hero terminal
  update.js                        ← OS update tool logic
img/                               ← screenshots
releases/                          ← .rpc OS release archives
github/                            ← markdown docs (for GitHub rendering)
CNAME                              ← GitHub Pages custom domain
```

---

## GitHub Pages setup

1. Go to repo **Settings → Pages**
2. Set source to **Deploy from branch → main → / (root)**
3. Under **Custom domain**, enter `rpc.novalabs.app`
4. Point your DNS to GitHub Pages (see [GitHub's guide](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site))

The `CNAME` file in the repo root handles the domain automatically once DNS is configured.

---

## Package repository

Packages are hosted in a separate repo: [dash1101/RPCortex-repo](https://github.com/dash1101/RPCortex-repo).

The package browser (`packages.html`) fetches from:
```
https://raw.githubusercontent.com/dash1101/RPCortex-repo/main/repo/index.json
```

---

*RPCortex by [dash1101](https://github.com/dash1101). MIT License.*
