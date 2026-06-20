/**
 * RPCortex — shared navigation + ambient UI (every page).
 *
 * Brings the RPCortex site in line with the NovaLabs design language while
 * keeping it a touch more "techy" (mono wordmark, terminal texture):
 *   • injects the NovaLabs-style floating glass background (orbs + stars),
 *   • upgrades the <nav> to the shared chrome — chip logo + wordmark,
 *     .nav-link hover-underline, and an .active state for the current page,
 *   • self-injects the mobile hamburger drawer + frosted-on-scroll state,
 *   • loads the shared announcement popup.
 * One file, so every page picks it up with no extra per-page markup.
 */
(function () {
  'use strict';

  // ── Floating glass background: NovaLabs orbs + stars (inject once) ──────
  if (!document.querySelector('.background')) {
    var bg = document.createElement('div');
    bg.className = 'background';
    bg.setAttribute('aria-hidden', 'true');
    bg.innerHTML =
      '<div class="gradient-orb orb-1"></div>' +
      '<div class="gradient-orb orb-2"></div>' +
      '<div class="gradient-orb orb-3"></div>' +
      '<div class="stars"></div>';
    document.body.insertBefore(bg, document.body.firstChild);
  }

  var nav = document.querySelector('nav');
  if (!nav) return;
  nav.classList.add('navbar');
  var inner = nav.querySelector('.nav-inner');
  var links = nav.querySelector('.nav-links');
  if (!inner || !links) return;

  // ── Logo: chip mark + mono wordmark (NovaLabs structure, RPCortex flavour) ──
  var logo = nav.querySelector('.nav-logo');
  if (logo && !logo.querySelector('.nav-logo-svg')) {
    var txt = logo.textContent.trim() || 'RPCortex';
    logo.textContent = '';
    var img = document.createElement('img');
    img.className = 'nav-logo-svg';
    img.src = 'logo.svg';
    img.alt = 'RPCortex';
    logo.appendChild(img);
    var title = document.createElement('span');
    title.className = 'nav-title';
    title.textContent = txt;
    logo.appendChild(title);
  }

  // ── nav-link styling + active state for the current page ────────────────
  var here = (location.pathname.split('/').pop() || 'index.html')
    .replace(/\.html$/, '') || 'index';
  links.querySelectorAll('a').forEach(function (a) {
    if (!a.classList.contains('nav-discord')) a.classList.add('nav-link');
    var href = (a.getAttribute('href') || '').split('/').pop().split('#')[0]
      .replace(/\.html$/, '');
    if (href && href === here) a.classList.add('active');
  });

  // ── Mobile hamburger drawer ─────────────────────────────────────────────
  var btn = document.createElement('button');
  btn.className = 'nav-toggle';
  btn.setAttribute('aria-label', 'Toggle navigation');
  btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = '<span class="hamburger"></span>';
  inner.appendChild(btn);

  function setOpen(open) {
    links.classList.toggle('open', open);
    btn.classList.toggle('active', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    setOpen(!links.classList.contains('open'));
  });

  links.querySelectorAll('a').forEach(function (a) {
    a.addEventListener('click', function () { setOpen(false); });
  });
  document.addEventListener('click', function (e) {
    if (links.classList.contains('open') && !nav.contains(e.target)) setOpen(false);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') setOpen(false);
  });

  // ── Frosted-on-scroll state ─────────────────────────────────────────────
  function onScroll() {
    if (window.pageYOffset > 30) nav.classList.add('scrolled');
    else nav.classList.remove('scrolled');
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // ── Shared announcement popup ───────────────────────────────────────────
  var ann = document.createElement('script');
  ann.src = 'js/announce.js';
  document.head.appendChild(ann);
})();
