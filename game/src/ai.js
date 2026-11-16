// Starfall Spires — rival brain. One brain, two seats: it plays the Umbral
// Court in real matches, and the same logic drives the scripted autoplay the
// play-tests use, so a win by autoplay is a win by fair play. Both sides use
// the same hand, the same starlight and the same deploy zone. It defends when
// pressed, builds pushes when rich, and grows bolder as the match runs on.
// Deliberately imperfect: it sometimes spends on the wrong card, so a
// thinking player can outplay it.
(function () {
  'use strict';

  var CFG = window.SS.config;
  var CARDS = CFG.CARDS;

  // side: 'rival' (the AI) or 'player' (autoplay). dir maps "own-half depth"
  // to z: rival deploys at negative z, the player at positive z.
  function think(match, dt, side, skill) {
    side = side || 'rival';
    skill = skill || 1; // 1 = full strength; lower = slower and more hesitant
    var timerKey = 'thinkIn_' + side;
    if (match[timerKey] === undefined) match[timerKey] = 1.2;
    match[timerKey] -= dt;
    if (match[timerKey] > 0) return;
    var elapsed = match.time;
    var interval = Math.max(0.35, 0.65 - elapsed * 0.0016) / skill;
    match[timerKey] = interval;
    if (match.phase === 'over') return;

    var dir = side === 'player' ? 1 : -1;
    var enemy = side === 'player' ? 'rival' : 'player';
    var rng = match.rng;
    var st = side === 'player' ? match.player : match.rival;
    var aggression = Math.min(1, 0.25 + elapsed / 200) * skill;
    if (match.phase === 'overtime') aggression = 1;

    function ownHalf(z) { return z * dir > 0; }
    function depthZ(depth) { return dir * depth; }

    // Survey the field.
    var threats = []; // enemy units on our half
    var clump = null;
    var clumpCount = 0;
    for (var i = 0; i < match.entities.length; i++) {
      var e = match.entities[i];
      if (e.dead || e.side !== enemy || e.isTower) continue;
      if (ownHalf(e.z)) threats.push(e);
    }
    // Densest clump of enemy units, for the meteor.
    for (var a = 0; a < match.entities.length; a++) {
      var u = match.entities[a];
      if (u.dead || u.side !== enemy || u.isTower) continue;
      var n = 0;
      for (var b = 0; b < match.entities.length; b++) {
        var v = match.entities[b];
        if (v.dead || v.side !== enemy || v.isTower) continue;
        var dx = v.x - u.x;
        var dz = v.z - u.z;
        if (dx * dx + dz * dz <= 12.25) n++;
      }
      if (n > clumpCount) { clumpCount = n; clump = u; }
    }

    function handIndexOf(pred) {
      for (var k = 0; k < st.hand.length; k++) {
        var key = st.hand[k];
        if (key && pred(key, CARDS[key])) return k;
      }
      return -1;
    }
    function tryDeploy(handIdx, x, z) {
      if (handIdx < 0) return false;
      return window.SS.sim.deploy(match, side, handIdx, x, z);
    }
    function randX() { return (rng() * 2 - 1) * 9; }

    // 1. Meteor on a real clump.
    var meteorIdx = handIndexOf(function (k) { return k === 'meteorcall'; });
    if (meteorIdx >= 0 && clump && clumpCount >= 3 && st.energy >= CARDS.meteorcall.cost) {
      if (tryDeploy(meteorIdx, clump.x, clump.z)) return;
    }

    // 2. Defense: something dangerous is on our half.
    var threatValue = 0;
    var nearestThreat = null;
    var nearestD = Infinity;
    for (var t = 0; t < threats.length; t++) {
      threatValue += threats[t].maxHp + threats[t].damage * 4;
      var d = Math.abs(threats[t].z - depthZ(12));
      if (d < nearestD) { nearestD = d; nearestThreat = threats[t]; }
    }
    if (nearestThreat && threatValue > 500) {
      var gx = nearestThreat.x + (rng() * 2 - 1) * 1.5;
      var gz = nearestThreat.z + dir * (2.5 + rng() * 2);
      gz = dir * Math.max(2, Math.min(16, gz * dir));
      var cheap = handIndexOf(function (k, c) { return c.kind === 'unit' && c.cost <= 3 && k !== 'galerunner'; });
      if (cheap >= 0 && st.energy >= CARDS[st.hand[cheap]].cost) {
        if (tryDeploy(cheap, gx, gz)) return;
      }
      var building = handIndexOf(function (k, c) { return c.kind === 'building'; });
      if (building >= 0 && threatValue > 1400 && st.energy >= CARDS[st.hand[building]].cost) {
        if (tryDeploy(building, gx * 0.7, depthZ(8.5 + rng() * 2))) return;
      }
      var splash = handIndexOf(function (k, c) { return c.splash > 0 && c.kind === 'unit'; });
      if (splash >= 0 && st.energy >= CARDS[st.hand[splash]].cost) {
        if (tryDeploy(splash, gx, dir * Math.max(2, Math.min(16, (gz + dir * 1.5) * dir)))) return;
      }
    }

    // 3. Offense: build a push when rich, or press when bold.
    var wantPush = st.energy >= 8 || (st.energy >= 6 && rng() < aggression * 0.55) ||
      (match.phase === 'overtime' && st.energy >= 4);
    if (wantPush) {
      var lane = rng() < 0.5 ? -6 : 6;
      var tank = handIndexOf(function (k, c) { return c.kind === 'unit' && c.hp >= 1400; });
      if (tank >= 0 && st.energy >= CARDS[st.hand[tank]].cost) {
        var tankPlayed = tryDeploy(tank, lane + (rng() * 2 - 1) * 2, depthZ(14 - rng() * 2));
        // A lone tank dies to tower fire: send support with it when possible.
        var follow = handIndexOf(function (k, c) { return c.kind === 'unit' && c.cost >= 3 && c.cost <= 4 && k !== 'galerunner'; });
        if (tankPlayed && follow >= 0 && st.energy >= CARDS[st.hand[follow]].cost) {
          tryDeploy(follow, lane + (rng() * 2 - 1) * 3, depthZ(11 - rng() * 3));
        }
        if (tankPlayed) return;
      }
      var support = handIndexOf(function (k, c) {
        return c.kind === 'unit' && c.cost >= 3 && c.cost <= 4 && k !== 'galerunner';
      });
      if (support >= 0 && st.energy >= CARDS[st.hand[support]].cost) {
        if (tryDeploy(support, lane + (rng() * 2 - 1) * 3, depthZ(11 - rng() * 3))) return;
      }
      // A lone runner sneaking down the far lane.
      var runner = handIndexOf(function (k) { return k === 'galerunner'; });
      if (runner >= 0 && st.energy >= CARDS[st.hand[runner]].cost && rng() < 0.5) {
        if (tryDeploy(runner, -lane, depthZ(6 + rng() * 4))) return;
      }
      var anyCheap = handIndexOf(function (k, c) { return c.kind === 'unit' && c.cost <= 3; });
      if (anyCheap >= 0 && st.energy >= CARDS[st.hand[anyCheap]].cost) {
        if (tryDeploy(anyCheap, randX(), depthZ(9 + rng() * 4))) return;
      }
    }

    // 4. Idle leak: never sit at full starlight for long.
    if (st.energy >= 9.5) {
      var spare = handIndexOf(function (k, c) { return c.kind !== 'spell' && c.cost <= 4; });
      if (spare >= 0) tryDeploy(spare, randX(), depthZ(10 + rng() * 4));
    }
  }

  window.SS = window.SS || {};
  window.SS.ai = { think: think };
})();
