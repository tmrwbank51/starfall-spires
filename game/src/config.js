// Starfall Spires — data layer: arena layout, card definitions, decks, tuning.
// Every number the simulation and the renderer share lives here, so balance
// can be tuned in one place. No code in this file touches the DOM or Three.js.
(function () {
  'use strict';

  var ARENA = {
    halfWidth: 13, // playable x in [-13, 13]
    halfLength: 18, // playable z in [-18, 18]; player (gold) at +z, rival (violet) at -z
    riftHalfWidth: 1.1, // glowing midline strip, visual only
    deployMargin: 1.0, // keep deployments inside the walls
    matchSeconds: 180, // regulation time
    overtimeSeconds: 60, // sudden death: next crown wins
    doubleTimeAt: 120, // starlight doubles from this elapsed second on
    energyMax: 10,
    energyStart: 5,
    energyPeriod: 2.5, // seconds per 1 starlight (halved in double time)
  };

  var TOWERS = {
    keep: { hp: 2600, damage: 95, range: 8.5, cooldown: 1.5, x: 0, z: 15.5, radius: 1.6 },
    spire: { hp: 1400, damage: 70, range: 7.5, cooldown: 1.3, x: 7.5, z: 11.0, radius: 1.1 },
  };

  // Card kinds. `count` units spawn in a small cluster; `building` cards are
  // immobile structures with a lifetime; `spell` cards resolve after a delay.
  // `targets` is 'any' (nearest enemy), 'buildings' (towers only) or 'ally'.
  var CARDS = {
    shardlings: {
      name: 'Shardlings', cost: 2, kind: 'unit', count: 3,
      hp: 170, damage: 48, range: 1.1, cooldown: 0.9, speed: 3.4, radius: 0.42,
      sight: 8.5, targets: 'any', splash: 0,
      blurb: 'Three quick sprites that swarm the foe.',
      tint: 0x7dd3fc,
    },
    sparkarcher: {
      name: 'Spark Archer', cost: 3, kind: 'unit', count: 1,
      hp: 240, damage: 72, range: 6.0, cooldown: 1.1, speed: 3.0, radius: 0.45,
      sight: 9.0, targets: 'any', splash: 0,
      blurb: 'Patient sniper. Long reach, fragile body.',
      tint: 0xfde68a,
    },
    galerunner: {
      name: 'Gale Runner', cost: 3, kind: 'unit', count: 1,
      hp: 380, damage: 135, range: 1.2, cooldown: 1.0, speed: 5.4, radius: 0.45,
      sight: 99, targets: 'buildings', splash: 0,
      blurb: 'Sprints past troops to hammer towers.',
      tint: 0x86efac,
    },
    bulwark: {
      name: 'Bulwark Golem', cost: 5, kind: 'unit', count: 1,
      hp: 1700, damage: 115, range: 1.4, cooldown: 1.3, speed: 1.9, radius: 0.8,
      sight: 8.0, targets: 'any', splash: 0,
      blurb: 'A walking wall. Slow, stubborn, hard to move.',
      tint: 0xf59e0b,
    },
    emberlobber: {
      name: 'Ember Lobber', cost: 4, kind: 'unit', count: 1,
      hp: 340, damage: 95, range: 5.5, cooldown: 1.6, speed: 2.6, radius: 0.5,
      sight: 9.0, targets: 'any', splash: 2.0,
      blurb: 'Lobs burning crystal that bursts.',
      tint: 0xfb923c,
    },
    skymender: {
      name: 'Sky Mender', cost: 3, kind: 'unit', count: 1,
      hp: 280, damage: 0, range: 5.0, cooldown: 0.9, speed: 3.1, radius: 0.45,
      sight: 9.0, targets: 'ally', heal: 65, splash: 0,
      blurb: 'Drifts behind your troops, mending the wounded.',
      tint: 0x6ee7b7,
    },
    frostobelisk: {
      name: 'Frost Obelisk', cost: 4, kind: 'building', count: 1,
      hp: 950, damage: 58, range: 7.5, cooldown: 0.9, speed: 0, radius: 0.9,
      sight: 7.5, targets: 'any', splash: 0, lifetime: 35, slow: 0.4, slowTime: 1.5,
      blurb: 'A frozen spire that chills attackers.',
      tint: 0x93c5fd,
    },
    runebastion: {
      name: 'Rune Bastion', cost: 3, kind: 'building', count: 1,
      hp: 1700, damage: 0, range: 0, cooldown: 1, speed: 0, radius: 1.0,
      sight: 0, targets: 'none', splash: 0, lifetime: 40,
      blurb: 'A rune-carved block. Refuses to fall.',
      tint: 0xd6d3d1,
    },
    stormcolossus: {
      name: 'Storm Colossus', cost: 7, kind: 'unit', count: 1,
      hp: 2700, damage: 230, range: 1.6, cooldown: 1.6, speed: 1.6, radius: 1.05,
      sight: 8.0, targets: 'any', splash: 1.7,
      blurb: 'A walking mountain. Clears crowds.',
      tint: 0xc4b5fd,
    },
    meteorcall: {
      name: 'Meteor Call', cost: 4, kind: 'spell', count: 1,
      damage: 430, radius: 3.5, delay: 0.8, splash: 3.5,
      blurb: 'A star falls. Heavy circle damage.',
      tint: 0xf87171,
    },
  };

  // Three decks of eight cards. Each rewards a different style; all three are
  // complete and playable, and the choice is the player's first decision.
  var DECKS = [
    {
      name: 'Dawn Vanguard',
      style: 'Balanced march: a tool for every moment.',
      cards: ['shardlings', 'sparkarcher', 'galerunner', 'bulwark', 'emberlobber', 'skymender', 'frostobelisk', 'meteorcall'],
    },
    {
      name: 'Ember Siege',
      style: 'Slow, heavy, unstoppable. Bring down the walls.',
      cards: ['bulwark', 'stormcolossus', 'emberlobber', 'sparkarcher', 'runebastion', 'frostobelisk', 'meteorcall', 'galerunner'],
    },
    {
      name: 'Wisp Swarm',
      style: 'Fast and cheap. Win by never letting up.',
      cards: ['shardlings', 'galerunner', 'sparkarcher', 'skymender', 'emberlobber', 'runebastion', 'bulwark', 'meteorcall'],
    },
  ];

  var SIDES = {
    player: { name: 'Aurum Ward', color: 0xf5b942, css: '#f5b942', dark: 0x8a5a12, dir: -1 },
    rival: { name: 'Umbral Court', color: 0xa855f7, css: '#c084fc', dark: 0x5b21b6, dir: 1 },
  };

  window.SS = window.SS || {};
  window.SS.config = { ARENA: ARENA, TOWERS: TOWERS, CARDS: CARDS, DECKS: DECKS, SIDES: SIDES };
})();
