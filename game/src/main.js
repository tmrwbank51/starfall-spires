// Starfall Spires — entry point. Boots the renderer, interface and input,
// runs the fixed-step loop, drains simulation events into sound and visuals,
// and hosts the deterministic shot scenes (?shot=) and the probe API the
// play-tests drive. The game itself needs no network and no storage.
(function () {
  'use strict';

  var CFG = window.SS.config;
  var STEP = 1 / 60;

  var screen = 'title'; // 'title' | 'playing' | 'paused' | 'over'
  var match = null;
  var deckIndex = 0;
  var selected = -1;
  var frozen = false;
  var acc = 0;
  var lastT = 0;
  var simTime = 0; // wall-clock time for animation
  var autoplay = false;
  var autoThinkIn = 0;
  var seedCounter = 1;
  var shotReady = false;

  function params() {
    var out = {};
    var q = window.location.search.replace(/^\?/, '');
    if (!q) return out;
    q.split('&').forEach(function (pair) {
      var kv = pair.split('=');
      out[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
    });
    return out;
  }

  function newMatch(deck, seed) {
    window.SS.render.reset();
    match = window.SS.sim.createMatch(deck, seed);
    selected = -1;
    acc = 0;
    autoThinkIn = 0.5;
  }

  function startGame(deck, seed) {
    newMatch(deck, seed === undefined ? (seedCounter++ * 7919 + 13) : seed);
    window.SS.ui.hideTitle();
    window.SS.ui.hideEnd();
    window.SS.ui.showPause(false);
    screen = 'playing';
    window.SS.ui.updateHand(match, -1);
    window.SS.ui.updateTop(match);
    window.SS.ui.banner('Raze the Umbral keep!', 2.4);
  }

  function toTitle() {
    screen = 'title';
    frozen = false;
    autoplay = false;
    window.SS.render.reset();
    match = null;
    window.SS.ui.hideEnd();
    window.SS.ui.showPause(false);
    window.SS.ui.showTitle(deckIndex, pickDeck, function () { startGame(deckIndex); });
  }

  function pickDeck(idx) {
    deckIndex = idx;
    window.SS.ui.showTitle(deckIndex, pickDeck, function () { startGame(deckIndex); });
  }

  function togglePause() {
    if (screen === 'playing') {
      screen = 'paused';
      window.SS.ui.showPause(true, resume, restart, toTitle);
    } else if (screen === 'paused') {
      resume();
    }
  }
  function resume() {
    screen = 'playing';
    window.SS.ui.showPause(false);
  }
  function restart() {
    startGame(deckIndex);
  }

  function toggleMute() {
    var m = !window.SS.audio.isMuted();
    window.SS.audio.setMuted(m);
    window.SS.ui.setMuted(m);
  }

  // ---- Event draining: simulation events become sound, visuals, banners. ----
  function drainEvents() {
    if (!match) return;
    var evs = match.events;
    for (var i = 0; i < evs.length; i++) {
      var ev = evs[i];
      window.SS.render.onEvent(ev, match);
      if (ev.type === 'deploy') window.SS.audio.deploy();
      else if (ev.type === 'shoot') window.SS.audio.shoot();
      else if (ev.type === 'hit' && ev.big) window.SS.audio.hit();
      else if (ev.type === 'spellHit' || ev.type === 'splash') window.SS.audio.explosion();
      else if (ev.type === 'towerDown') window.SS.audio.towerDown();
      else if (ev.type === 'crown') window.SS.audio.crown();
      else if (ev.type === 'heal') window.SS.audio.heal();
      else if (ev.type === 'double') window.SS.ui.banner('Double starlight!', 2.4);
      else if (ev.type === 'overtime') window.SS.ui.banner('Overtime — next crown wins!', 3);
      else if (ev.type === 'energyFull' && ev.side === 'player') window.SS.audio.energyFull();
      else if (ev.type === 'end') onMatchEnd(ev.result);
    }
    evs.length = 0;
  }

  function onMatchEnd(result) {
    screen = 'over';
    if (result === 'victory') window.SS.audio.victory();
    else if (result === 'defeat') window.SS.audio.defeat();
    var stats = {
      time: match.time,
      crowns: match.player.crowns,
      rivalCrowns: match.rival.crowns,
      deployed: match.player.deployed,
      damage: match.player.towerDamage,
    };
    window.SS.ui.showEnd(result, stats, restart, toTitle);
  }

  // ---- Autoplay: the same brain as the rival, playing the player's seat.
  // Used by the shot scenes and the play-test probes; a win by autoplay is
  // a win by fair play under the same rules and the same skill.
  function autoplayStep(dt) {
    if (!autoplay || !match || match.phase === 'over') return;
    window.SS.ai.think(match, dt, 'player', 1);
  }

  // Step the simulation without rendering (probes and shot scenes).
  function fastForward(seconds, withAutoplay) {
    if (!match) return;
    var steps = Math.floor(seconds / STEP);
    var saved = autoplay;
    autoplay = !!withAutoplay;
    for (var i = 0; i < steps; i++) {
      if (match.phase === 'over') break;
      autoplayStep(STEP);
      window.SS.sim.step(match, STEP);
    }
    autoplay = saved;
    drainEvents();
  }

  // ---- Main loop. ----
  function loop(t) {
    requestAnimationFrame(loop);
    var now = t / 1000;
    var dt = Math.min(0.1, lastT ? now - lastT : 0.016);
    lastT = now;
    simTime += dt;
    if (screen === 'playing' && !frozen && match) {
      acc += dt;
      var steps = 0;
      while (acc >= STEP && steps < 5) {
        autoplayStep(STEP);
        window.SS.sim.step(match, STEP);
        acc -= STEP;
        steps++;
      }
      if (steps === 5) acc = 0;
      drainEvents();
      window.SS.ui.updateHand(match, selected);
      window.SS.ui.updateTop(match);
    }
    window.SS.ui.tick(dt);
    window.SS.render.frame(match, dt, simTime);
    if (!shotReady) {
      shotReady = true;
      window.__shotReady = true;
    }
  }

  // ---- Shot scenes: deterministic, driven through the real game code. ----
  function runShotMode(shot, seedParam) {
    var seed = parseInt(seedParam, 10) || 7;
    if (shot === 'battle') {
      startGame(0, seed);
      var battleSeconds = parseInt(params().t, 10) || 30;
      fastForward(battleSeconds, true);
      autoplay = false;
    } else if (shot === 'deploy') {
      startGame(0, seed);
      fastForward(8, true);
      autoplay = false;
      frozen = true;
      // Select a mid-cost card through the real input path and park the ghost.
      window.SS.input.setSelected(1);
      var key = match.player.hand[1];
      var def = key ? CFG.CARDS[key] : null;
      var radius = def && def.kind === 'spell' ? def.radius : 1.0;
      window.SS.input.forceGhost(-3.5, 8.5, radius, true);
    } else if (shot === 'victory' || shot === 'defeat') {
      startGame(0, seed);
      var guard = 0;
      while (match.phase !== 'over' && guard < 420) {
        fastForward(1, shot === 'victory');
        guard++;
      }
      autoplay = false;
    }
    // 'title' (or anything else) leaves the title screen up.
    // Sync the HUD to the fast-forwarded state: the live loop never ran
    // during the fast-forward, so the timer and bars would show stale values.
    if (match) {
      window.SS.ui.updateHand(match, selected);
      window.SS.ui.updateTop(match);
    }
  }

  function boot() {
    var container = document.getElementById('game-container');
    window.SS.render.init(container);
    window.SS.ui.init({
      onCardClick: function (idx) { window.SS.input.select(idx); },
      onPauseKey: togglePause,
      onMuteKey: toggleMute,
    });
    window.SS.input.attach(container.querySelector('canvas'), {
      isPlaying: function () { return screen === 'playing' && !frozen; },
      isFrozen: function () { return frozen || screen !== 'playing'; },
      handCard: function (idx) { return match ? match.player.hand[idx] : null; },
      canDeploy: function (idx, x, z) {
        if (!match) return false;
        var key = match.player.hand[idx];
        if (!key) return false;
        var def = CFG.CARDS[key];
        if (match.player.energy < def.cost) return false;
        if (def.kind === 'spell') return Math.abs(x) <= 12.5 && Math.abs(z) <= 17.5;
        return window.SS.sim.deployZoneOk('player', x, z);
      },
      tryDeploy: function (idx, x, z) {
        if (!match) return false;
        return window.SS.sim.deploy(match, 'player', idx, x, z);
      },
      onDeployDenied: function (idx, x, z) {
        var key = match.player.hand[idx];
        var def = key ? CFG.CARDS[key] : null;
        if (def && match.player.energy < def.cost) {
          window.SS.ui.toast('Not enough starlight!');
        } else if (def && def.kind !== 'spell') {
          window.SS.ui.toast('Deploy on your half of the arena!');
        } else {
          window.SS.ui.toast('Cannot deploy there.');
        }
        window.SS.audio.error();
      },
      onSelect: function (idx) {
        selected = idx;
        if (match) window.SS.ui.updateHand(match, selected);
      },
      onEscape: togglePause,
      onPauseKey: togglePause,
      onRestartKey: function () { if (screen === 'playing' || screen === 'paused' || screen === 'over') restart(); },
      onMuteKey: toggleMute,
    });
    document.getElementById('game-container').addEventListener('pointerdown', function () {
      window.SS.audio.unlock();
    }, { once: false });
    toTitle();
    var p = params();
    if (p.shot) runShotMode(p.shot, p.seed);
    requestAnimationFrame(loop);
  }

  // Probe API for automated play-testing: read the match, drive real inputs,
  // and fast-forward the real simulation. Read-only state plus test drivers.
  window.__starfall = {
    state: function () {
      if (!match) return { screen: screen, match: null };
      return {
        screen: screen,
        time: match.time,
        phase: match.phase,
        result: match.result,
        energy: match.player.energy,
        rivalEnergy: match.rival.energy,
        hand: match.player.hand.slice(),
        queue: match.player.queue.slice(),
        crowns: match.player.crowns,
        rivalCrowns: match.rival.crowns,
        playerKeepHp: match.playerKeep.hp,
        rivalKeepHp: match.rivalKeep.hp,
        units: match.entities.filter(function (e) { return !e.isTower; }).length,
        selected: selected,
      };
    },
    start: function (deck, seed) { deckIndex = deck || 0; startGame(deckIndex, seed); },
    select: function (idx) { window.SS.input.select(idx); },
    deployAt: function (idx, x, z) {
      if (!match) return false;
      return window.SS.sim.deploy(match, 'player', idx, x, z);
    },
    fastForward: function (seconds, withAutoplay) { fastForward(seconds, withAutoplay); },
    setAutoplay: function (on) { autoplay = !!on; },
    setFrozen: function (on) { frozen = !!on; },
    screen: function () { return screen; },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
