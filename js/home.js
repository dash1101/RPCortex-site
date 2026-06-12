/**
 * RPCortex — landing-page interactivity (index only).
 *
 * Brings the page to life with the same energy as the Nova home:
 *   · mouse-parallax on the background orbs
 *   · count-up animation on the stat band (fires when scrolled into view)
 *   · scroll-reveal for cards/sections (staggered)
 *   · subtle warm click ripples
 * All motion respects prefers-reduced-motion.
 */
(function () {
  'use strict';

  var reduced = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── Count-up stat band ───────────────────────────────────────── */
  function animateValue(el) {
    var target   = parseFloat(el.getAttribute('data-target'));
    var decimals = parseInt(el.getAttribute('data-decimals') || '0', 10);
    var suffix   = el.getAttribute('data-suffix') || '';
    var prefix   = el.getAttribute('data-prefix') || '';
    if (isNaN(target)) return;

    if (reduced) {
      el.textContent = prefix + target.toFixed(decimals) + suffix;
      return;
    }
    var duration = 1600;
    var start = null;
    function tick(ts) {
      if (start === null) start = ts;
      var p = Math.min((ts - start) / duration, 1);
      // easeOutCubic
      var eased = 1 - Math.pow(1 - p, 3);
      var val = target * eased;
      el.textContent = prefix + val.toFixed(decimals) + suffix;
      if (p < 1) requestAnimationFrame(tick);
      else el.textContent = prefix + target.toFixed(decimals) + suffix;
    }
    requestAnimationFrame(tick);
  }

  /* ── Auto-tag grid items for staggered reveal (no HTML churn) ─── */
  ['.feature-grid', '.docs-grid', '.cmd-grid',
   '.screenshot-grid', '.steps'].forEach(function (sel) {
    var grid = document.querySelector(sel);
    if (!grid) return;
    var items = grid.children;
    for (var i = 0; i < items.length; i++) {
      items[i].classList.add('reveal');
      items[i].style.setProperty('--delay', (Math.min(i, 6) * 0.06) + 's');
    }
  });
  // Reveal each section heading too.
  document.querySelectorAll('.section h2').forEach(function (h) { h.classList.add('reveal'); });

  /* ── Scroll reveal + stat trigger ─────────────────────────────── */
  var revealEls = document.querySelectorAll('.reveal');
  var statEls   = document.querySelectorAll('.stat-num[data-target]');

  function revealAll() {
    revealEls.forEach(function (el) { el.classList.add('in'); });
  }
  // Snap stats straight to their final value — used by the safety net so the
  // numbers are never left stuck if requestAnimationFrame is throttled/stalled.
  function snapAllStats() {
    statEls.forEach(function (el) {
      var t = parseFloat(el.getAttribute('data-target'));
      if (isNaN(t)) return;
      var d = parseInt(el.getAttribute('data-decimals') || '0', 10);
      el.textContent = (el.getAttribute('data-prefix') || '') +
                       t.toFixed(d) + (el.getAttribute('data-suffix') || '');
      el._done = true;
    });
  }

  if ('IntersectionObserver' in window) {
    var revObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); revObs.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    revealEls.forEach(function (el) { revObs.observe(el); });

    var statObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting && !e.target._done) {
          e.target._done = true; animateValue(e.target); statObs.unobserve(e.target);
        }
      });
    }, { threshold: 0.4 });
    statEls.forEach(function (el) { statObs.observe(el); });

    // Safety net: if the observer never fires (programmatic environments,
    // odd layouts) or rAF is throttled, reveal everything and snap the stat
    // numbers to their final value so nothing is ever stuck.
    setTimeout(function () { revealAll(); snapAllStats(); }, 4000);
  } else {
    revealAll();
    snapAllStats();
  }

  /* ── Mouse-parallax on background orbs ────────────────────────── */
  if (!reduced) {
    var orbs = document.querySelectorAll('.scene-orb');
    if (orbs.length) {
      var tx = 0, ty = 0, cx = 0, cy = 0;
      window.addEventListener('mousemove', function (e) {
        tx = (e.clientX / window.innerWidth - 0.5);
        ty = (e.clientY / window.innerHeight - 0.5);
      }, { passive: true });
      (function raf() {
        cx += (tx - cx) * 0.06;
        cy += (ty - cy) * 0.06;
        for (var i = 0; i < orbs.length; i++) {
          var sp = (i + 1) * 14;
          orbs[i].style.transform =
            'translate(' + (cx * sp).toFixed(1) + 'px,' + (cy * sp).toFixed(1) + 'px)';
        }
        requestAnimationFrame(raf);
      })();
    }
  }

  /* ── Subtle warm click ripple ─────────────────────────────────── */
  if (!reduced) {
    var COLORS = ['#2dd4be', '#fb923c', '#f9a8d4', '#fde68a'];
    document.addEventListener('click', function (e) {
      // Don't fire on form controls / the terminal demo.
      if (e.target.closest('a, button, input, select, textarea, .hero-term')) return;
      for (var i = 0; i < 6; i++) spawnSpark(e.clientX, e.clientY, COLORS[i % COLORS.length]);
    });
  }

  function spawnSpark(x, y, color) {
    var s = document.createElement('span');
    s.className = 'click-spark';
    s.style.left = x + 'px';
    s.style.top  = y + 'px';
    s.style.background = 'radial-gradient(circle, ' + color + ', transparent 70%)';
    document.body.appendChild(s);
    var ang = Math.random() * Math.PI * 2;
    var vel = 28 + Math.random() * 34;
    var dx = Math.cos(ang) * vel, dy = Math.sin(ang) * vel;
    var t0 = null;
    function move(ts) {
      if (t0 === null) t0 = ts;
      var p = (ts - t0) / 620;
      if (p >= 1) { s.remove(); return; }
      s.style.transform = 'translate(' + (dx * p) + 'px,' + (dy * p + 18 * p * p) + 'px) scale(' + (1 - p) + ')';
      s.style.opacity = String(1 - p);
      requestAnimationFrame(move);
    }
    requestAnimationFrame(move);
  }
})();
