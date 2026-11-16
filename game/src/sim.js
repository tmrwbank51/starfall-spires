// Starfall Spires — simulation. Pure game logic: no DOM, no Three.js, no
// wall clock. The renderer and the sound layer only read state and drain the
// event queue, so the match can be fast-forwarded and replayed deterministically
// from its seed.
(function () {
  'use strict';

  var CFG = window.SS.config;
  var ARENA = CFG.ARENA;
  var CARDS = CFG.CARDS;
  var DECKS = CFG.DECKS;

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  var CLUSTER = [
    [0, 0], [-0.95, 0.55], [0.95, 0.55], [-0.55, -0.9], [0.55, -0.9],
  ];

  function makeSide(deckCards, rng) {
    var order = shuffle(deckCards.slice(), rng);
    return {
      energy: ARENA.energyStart,
      energyAcc: 0,
      hand: order.slice(0, 4),
      queue: order.slice(4),
      crowns: 0,
      deployed: 0,
      damageDealt: 0,
      towerDamage: 0,
    };
  }

  function makeTower(match, side, kind, x, z) {
    var def = CFG.TOWERS[kind];
    var e = {
      id: match.nextId++, side: side, kind: kind, card: kind,
      x: x, z: z, hp: def.hp, maxHp: def.hp, radius: def.radius,
      speed: 0, damage: def.damage, range: def.range, cooldown: def.cooldown,
      cdLeft: 0, sight: def.range, targets: 'any', splash: 0,
      isTower: true, isBuilding: false, dead: false,
      slowUntil: 0, retargetIn: 0, targetId: 0, attackFlash: 0, spawnT: 0,
    };
    match.entities.push(e);
    return e;
  }

  function createMatch(deckIndex, seed) {
    var rng = mulberry32(seed || 1);
    var match = {
      seed: seed || 1,
      rng: rng,
      time: 0,
      phase: 'playing', // 'playing' | 'overtime' | 'over'
      result: null, // 'victory' | 'defeat' | 'draw'
      winner: null,
      nextId: 1,
      entities: [],
      projectiles: [],
      spells: [],
      events: [],
      player: makeSide(DECKS[deckIndex].cards, rng),
      // Mirror match: the rival plays the same deck, so the game is decided
      // by play, not by one deck being heavier than the other.
      rival: makeSide(DECKS[deckIndex].cards, rng),
      deckIndex: deckIndex,
      aiThinkIn: 1.2,
      doubleAnnounced: false,
      overtimeAnnounced: false,
    };
    var sp = CFG.TOWERS.spire;
    var kp = CFG.TOWERS.keep;
    match.playerKeep = makeTower(match, 'player', 'keep', kp.x, kp.z);
    match.rivalKeep = makeTower(match, 'rival', 'keep', kp.x, -kp.z);
    match.playerSpires = [
      makeTower(match, 'player', 'spire', -sp.x, sp.z),
      makeTower(match, 'player', 'spire', sp.x, sp.z),
    ];
    match.rivalSpires = [
      makeTower(match, 'rival', 'spire', -sp.x, -sp.z),
      makeTower(match, 'rival', 'spire', sp.x, -sp.z),
    ];
    return match;
  }

  function deployZoneOk(side, x, z) {
    var m = ARENA.deployMargin;
    if (x < -ARENA.halfWidth + m || x > ARENA.halfWidth - m) return false;
    if (side === 'player') return z > ARENA.riftHalfWidth + 0.4 && z < ARENA.halfLength - m;
    return z < -ARENA.riftHalfWidth - 0.4 && z > -ARENA.halfLength + m;
  }

  function sideState(match, side) { return side === 'player' ? match.player : match.rival; }

  function deploy(match, side, handIndex, x, z) {
    if (match.phase === 'over') return false;
    var st = sideState(match, side);
    var key = st.hand[handIndex];
    if (!key) return false;
    var def = CARDS[key];
    if (st.energy < def.cost) return false;
    if (def.kind === 'spell') {
      if (Math.abs(x) > ARENA.halfWidth - 0.5 || Math.abs(z) > ARENA.halfLength - 0.5) return false;
    } else if (!deployZoneOk(side, x, z)) {
      return false;
    }
    st.energy -= def.cost;
    st.hand[handIndex] = st.queue.shift();
    st.queue.push(key);
    st.deployed++;
    if (def.kind === 'spell') {
      match.spells.push({ side: side, key: key, x: x, z: z, left: def.delay, radius: def.radius, damage: def.damage });
      match.events.push({ type: 'spell', side: side, key: key, x: x, z: z });
      return true;
    }
    var n = def.count || 1;
    for (var i = 0; i < n; i++) {
      var off = CLUSTER[i % CLUSTER.length];
      var e = {
        id: match.nextId++, side: side, kind: def.kind, card: key,
        x: x + off[0], z: z + off[1],
        hp: def.hp, maxHp: def.hp, radius: def.radius,
        speed: def.speed, damage: def.damage, range: def.range,
        cooldown: def.cooldown, cdLeft: 0.3, sight: def.sight,
        targets: def.targets, splash: def.splash || 0,
        slow: def.slow || 0, slowTime: def.slowTime || 0,
        heal: def.heal || 0, lifetime: def.lifetime || 0, lifeLeft: def.lifetime || 0,
        isTower: false, isBuilding: def.kind === 'building', dead: false,
        slowUntil: 0, retargetIn: Math.random() * 0.2, targetId: 0,
        attackFlash: 0, spawnT: 0,
      };
      match.entities.push(e);
    }
    match.events.push({ type: 'deploy', side: side, key: key, x: x, z: z });
    return true;
  }

  function findEntity(match, id) {
    for (var i = 0; i < match.entities.length; i++) {
      if (match.entities[i].id === id) return match.entities[i];
    }
    return null;
  }

  function dist(a, b) {
    var dx = a.x - b.x;
    var dz = a.z - b.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  function isEnemyOf(e, side) { return e.side !== side && !e.dead; }

  function acquireTarget(match, e) {
    var best = null;
    var bestD = Infinity;
    var enemySide = e.side === 'player' ? 'rival' : 'player';
    if (e.targets === 'ally') {
      // Mender: most wounded ally in sight.
      for (var i = 0; i < match.entities.length; i++) {
        var a = match.entities[i];
        if (a.side !== e.side || a.dead || a.isTower || a === e) continue;
        if (a.hp >= a.maxHp) continue;
        var d = dist(e, a);
        if (d <= e.sight && a.hp / a.maxHp < (best ? best.hp / best.maxHp : 2)) {
          if (d <= e.sight) { best = a; bestD = d; }
        }
      }
      return best;
    }
    for (var k = 0; k < match.entities.length; k++) {
      var t = match.entities[k];
      if (!isEnemyOf(t, e.side)) continue;
      if (e.targets === 'buildings' && !t.isTower && !t.isBuilding) continue;
      if (e.isTower && (t.isTower || t.isBuilding)) continue; // towers shoot troops only
      var dd = dist(e, t);
      if (e.isTower) {
        if (dd <= e.range && dd < bestD) { best = t; bestD = dd; }
      } else if (dd <= e.sight && dd < bestD) {
        best = t; bestD = dd;
      }
    }
    if (best) return best;
    // March on the nearest enemy tower.
    var towers = enemySide === 'player'
      ? [match.playerKeep].concat(match.playerSpires)
      : [match.rivalKeep].concat(match.rivalSpires);
    for (var m = 0; m < towers.length; m++) {
      var tw = towers[m];
      if (tw.dead) continue;
      var dt = dist(e, tw);
      if (dt < bestD) { best = tw; bestD = dt; }
    }
    return best;
  }

  function applyDamage(match, target, amount, sourceSide, isSpell) {
    if (!target || target.dead) return;
    target.hp -= amount;
    var st = sideState(match, sourceSide);
    st.damageDealt += amount;
    if (target.isTower) st.towerDamage += amount;
    match.events.push({ type: 'hit', x: target.x, z: target.z, side: target.side, big: isSpell });
    if (target.hp <= 0) killEntity(match, target, sourceSide);
  }

  function killEntity(match, e, sourceSide) {
    e.dead = true;
    e.hp = 0;
    match.events.push({ type: 'die', x: e.x, z: e.z, side: e.side, kind: e.kind, card: e.card, radius: e.radius });
    if (e.isTower) {
      var st = sideState(match, sourceSide);
      if (e.kind === 'spire') {
        st.crowns++;
        match.events.push({ type: 'crown', side: sourceSide, x: e.x, z: e.z });
        if (match.phase === 'overtime') endMatch(match, sourceSide === 'player' ? 'victory' : 'defeat');
      } else {
        endMatch(match, sourceSide === 'player' ? 'victory' : 'defeat');
      }
      match.events.push({ type: 'towerDown', side: e.side, kind: e.kind, x: e.x, z: e.z });
    }
  }

  function endMatch(match, result) {
    if (match.phase === 'over') return;
    match.phase = 'over';
    match.result = result;
    match.winner = result === 'victory' ? 'player' : result === 'defeat' ? 'rival' : null;
    match.events.push({ type: 'end', result: result });
  }

  function decideOnTime(match) {
    var p = match.player.crowns;
    var r = match.rival.crowns;
    if (p !== r) { endMatch(match, p > r ? 'victory' : 'defeat'); return; }
    var pf = match.playerKeep.hp / match.playerKeep.maxHp;
    var rf = match.rivalKeep.hp / match.rivalKeep.maxHp;
    if (Math.abs(pf - rf) > 0.001) { endMatch(match, pf > rf ? 'victory' : 'defeat'); return; }
    endMatch(match, 'draw');
  }

  function stepProjectiles(match, dt) {
    for (var i = match.projectiles.length - 1; i >= 0; i--) {
      var p = match.projectiles[i];
      var target = p.targetId ? findEntity(match, p.targetId) : null;
      var tx = target && !target.dead ? target.x : p.tx;
      var tz = target && !target.dead ? target.z : p.tz;
      var dx = tx - p.x;
      var dz = tz - p.z;
      var d = Math.sqrt(dx * dx + dz * dz);
      var stepLen = p.speed * dt;
      if (d <= stepLen + 0.15) {
        // Impact.
        if (p.splash > 0) {
          for (var k = 0; k < match.entities.length; k++) {
            var e = match.entities[k];
            if (e.dead || e.side === p.side) continue;
            var ex = e.x - tx;
            var ez = e.z - tz;
            if (Math.sqrt(ex * ex + ez * ez) <= p.splash + e.radius) {
              applyDamage(match, e, p.damage, p.side, false);
              if (p.slow) { e.slowUntil = match.time + p.slowTime; }
            }
          }
          match.events.push({ type: 'splash', x: tx, z: tz, radius: p.splash, side: p.side });
        } else if (target && !target.dead) {
          applyDamage(match, target, p.damage, p.side, false);
          if (p.slow) { target.slowUntil = match.time + p.slowTime; }
        }
        match.projectiles.splice(i, 1);
      } else {
        p.x += (dx / d) * stepLen;
        p.z += (dz / d) * stepLen;
      }
    }
  }

  function stepSpells(match, dt) {
    for (var i = match.spells.length - 1; i >= 0; i--) {
      var s = match.spells[i];
      s.left -= dt;
      if (s.left > 0) continue;
      match.spells.splice(i, 1);
      for (var k = 0; k < match.entities.length; k++) {
        var e = match.entities[k];
        if (e.dead || e.side === s.side) continue;
        var dx = e.x - s.x;
        var dz = e.z - s.z;
        if (Math.sqrt(dx * dx + dz * dz) <= s.radius + e.radius) {
          applyDamage(match, e, s.damage, s.side, true);
        }
      }
      match.events.push({ type: 'spellHit', x: s.x, z: s.z, radius: s.radius, side: s.side });
    }
  }

  function stepEntity(match, e, dt) {
    if (e.dead) return;
    e.spawnT += dt;
    e.attackFlash = Math.max(0, e.attackFlash - dt);
    if (e.cdLeft > 0) e.cdLeft -= dt;
    if (e.isBuilding && e.lifetime > 0) {
      e.lifeLeft -= dt;
      if (e.lifeLeft <= 0) {
        e.dead = true;
        match.events.push({ type: 'die', x: e.x, z: e.z, side: e.side, kind: e.kind, card: e.card, radius: e.radius, quiet: true });
        return;
      }
    }
    e.retargetIn -= dt;
    var target = e.targetId ? findEntity(match, e.targetId) : null;
    if (!target || target.dead || e.retargetIn <= 0) {
      target = acquireTarget(match, e);
      e.targetId = target ? target.id : 0;
      e.retargetIn = 0.4;
    }
    if (!target) return;
    var slowed = match.time < e.slowUntil;
    var d = dist(e, target);
    var reach = e.range + target.radius;
    if (e.targets === 'ally') {
      if (d > e.range) {
        moveToward(e, target, dt, slowed);
      } else if (e.cdLeft <= 0 && target.hp < target.maxHp) {
        target.hp = Math.min(target.maxHp, target.hp + e.heal);
        e.cdLeft = e.cooldown;
        e.attackFlash = 0.25;
        match.events.push({ type: 'heal', x: target.x, z: target.z, side: target.side });
      }
      return;
    }
    if (d > reach) {
      if (!e.isTower && !e.isBuilding) moveToward(e, target, dt, slowed);
      return;
    }
    // In range: attack.
    if (e.cdLeft > 0) return;
    e.cdLeft = e.cooldown;
    e.attackFlash = 0.22;
    var ranged = e.range > 1.6;
    if (ranged) {
      match.projectiles.push({
        side: e.side, x: e.x, z: e.z, tx: target.x, tz: target.z,
        targetId: target.id, speed: 17, damage: e.damage,
        splash: e.splash || 0, slow: e.slow || 0, slowTime: e.slowTime || 0,
        kind: e.card,
      });
      match.events.push({ type: 'shoot', x: e.x, z: e.z, side: e.side, kind: e.card });
    } else {
      if (e.splash > 0) {
        for (var k = 0; k < match.entities.length; k++) {
          var other = match.entities[k];
          if (other.dead || other.side === e.side) continue;
          var ox = other.x - target.x;
          var oz = other.z - target.z;
          if (Math.sqrt(ox * ox + oz * oz) <= e.splash + other.radius) {
            applyDamage(match, other, e.damage, e.side, false);
          }
        }
        match.events.push({ type: 'splash', x: target.x, z: target.z, radius: e.splash, side: e.side });
      } else {
        applyDamage(match, target, e.damage, e.side, false);
      }
      match.events.push({ type: 'swing', x: e.x, z: e.z, side: e.side, kind: e.card });
    }
  }

  function moveToward(e, target, dt, slowed) {
    var dx = target.x - e.x;
    var dz = target.z - e.z;
    var d = Math.sqrt(dx * dx + dz * dz);
    if (d < 0.001) return;
    var sp = e.speed * (slowed ? 0.6 : 1);
    var stepLen = Math.min(d, sp * dt);
    e.x += (dx / d) * stepLen;
    e.z += (dz / d) * stepLen;
    e.heading = Math.atan2(dx, dz);
  }

  function separate(match) {
    var list = match.entities;
    for (var pass = 0; pass < 2; pass++) {
      for (var i = 0; i < list.length; i++) {
        var a = list[i];
        if (a.dead || a.isTower || a.isBuilding) continue;
        for (var j = i + 1; j < list.length; j++) {
          var b = list[j];
          if (b.dead || b.isTower || b.isBuilding) continue;
          var dx = b.x - a.x;
          var dz = b.z - a.z;
          var min = a.radius + b.radius + 0.12;
          var d2 = dx * dx + dz * dz;
          if (d2 >= min * min || d2 < 1e-6) continue;
          var d = Math.sqrt(d2);
          var push = (min - d) / 2;
          var nx = dx / d;
          var nz = dz / d;
          a.x -= nx * push;
          a.z -= nz * push;
          b.x += nx * push;
          b.z += nz * push;
        }
      }
    }
    // Clamp inside the arena.
    for (var k = 0; k < list.length; k++) {
      var e = list[k];
      e.x = Math.max(-ARENA.halfWidth + 0.4, Math.min(ARENA.halfWidth - 0.4, e.x));
      e.z = Math.max(-ARENA.halfLength + 0.4, Math.min(ARENA.halfLength - 0.4, e.z));
    }
  }

  function regen(match, st, side, dt, doubleRate) {
    var period = ARENA.energyPeriod / (doubleRate ? 2 : 1);
    st.energyAcc += dt;
    while (st.energyAcc >= period) {
      st.energyAcc -= period;
      if (st.energy < ARENA.energyMax) {
        st.energy++;
        if (st.energy === ARENA.energyMax) match.events.push({ type: 'energyFull', side: side });
      }
    }
  }

  function step(match, dt) {
    if (match.phase === 'over') return;
    match.time += dt;
    var doubleRate = match.time >= ARENA.doubleTimeAt || match.phase === 'overtime';
    if (doubleRate && !match.doubleAnnounced) {
      match.doubleAnnounced = true;
      match.events.push({ type: 'double' });
    }
    regen(match, match.player, 'player', dt, doubleRate);
    regen(match, match.rival, 'rival', dt, doubleRate);
    // Clock.
    if (match.phase === 'playing' && match.time >= ARENA.matchSeconds) {
      if (match.player.crowns !== match.rival.crowns) {
        decideOnTime(match);
      } else {
        match.phase = 'overtime';
        match.events.push({ type: 'overtime' });
      }
    } else if (match.phase === 'overtime' && match.time >= ARENA.matchSeconds + ARENA.overtimeSeconds) {
      decideOnTime(match);
    }
    if (match.phase === 'over') return;
    if (window.SS && window.SS.ai) window.SS.ai.think(match, dt, 'rival', 0.9);
    stepSpells(match, dt);
    for (var i = 0; i < match.entities.length; i++) stepEntity(match, match.entities[i], dt);
    stepProjectiles(match, dt);
    separate(match);
    // Sweep the dead.
    for (var j = match.entities.length - 1; j >= 0; j--) {
      if (match.entities[j].dead && !match.entities[j].isTower) match.entities.splice(j, 1);
    }
    if (match.phase === 'over') return;
  }

  window.SS = window.SS || {};
  window.SS.sim = {
    createMatch: createMatch,
    step: step,
    deploy: deploy,
    deployZoneOk: deployZoneOk,
    findEntity: findEntity,
    sideState: sideState,
  };
})();
