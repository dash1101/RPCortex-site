# Nova design system

The stylesheet, fonts and menu script shared by novalabs.app and rpc.novalabs.app.

| File | What |
|---|---|
| `ds.css` | Tokens, the night-sky background, the nav, type, buttons, panels, tables, steps, release list, docs prose, footer |
| `ds.js` | The mobile menu. Nothing else needs script |
| `fonts/` | Bricolage Grotesque, Instrument Sans and JetBrains Mono, latin subset, self-hosted (SIL Open Font License) |

Both sites keep an identical copy of this folder. Fonts are served from the site itself because
the privacy page promises no tracking, and a request to a font host would send every visitor's
address to a third party.

## Changing it

The copy in this repository is the source. After a change here:

1. Copy `ds/` over the other site's `ds/` (`cp -r ds/. ../RPCortex-site/ds/`).
2. Rebuild and look at both sites.
3. Commit both repositories together, with the same message, so the two never drift for long.

A site changes its own look only through its own small stylesheet loaded after `ds.css`
(`nova.css` here, `rpc.css` there). The accent is the one token a site is expected to re-value:
`--accent`, `--on-accent` and `--accent-hover`.

## Rules

- Dark only. The brand is the night sky.
- One accent per site. Colour that means status (done, partial, next) is separate from it.
- Glass (blur) on the nav bar only. Everything else is solid.
- The sky is gradients on `body::before` and `::after`, never extra elements, and it is still under reduced motion.
- A claim on a page is a number read off real hardware, or it says it has not been.
