// Starfall Spires — input. Pointer raycasting onto the arena plane, card
// selection, placement ghost, and keyboard shortcuts. It knows nothing about
// the simulation except through the callbacks main.js wires up.
(function () {
  'use strict';

  var selected = -1; // hand index, or -1
  var hover = null; // {x, z} ground point under the cursor
  var hooks = null;

  function ghostRadius() {
    if (!hooks || selected < 0) return 1;
    var key = hooks.handCard(selected);
    if (!key) return 1;
    var def = window.SS.config.CARDS[key];
    return def.kind === 'spell' ? def.radius : 1.0;
  }

  function refreshGhost() {
    if (!hooks) return;
    if (selected < 0 || !hover || hooks.isFrozen()) {
      window.SS.render.hideGhost();
      return;
    }
    var valid = hooks.canDeploy(selected, hover.x, hover.z);
    window.SS.render.showGhost(hover.x, hover.z, ghostRadius(), valid);
  }

  function select(index) {
    if (!hooks) return;
    if (index === selected) {
      selected = -1;
    } else {
      selected = index;
      window.SS.audio.select();
    }
    hooks.onSelect(selected);
    refreshGhost();
  }

  function cancel() {
    if (selected >= 0) {
      selected = -1;
      if (hooks) hooks.onSelect(-1);
      refreshGhost();
      return true;
    }
    return false;
  }

  function attach(canvas, h) {
    hooks = h;
    canvas.addEventListener('pointermove', function (ev) {
      hover = window.SS.render.screenToGround(ev.clientX, ev.clientY);
      refreshGhost();
    });
    canvas.addEventListener('pointerleave', function () {
      hover = null;
      refreshGhost();
    });
    canvas.addEventListener('pointerdown', function (ev) {
      window.SS.audio.unlock();
      if (ev.button === 2) { cancel(); return; }
      if (ev.button !== 0) return;
      if (!hooks || !hooks.isPlaying()) return;
      var pt = window.SS.render.screenToGround(ev.clientX, ev.clientY);
      if (!pt) return;
      if (selected >= 0) {
        var ok = hooks.tryDeploy(selected, pt.x, pt.z);
        if (ok) {
          selected = -1;
          hooks.onSelect(-1);
        } else {
          hooks.onDeployDenied(selected, pt.x, pt.z);
        }
        refreshGhost();
      }
    });
    canvas.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });
    document.addEventListener('keydown', function (ev) {
      if (!hooks) return;
      var k = ev.key;
      if (k >= '1' && k <= '4') {
        if (hooks.isPlaying()) select(parseInt(k, 10) - 1);
      } else if (k === 'Escape') {
        if (!cancel()) hooks.onEscape();
      } else if (k === 'p' || k === 'P') {
        hooks.onPauseKey();
      } else if (k === 'r' || k === 'R') {
        hooks.onRestartKey();
      } else if (k === 'm' || k === 'M') {
        hooks.onMuteKey();
      }
    });
  }

  function setSelected(index) {
    selected = index;
    if (hooks) hooks.onSelect(selected);
    refreshGhost();
  }

  function forceGhost(x, z, radius, valid) {
    window.SS.render.showGhost(x, z, radius, valid);
  }

  window.SS = window.SS || {};
  window.SS.input = {
    attach: attach,
    select: select,
    cancel: cancel,
    setSelected: setSelected,
    forceGhost: forceGhost,
    selected: function () { return selected; },
    hover: function () { return hover; },
  };
})();
