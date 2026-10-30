/* Home page: fill the hardware table's firmware sizes and status from the release data.
   The table is written out in full in the page, so this only refines it. */
(function () {
  'use strict';
  var R = window.RPCReleases;
  if (!R) return;
  R.load().then(function (d) {
    var rel = R.newest(d);
    var rows = document.querySelectorAll('#boardRows tr[data-board]');
    Array.prototype.forEach.call(rows, function (tr) {
      var id = tr.getAttribute('data-board');
      if (rel) {
        for (var i = 0; i < rel.assets.length; i++) {
          var a = rel.assets[i];
          if (a.board === id && a.kind === 'bin') {
            tr.querySelector('[data-size]').textContent = Math.round(a.size / 1024) + ' KB';
          }
        }
      }
      if (d.boards) {
        for (var j = 0; j < d.boards.length; j++) {
          if (d.boards[j].id === id) {
            tr.querySelector('[data-status]').textContent =
              d.boards[j].status === 'verified' ? 'Run on hardware' : 'Not booted yet';
          }
        }
      }
    });
  });
})();
