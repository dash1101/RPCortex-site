/**
 * RPCortex — shared navigation behaviour (every page).
 *
 * Self-injects a mobile hamburger into the existing <nav> markup (so no page
 * needs extra HTML), wires the slide-down drawer, and adds a "scrolled" state
 * to the nav for the frosted-on-scroll effect. Keeps the warm summer theme.
 */
(function () {
  'use strict';

  var nav = document.querySelector('nav');
  if (!nav) return;
  var inner = nav.querySelector('.nav-inner');
  var links = nav.querySelector('.nav-links');
  if (!inner || !links) return;

  // ── Build the hamburger button ────────────────────────────────
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

  // Close after tapping a link, or when clicking outside the nav.
  links.querySelectorAll('a').forEach(function (a) {
    a.addEventListener('click', function () { setOpen(false); });
  });
  document.addEventListener('click', function (e) {
    if (links.classList.contains('open') && !nav.contains(e.target)) setOpen(false);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') setOpen(false);
  });

  // ── Frosted-on-scroll state ───────────────────────────────────
  function onScroll() {
    if (window.pageYOffset > 30) nav.classList.add('scrolled');
    else nav.classList.remove('scrolled');
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();
