/* Highlights the contents link of the section being read. Shared by every long page. */
(function () {
  'use strict';
  var sections = document.querySelectorAll('.docs-body h2[id]');
  var links = document.querySelectorAll('.docs-nav a[href^="#"]');
  if (!sections.length || !links.length || !('IntersectionObserver' in window)) return;
  var obs = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      Array.prototype.forEach.call(links, function (l) { l.classList.remove('active'); });
      var link = document.querySelector('.docs-nav a[href="#' + e.target.id + '"]');
      if (link) link.classList.add('active');
    });
  }, { rootMargin: '-20% 0px -70% 0px' });
  Array.prototype.forEach.call(sections, function (s) { obs.observe(s); });
})();
