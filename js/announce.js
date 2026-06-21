/* ===========================================================================
   NovaLabs — modular announcement popup
   ---------------------------------------------------------------------------
   A small, self-contained, NovaLabs-themed popup shown on page load. Used on
   both novalabs.app and rpc.novalabs.app.

   TO CHANGE OR ADD AN ANNOUNCEMENT: edit the ANNOUNCEMENT object below.
     - Bump `id` to a new value to re-show it to people who already dismissed
       the previous one.
     - Set `enabled: false` to turn the popup off entirely.
     - `repeat`: 'session' = once per browser session (default),
                 'once'    = once ever (until you change `id`),
                 'always'  = every page load.
   No other file needs editing — drop-in modular.
   =========================================================================== */
(function () {
  'use strict';

  var ANNOUNCEMENT = {
    enabled: true,
    id:      'v1.0-prerelease-2026-06',
    tag:     'New',
    title:   'RPCortex v1.0 “Vela” — pre-release',
    body:    'True multitasking has landed. v1.0 is available now as an opt-in ' +
             'pre-release — grab it from the installer (pick “Pre-release”) or ' +
             'run “update channel beta” on-device. v0.9.1 stays the recommended ' +
             'stable build.',
    cta:     'Check it out',
    href:    'release',
    repeat:  'session'
  };

  var A = ANNOUNCEMENT;
  if (!A.enabled) return;

  // ---- repeat policy: has this announcement already been dismissed? --------
  var KEY = 'nl-announce-' + A.id;
  try {
    if (A.repeat === 'session' && sessionStorage.getItem(KEY)) return;
    if (A.repeat === 'once'    && localStorage.getItem(KEY))   return;
  } catch (e) { /* storage blocked — just show it */ }

  function remember() {
    try {
      if (A.repeat === 'session') sessionStorage.setItem(KEY, '1');
      else if (A.repeat === 'once') localStorage.setItem(KEY, '1');
    } catch (e) {}
  }

  // ---- self-contained styles (NovaLabs theme) ------------------------------
  var css = ''
    + '.nl-ann-ov{position:fixed;inset:0;z-index:99999;display:flex;'
    + 'align-items:center;justify-content:center;padding:24px;'
    + 'background:rgba(4,7,16,.62);backdrop-filter:blur(8px);'
    + '-webkit-backdrop-filter:blur(8px);opacity:0;transition:opacity .3s ease;'
    + 'font-family:"Segoe UI",-apple-system,BlinkMacSystemFont,Roboto,Arial,sans-serif;}'
    + '.nl-ann-ov.in{opacity:1;}'
    + '.nl-ann{position:relative;max-width:440px;width:100%;'
    + 'background:linear-gradient(157deg,rgba(20,26,58,.92),rgba(8,11,28,.94));'
    + 'border:1px solid rgba(99,102,241,.32);border-radius:20px;'
    + 'box-shadow:0 24px 70px rgba(0,0,0,.55),0 0 60px rgba(56,189,248,.12);'
    + 'padding:30px 30px 26px;color:#e6edf8;transform:translateY(14px) scale(.98);'
    + 'transition:transform .32s cubic-bezier(.2,.8,.2,1);overflow:hidden;}'
    + '.nl-ann-ov.in .nl-ann{transform:none;}'
    + '.nl-ann::before{content:"";position:absolute;left:0;top:0;right:0;height:3px;'
    + 'background:linear-gradient(90deg,#38bdf8,#3b82f6,#6366f1);}'
    + '.nl-ann-tag{display:inline-flex;align-items:center;gap:7px;font-size:.72rem;'
    + 'font-weight:700;letter-spacing:1.5px;text-transform:uppercase;'
    + 'color:#38bdf8;margin-bottom:12px;}'
    + '.nl-ann-tag i{width:8px;height:8px;border-radius:50%;background:#fbbf24;'
    + 'box-shadow:0 0 10px rgba(251,191,36,.8);display:inline-block;}'
    + '.nl-ann h3{font-size:1.5rem;font-weight:800;margin:0 0 10px;'
    + 'background:linear-gradient(135deg,#5eead4,#38bdf8,#6366f1);'
    + '-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;}'
    + '.nl-ann p{margin:0 0 22px;line-height:1.6;color:#aab8d6;font-size:.96rem;}'
    + '.nl-ann-btn{appearance:none;border:none;cursor:pointer;font-weight:700;'
    + 'font-size:.92rem;padding:11px 26px;border-radius:11px;color:#fff;'
    + 'background:linear-gradient(135deg,#38bdf8,#6366f1);'
    + 'box-shadow:0 6px 22px rgba(59,130,246,.35);transition:transform .2s ease,box-shadow .2s ease;}'
    + '.nl-ann-btn:hover{transform:translateY(-2px);box-shadow:0 10px 30px rgba(59,130,246,.5);}'
    + '.nl-ann-x{position:absolute;top:14px;right:16px;width:30px;height:30px;'
    + 'border:none;background:transparent;color:#8595b8;font-size:1.5rem;line-height:1;'
    + 'cursor:pointer;border-radius:8px;transition:color .2s,background .2s;}'
    + '.nl-ann-x:hover{color:#fff;background:rgba(255,255,255,.08);}'
    + '@media (prefers-reduced-motion:reduce){.nl-ann-ov,.nl-ann{transition:none;}}';

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function show() {
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    var ov = document.createElement('div');
    ov.className = 'nl-ann-ov';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.innerHTML =
      '<div class="nl-ann">' +
        '<button class="nl-ann-x" aria-label="Close">×</button>' +
        '<div class="nl-ann-tag"><i></i>' + esc(A.tag) + '</div>' +
        '<h3>' + esc(A.title) + '</h3>' +
        '<p>' + esc(A.body) + '</p>' +
        '<button class="nl-ann-btn">' + esc(A.cta) + '</button>' +
      '</div>';
    document.body.appendChild(ov);
    requestAnimationFrame(function () { ov.classList.add('in'); });

    function close() {
      remember();
      ov.classList.remove('in');
      setTimeout(function () { if (ov.parentNode) ov.parentNode.removeChild(ov); }, 320);
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }

    ov.querySelector('.nl-ann-btn').addEventListener('click', function () {
      close();
      if (A.href) window.location.href = A.href;   // optional CTA link
    });
    ov.querySelector('.nl-ann-x').addEventListener('click', close);
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    document.addEventListener('keydown', onKey);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', show);
  } else {
    show();
  }
})();
