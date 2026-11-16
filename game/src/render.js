// Starfall Spires — renderer. Three.js scene built from primitives only:
// boxes, spheres, cylinders, cones, octahedrons. No external models, no
// textures files (the ground texture is drawn on a canvas in code). The
// simulation owns the truth; this layer only mirrors it into meshes.
(function () {
  'use strict';

  var CFG = window.SS.config;
  var SIDES = CFG.SIDES;
  var ARENA = CFG.ARENA;

  var renderer = null;
  var scene = null;
  var camera = null;
  var cameraBase = null;
  var meshes = new Map(); // entity id -> record
  var dying = []; // {rec, t}
  var rings = []; // {mesh, t, dur, maxR}
  var ghost = null;
  var ghostRing = null;
  var shakeT = 0;
  var shakeMag = 0;
  var elapsed = 0;
  var floaters = []; // ambient floating crystals
  var projectilePool = [];
  var spellMarkers = new Map(); // spell object -> mesh

  var pulseRings = []; // tower foot rings, breathing in frame()
  var MOTE_MAX = 130;
  var moteGeo = null;
  var motePos = null;
  var moteSpeed = null;

  // Particle pool: one THREE.Points, CPU-updated.
  var PMAX = 900;
  var pGeo = null;
  var pPos = null;
  var pCol = null;
  var parts = [];
  var pNext = 0;

  var geoCache = {};
  var matCache = {};

  function geo(key, make) {
    if (!geoCache[key]) geoCache[key] = make();
    return geoCache[key];
  }
  function lambert(color, emissive, eIntensity) {
    var key = 'l' + color + '_' + (emissive || 0) + '_' + (eIntensity || 0);
    if (!matCache[key]) {
      matCache[key] = new THREE.MeshLambertMaterial({
        color: color, emissive: emissive || 0x000000,
        emissiveIntensity: eIntensity || 1,
      });
    }
    return matCache[key];
  }
  function basic(color, transparent, opacity) {
    var key = 'b' + color + '_' + transparent + '_' + opacity;
    if (!matCache[key]) {
      matCache[key] = new THREE.MeshBasicMaterial({
        color: color, transparent: !!transparent, opacity: opacity === undefined ? 1 : opacity,
      });
    }
    return matCache[key];
  }

  function groundTexture() {
    var c = document.createElement('canvas');
    c.width = 512;
    c.height = 512;
    var g = c.getContext('2d');
    g.fillStyle = '#333754';
    g.fillRect(0, 0, 512, 512);
    // Tiles.
    for (var y = 0; y < 8; y++) {
      for (var x = 0; x < 8; x++) {
        if ((x + y) % 2 === 0) {
          g.fillStyle = '#3b4066';
          g.fillRect(x * 64, y * 64, 64, 64);
        }
      }
    }
    // Half tints: violet far (top of canvas = -z), gold near.
    var grad = g.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, 'rgba(124, 58, 237, 0.20)');
    grad.addColorStop(0.46, 'rgba(124, 58, 237, 0.03)');
    grad.addColorStop(0.54, 'rgba(245, 185, 66, 0.03)');
    grad.addColorStop(1, 'rgba(245, 185, 66, 0.20)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 512, 512);
    // Grid lines.
    g.strokeStyle = 'rgba(255,255,255,0.10)';
    g.lineWidth = 2;
    for (var i = 0; i <= 8; i++) {
      g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, 512); g.stroke();
      g.beginPath(); g.moveTo(0, i * 64); g.lineTo(512, i * 64); g.stroke();
    }
    // Rift line.
    g.fillStyle = 'rgba(125, 211, 252, 0.85)';
    g.fillRect(0, 250, 512, 12);
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.fillRect(0, 254, 512, 4);
    var tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 1;
    return tex;
  }

  function init(container) {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(1);
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x16102e);
    scene.fog = new THREE.Fog(0x16102e, 60, 120);
    camera = new THREE.PerspectiveCamera(46, container.clientWidth / container.clientHeight, 0.1, 220);
    // Framing: the whole arena, both keeps included, must sit above the
    // card bar at 1280x720 — the camera sits a little higher and farther
    // back than a centered shot, and looks a touch past the middle toward
    // the player's keep, so the keep's crystal and health bar clear the HUD.
    cameraBase = new THREE.Vector3(0, 50, 31);
    camera.position.copy(cameraBase);
    camera.lookAt(0, 0, 3.0);

    var hemi = new THREE.HemisphereLight(0xcfd8ff, 0x2a1f3d, 0.9);
    scene.add(hemi);
    var dir = new THREE.DirectionalLight(0xffe7b0, 1.0);
    dir.position.set(14, 30, 10);
    scene.add(dir);
    var rim = new THREE.DirectionalLight(0x8b5cf6, 0.4);
    rim.position.set(-12, 18, -20);
    scene.add(rim);

    // Ground slab.
    var ground = new THREE.Mesh(
      new THREE.BoxGeometry(ARENA.halfWidth * 2 + 2, 1.2, ARENA.halfLength * 2 + 2),
      new THREE.MeshLambertMaterial({ map: groundTexture() })
    );
    ground.position.y = -0.6;
    scene.add(ground);
    // Under-glow slab edge.
    var under = new THREE.Mesh(
      new THREE.BoxGeometry(ARENA.halfWidth * 2 + 2.4, 0.25, ARENA.halfLength * 2 + 2.4),
      basic(0x38bdf8, true, 0.35)
    );
    under.position.y = -1.25;
    scene.add(under);
    // Low walls.
    var wallMat = lambert(0x4c5178, 0x1c1f3a, 0.6);
    var wallGeoX = geo('wallX', function () { return new THREE.BoxGeometry(ARENA.halfWidth * 2 + 2, 1.0, 0.7); });
    var wallGeoZ = geo('wallZ', function () { return new THREE.BoxGeometry(0.7, 1.0, ARENA.halfLength * 2 + 2); });
    var walls = [
      [0, 0.5, -ARENA.halfLength - 0.65, wallGeoX], [0, 0.5, ARENA.halfLength + 0.65, wallGeoX],
      [-ARENA.halfWidth - 0.65, 0.5, 0, wallGeoZ], [ARENA.halfWidth + 0.65, 0.5, 0, wallGeoZ],
    ];
    for (var w = 0; w < walls.length; w++) {
      var wall = new THREE.Mesh(walls[w][3], wallMat);
      wall.position.set(walls[w][0], walls[w][1], walls[w][2]);
      scene.add(wall);
    }
    // Corner pillars with glowing caps.
    var pillarGeo = geo('pillar', function () { return new THREE.CylinderGeometry(0.7, 0.9, 6, 6); });
    var capGeo = geo('cap', function () { return new THREE.OctahedronGeometry(0.8); });
    var corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    for (var c = 0; c < corners.length; c++) {
      var pillar = new THREE.Mesh(pillarGeo, wallMat);
      pillar.position.set(corners[c][0] * (ARENA.halfWidth + 2.8), 3, corners[c][1] * (ARENA.halfLength + 2.8));
      scene.add(pillar);
      var cap = new THREE.Mesh(capGeo, basic(corners[c][1] < 0 ? 0xa855f7 : 0xf5b942));
      cap.position.set(pillar.position.x, 6.6, pillar.position.z);
      cap.scale.setScalar(0.8);
      scene.add(cap);
      floaters.push({ mesh: cap, baseY: 6.6, phase: c * 1.7, amp: 0.25, spin: 0.4 });
    }
    // Floating crystals around the arena, kept clear of the camera's lane.
    var crysGeo = geo('crys', function () { return new THREE.OctahedronGeometry(1); });
    for (var f = 0; f < 20; f++) {
      var ang = (f / 20) * Math.PI * 2;
      var rad = 26 + (f % 3) * 4;
      var cx = Math.cos(ang) * rad;
      var cz = Math.sin(ang) * rad * 1.15;
      if (cz > 5 && Math.abs(cx) < 30) continue; // keep the camera lane clear
      var crys = new THREE.Mesh(crysGeo, basic(f % 2 ? 0x67e8f9 : 0xc084fc, true, 0.8));
      var cy = 6 + (f % 4) * 2.2;
      crys.position.set(cx, cy, cz);
      crys.scale.setScalar(0.7 + (f % 3) * 0.35);
      scene.add(crys);
      floaters.push({ mesh: crys, baseY: cy, phase: f * 0.9, amp: 0.5, spin: 0.25 + (f % 3) * 0.12 });
    }
    // Stars.
    var starCount = 260;
    var starPos = new Float32Array(starCount * 3);
    for (var s = 0; s < starCount; s++) {
      starPos[s * 3] = (Math.random() * 2 - 1) * 90;
      starPos[s * 3 + 1] = 18 + Math.random() * 55;
      starPos[s * 3 + 2] = (Math.random() * 2 - 1) * 90;
    }
    var starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({
      color: 0xdde4ff, size: 0.55, sizeAttenuation: true, transparent: true, opacity: 0.85, fog: false,
    })));

    // Drifting star-motes: slow ambient specks rising around the arena, so
    // the air itself feels alive even when no battle is running.
    moteGeo = new THREE.BufferGeometry();
    motePos = new Float32Array(MOTE_MAX * 3);
    moteSpeed = new Float32Array(MOTE_MAX);
    for (var mo = 0; mo < MOTE_MAX; mo++) {
      var ma = Math.random() * Math.PI * 2;
      var mr = 9 + Math.random() * 26;
      motePos[mo * 3] = Math.cos(ma) * mr;
      motePos[mo * 3 + 1] = 0.5 + Math.random() * 13;
      motePos[mo * 3 + 2] = Math.sin(ma) * mr * 1.1;
      moteSpeed[mo] = 0.25 + Math.random() * 0.5;
    }
    moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
    var motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({
      color: 0x9fd8ff, size: 0.28, transparent: true, opacity: 0.6,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    }));
    motes.frustumCulled = false;
    scene.add(motes);

    // Particle pool.
    pGeo = new THREE.BufferGeometry();
    pPos = new Float32Array(PMAX * 3);
    pCol = new Float32Array(PMAX * 3);
    for (var p = 0; p < PMAX; p++) {
      pPos[p * 3 + 1] = -999;
      parts.push({ life: 0, maxLife: 1, vx: 0, vy: 0, vz: 0, x: 0, y: -999, z: 0, r: 1, g: 1, b: 1, grav: 0 });
    }
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
    var points = new THREE.Points(pGeo, new THREE.PointsMaterial({
      size: 0.42, vertexColors: true, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    }));
    points.frustumCulled = false;
    scene.add(points);

    // Placement ghost: disc + ring.
    ghost = new THREE.Group();
    var disc = new THREE.Mesh(
      geo('ghostDisc', function () { return new THREE.CircleGeometry(1, 28); }),
      new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.3, depthWrite: false })
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.06;
    ghost.add(disc);
    ghostRing = new THREE.Mesh(
      geo('ghostRing', function () { return new THREE.RingGeometry(0.92, 1, 28); }),
      new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide })
    );
    ghostRing.rotation.x = -Math.PI / 2;
    ghostRing.position.y = 0.07;
    ghost.add(ghostRing);
    ghost.visible = false;
    scene.add(ghost);

    window.addEventListener('resize', onResize);
  }

  function onResize() {
    if (!renderer || !camera) return;
    var w = renderer.domElement.parentElement.clientWidth;
    var h = renderer.domElement.parentElement.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function burst(x, z, colorHex, count, speed, up, life, grav) {
    var col = new THREE.Color(colorHex);
    for (var i = 0; i < count; i++) {
      var p = parts[pNext];
      pNext = (pNext + 1) % PMAX;
      var ang = Math.random() * Math.PI * 2;
      var sp = speed * (0.4 + Math.random() * 0.8);
      p.x = x; p.y = 0.6 + Math.random() * 0.5; p.z = z;
      p.vx = Math.cos(ang) * sp;
      p.vz = Math.sin(ang) * sp;
      p.vy = up * (0.5 + Math.random());
      p.life = p.maxLife = life * (0.6 + Math.random() * 0.7);
      p.r = col.r; p.g = col.g; p.b = col.b;
      p.grav = grav === undefined ? 6 : grav;
    }
  }

  function spawnRing(x, z, colorHex, maxR, dur) {
    var mesh = new THREE.Mesh(
      geo('ring', function () { return new THREE.RingGeometry(0.8, 1, 36); }),
      new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.12, z);
    mesh.scale.setScalar(0.2);
    scene.add(mesh);
    rings.push({ mesh: mesh, t: 0, dur: dur, maxR: maxR });
  }

  function addShake(mag) {
    shakeMag = Math.max(shakeMag, mag);
    shakeT = 0.35;
  }

  // ---- Mesh builders: character figures and structures, primitives only. ----

  function teamMats(side) {
    var s = SIDES[side];
    return {
      main: lambert(s.color, s.color, 0.35),
      dark: lambert(s.dark, 0x000000, 0),
      trim: basic(s.color),
    };
  }

  function blobShadow(radius) {
    var m = new THREE.Mesh(
      geo('blob', function () { return new THREE.CircleGeometry(1, 20); }),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.03;
    m.scale.setScalar(radius);
    return m;
  }

  function hpBar(width, y) {
    var group = new THREE.Group();
    var bg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x1a1a26, depthWrite: false, transparent: true, opacity: 0.75 }));
    bg.scale.set(width, 0.18, 1);
    var fg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x4ade80, depthWrite: false }));
    fg.scale.set(width, 0.13, 1);
    fg.position.z = 0.01;
    group.add(bg);
    group.add(fg);
    group.position.y = y;
    return { group: group, fg: fg, width: width };
  }

  // ---- Character figures: assembled humanoids from primitives. ----
  // Every unit is a little crystal construct: legs that swing as it walks,
  // arms that swing and strike, a headed torso, and one signature accessory
  // per card. Faces are two dark eye-slots and a glowing brow crystal, so a
  // figure reads as a character even at contact-sheet size. Team colour
  // carries the torso and helm; the card's tint carries the weapon glow.
  // `top` is the figure's height in local units, before its own scale.

  var CHAR_SPECS = {
    shardlings: { scale: 1.3, bulk: 0.85, weapon: 'shard', hat: 'crest', top: 1.5 },
    sparkarcher: { scale: 1.8, bulk: 0.85, weapon: 'bow', hat: 'circlet', top: 1.5 },
    galerunner: { scale: 1.7, bulk: 0.85, weapon: 'dagger', hat: 'scarf', top: 1.5 },
    bulwark: { scale: 2.2, bulk: 1.35, weapon: 'maul', hat: 'pauldrons', shield: true, top: 1.55 },
    emberlobber: { scale: 1.8, bulk: 1.0, weapon: 'staff', hat: 'cone', robe: true, top: 1.85 },
    skymender: { scale: 1.8, bulk: 0.9, weapon: 'orb', hat: 'halo', floats: true, top: 1.8 },
    stormcolossus: { scale: 2.6, bulk: 1.4, weapon: 'fists', hat: 'horns', top: 1.7 },
  };

  // One shared geometry per shape, scaled per part: keeps the draw setup
  // small no matter how many figures share the arena.
  function uBox() { return geo('uBox', function () { return new THREE.BoxGeometry(1, 1, 1); }); }
  function uSph() { return geo('uSph', function () { return new THREE.SphereGeometry(1, 10, 8); }); }
  function uCyl() { return geo('uCyl', function () { return new THREE.CylinderGeometry(1, 1, 1, 8); }); }
  function uCone() { return geo('uCone', function () { return new THREE.ConeGeometry(1, 1, 8); }); }
  function uOct() { return geo('uOct', function () { return new THREE.OctahedronGeometry(1); }); }
  function uTorus() { return geo('uTorus', function () { return new THREE.TorusGeometry(1, 0.12, 6, 16); }); }

  function boxPart(mat, w, h, d) {
    var m = new THREE.Mesh(uBox(), mat);
    m.scale.set(w, h, d);
    return m;
  }
  function ballPart(mat, r) {
    var m = new THREE.Mesh(uSph(), mat);
    m.scale.setScalar(r);
    return m;
  }
  function put(parent, mesh, x, y, z) {
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }

  // A limb pivots at its joint: the mesh hangs below the pivot, so rotating
  // the pivot's x-axis swings it like a walk cycle.
  function limb(mat, w, len, d) {
    var pivot = new THREE.Group();
    var m = boxPart(mat, w, len, d);
    m.position.y = -len / 2;
    pivot.add(m);
    return pivot;
  }

  function buildHumanoid(e, tm) {
    var spec = CHAR_SPECS[e.card] || CHAR_SPECS.sparkarcher;
    var tint = CFG.CARDS[e.card].tint;
    var g = new THREE.Group();
    var body = new THREE.Group();
    body.scale.setScalar(spec.scale);
    g.add(body);
    var parts = {};
    var B = spec.bulk;
    var pale = lambert(0xd8d3e8, 0x222222, 0.4);
    var dark = tm.dark;
    var suit = tm.main;
    var trim = tm.trim;
    var glow = basic(tint);
    var eyeMat = basic(0x1a1a26);

    // Legs, or a robe / floating skirt instead.
    if (spec.floats) {
      var skirt = new THREE.Mesh(uCone(), suit);
      skirt.scale.set(0.42 * B, 0.7, 0.42 * B);
      skirt.rotation.x = Math.PI;
      put(body, skirt, 0, 0.35, 0);
      parts.robe = skirt;
    } else if (spec.robe) {
      var robe = new THREE.Mesh(uCyl(), suit);
      robe.scale.set(0.34 * B, 0.62, 0.34 * B);
      put(body, robe, 0, 0.31, 0);
      parts.robe = robe;
    } else {
      parts.legL = limb(dark, 0.15 * B, 0.52, 0.17);
      parts.legL.position.set(-0.14 * B, 0.52, 0);
      body.add(parts.legL);
      parts.legR = limb(dark, 0.15 * B, 0.52, 0.17);
      parts.legR.position.set(0.14 * B, 0.52, 0);
      body.add(parts.legR);
      [parts.legL, parts.legR].forEach(function (leg) {
        put(leg, boxPart(trim, 0.16 * B, 0.08, 0.26), 0, -0.5, 0.04);
      });
    }
    // Torso: team-coloured suit, dark belt, glowing chest core.
    put(body, boxPart(suit, 0.46 * B, 0.52, 0.3), 0, 0.78, 0);
    put(body, boxPart(dark, 0.48 * B, 0.09, 0.32), 0, 0.56, 0);
    var core = new THREE.Mesh(uOct(), glow);
    core.scale.setScalar(0.09);
    put(body, core, 0, 0.84, 0.17);
    parts.core = core;
    // Arms hang from shoulder pivots; the right arm carries the weapon.
    parts.armL = limb(pale, 0.13, 0.46, 0.15);
    parts.armL.position.set(-0.3 * B, 1.0, 0);
    body.add(parts.armL);
    parts.armR = limb(pale, 0.13, 0.46, 0.15);
    parts.armR.position.set(0.3 * B, 1.0, 0);
    body.add(parts.armR);
    [parts.armL, parts.armR].forEach(function (arm) {
      put(arm, ballPart(trim, 0.09), 0, -0.48, 0);
    });
    // Head: pale crystal skull, dark eyes, glowing brow, team helm.
    var head = new THREE.Group();
    head.position.y = 1.24;
    head.add(ballPart(pale, 0.21));
    var helm = new THREE.Mesh(uSph(), trim);
    helm.scale.set(0.225, 0.14, 0.225);
    helm.position.y = 0.09;
    head.add(helm);
    [-0.08, 0.08].forEach(function (x) {
      put(head, boxPart(eyeMat, 0.05, 0.07, 0.03), x, 0.01, 0.2);
    });
    var brow = new THREE.Mesh(uOct(), glow);
    brow.scale.setScalar(0.06);
    put(head, brow, 0, 0.1, 0.2);
    body.add(head);
    parts.head = head;

    // Hats and signature accessories, one per card.
    if (spec.hat === 'crest') {
      var crest = new THREE.Mesh(uOct(), glow);
      crest.scale.set(0.1, 0.2, 0.06);
      put(head, crest, 0, 0.28, 0);
    } else if (spec.hat === 'circlet') {
      var circ = new THREE.Mesh(uTorus(), glow);
      circ.scale.setScalar(0.22);
      circ.rotation.x = Math.PI / 2;
      put(head, circ, 0, 0.12, 0);
    } else if (spec.hat === 'scarf') {
      var scarf = boxPart(glow, 0.2, 0.06, 0.5);
      scarf.rotation.x = 0.35;
      put(body, scarf, 0, 1.1, -0.32);
      parts.scarf = scarf;
    } else if (spec.hat === 'pauldrons') {
      [-1, 1].forEach(function (s) {
        put(body, ballPart(trim, 0.2), s * 0.36 * B, 1.04, 0);
      });
    } else if (spec.hat === 'cone') {
      var hat = new THREE.Mesh(uCone(), trim);
      hat.scale.set(0.3, 0.42, 0.3);
      put(head, hat, 0, 0.32, 0);
    } else if (spec.hat === 'halo') {
      var halo = new THREE.Mesh(uTorus(), glow);
      halo.scale.setScalar(0.3);
      halo.rotation.x = Math.PI / 2.4;
      put(head, halo, 0, 0.34, 0);
      parts.halo = halo;
    } else if (spec.hat === 'horns') {
      [-1, 1].forEach(function (s) {
        var horn = new THREE.Mesh(uCone(), glow);
        horn.scale.set(0.09, 0.3, 0.09);
        horn.rotation.z = -s * 0.35;
        put(head, horn, s * 0.16, 0.26, 0);
      });
    }
    addWeapon(body, parts, spec.weapon, tm, glow);
    if (spec.shield) {
      put(parts.armL, boxPart(trim, 0.52, 0.72, 0.09), -0.1, -0.45, 0.16);
      put(parts.armL, ballPart(glow, 0.09), -0.1, -0.45, 0.23);
    }
    return { group: g, parts: parts, barY: spec.top * spec.scale + 0.35 };
  }

  // Weapons ride the arm pivots, so a strike swings the weapon with the arm.
  function addWeapon(body, parts, kind, tm, glow) {
    var handY = -0.52;
    if (kind === 'bow') {
      // Two angled limbs and a string: a bow silhouette, held in the left hand.
      var upper = boxPart(tm.dark, 0.05, 0.42, 0.06);
      upper.rotation.x = -0.28;
      put(parts.armL, upper, 0, handY + 0.18, 0.14);
      var lower = boxPart(tm.dark, 0.05, 0.42, 0.06);
      lower.rotation.x = 0.28;
      put(parts.armL, lower, 0, handY - 0.18, 0.14);
      put(parts.armL, boxPart(basic(0xe7e5e4), 0.02, 0.68, 0.02), 0, handY, 0.05);
      var quiver = new THREE.Mesh(uCyl(), tm.dark);
      quiver.scale.set(0.07, 0.4, 0.07);
      quiver.rotation.z = 0.3;
      put(body, quiver, 0.14, 0.92, -0.22);
      return;
    }
    var arm = parts.armR;
    if (kind === 'shard') {
      var shard = new THREE.Mesh(uOct(), glow);
      shard.scale.set(0.09, 0.2, 0.09);
      put(arm, shard, 0, handY, 0.1);
    } else if (kind === 'dagger') {
      var blade = boxPart(glow, 0.05, 0.34, 0.1);
      blade.rotation.x = 0.5;
      put(arm, blade, 0, handY - 0.1, 0.12);
    } else if (kind === 'maul') {
      var haft = new THREE.Mesh(uCyl(), tm.dark);
      haft.scale.set(0.05, 0.8, 0.05);
      put(arm, haft, 0, handY - 0.1, 0.1);
      put(arm, boxPart(tm.main, 0.3, 0.26, 0.26), 0, handY - 0.48, 0.1);
    } else if (kind === 'staff' || kind === 'orb') {
      var staff = new THREE.Mesh(uCyl(), tm.dark);
      staff.scale.set(0.045, 1.05, 0.045);
      put(arm, staff, 0, handY - 0.1, 0.08);
      put(arm, ballPart(glow, 0.13), 0, handY + 0.48, 0.08);
    } else if (kind === 'fists') {
      [parts.armL, parts.armR].forEach(function (a) {
        put(a, ballPart(tm.main, 0.2), 0, handY, 0);
      });
    }
  }

  // Buildings stay structures, with one living detail each: an orbiting
  // frost wisp for the obelisk, a floating rune for the bastion.
  function buildStructureMesh(e) {
    var tm = teamMats(e.side);
    var g = new THREE.Group();
    var parts = {};
    var h = 1.0;
    if (e.card === 'frostobelisk') {
      var ob = new THREE.Mesh(geo('obel', function () { return new THREE.CylinderGeometry(0.3, 0.62, 2.6, 4); }), lambert(0xbfdbfe, 0x60a5fa, 0.7));
      ob.position.y = 1.3;
      g.add(ob);
      var top = new THREE.Mesh(geo('oct0', function () { return new THREE.OctahedronGeometry(0.42); }), basic(0x93c5fd));
      top.position.y = 3.0;
      g.add(top);
      var wisp = new THREE.Mesh(uOct(), basic(0xbfdbfe));
      wisp.scale.setScalar(0.18);
      g.add(wisp);
      parts.orbit = wisp;
      h = 3.4;
    } else {
      var bodyMat = lambert(0xd8d3e8, 0x222222, 0.4);
      var block = new THREE.Mesh(geo('boxW', function () { return new THREE.BoxGeometry(1.7, 1.9, 1.7); }), bodyMat);
      block.position.y = 0.95;
      g.add(block);
      var rune = new THREE.Mesh(geo('runeP', function () { return new THREE.PlaneGeometry(1.1, 1.1); }), basic(SIDES[e.side].color, true, 0.85));
      rune.position.set(0, 1.0, 0.87);
      rune.rotation.y = e.side === 'player' ? Math.PI : 0;
      g.add(rune);
      var diamond = new THREE.Mesh(uOct(), tm.trim);
      diamond.scale.setScalar(0.25);
      diamond.position.y = 2.5;
      g.add(diamond);
      parts.rune = diamond;
      h = 2.1;
    }
    g.add(blobShadow(e.radius + 0.25));
    var bar = hpBar(Math.max(0.9, e.radius * 2.1), h + 0.35);
    g.add(bar.group);
    return { group: g, bar: bar, height: h, baseY: 0, parts: parts };
  }

  function buildUnitMesh(e) {
    if (e.card === 'frostobelisk' || e.card === 'runebastion') {
      return buildStructureMesh(e);
    }
    var tm = teamMats(e.side);
    var built = buildHumanoid(e, tm);
    var g = built.group;
    g.add(blobShadow(e.radius + 0.25));
    var bar = hpBar(Math.max(0.9, e.radius * 2.1), built.barY);
    g.add(bar.group);
    return { group: g, bar: bar, height: built.barY, baseY: 0, parts: built.parts };
  }

  function buildTowerMesh(e) {
    var tm = teamMats(e.side);
    var g = new THREE.Group();
    var stone = lambert(0x8d8aa8, 0x222222, 0.3);
    var isKeep = e.kind === 'keep';
    var s = isKeep ? 1.5 : 1.0;
    var base = new THREE.Mesh(geo('tBase', function () { return new THREE.CylinderGeometry(1.5, 1.8, 0.8, 10); }), stone);
    base.position.y = 0.4;
    base.scale.setScalar(s);
    g.add(base);
    var shaft = new THREE.Mesh(geo('tShaft', function () { return new THREE.CylinderGeometry(0.85, 1.15, 2.6, 10); }), stone);
    shaft.position.y = 0.8 + 1.3 * s;
    shaft.scale.set(s, s, s);
    g.add(shaft);
    var top = new THREE.Mesh(geo('tTop', function () { return new THREE.CylinderGeometry(1.15, 0.9, 0.7, 10); }), tm.dark);
    top.position.y = 0.8 + 2.6 * s + 0.35 * s;
    top.scale.set(s, s, s);
    g.add(top);
    var crystal = new THREE.Mesh(geo('tCrys', function () { return new THREE.OctahedronGeometry(0.7); }), tm.main);
    crystal.position.y = 0.8 + 2.6 * s + 0.7 * s + 0.8;
    crystal.scale.setScalar(s);
    g.add(crystal);
    g.userData.crystal = crystal;
    g.userData.crystalY = crystal.position.y;
    // A breathing ring at the tower's foot, in the owner's colour.
    var foot = new THREE.Mesh(
      geo('tRing', function () { return new THREE.RingGeometry(1.55, 1.85, 32); }),
      new THREE.MeshBasicMaterial({ color: SIDES[e.side].color, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide })
    );
    foot.rotation.x = -Math.PI / 2;
    foot.position.y = 0.08;
    foot.scale.setScalar(s);
    g.add(foot);
    pulseRings.push({ mesh: foot, phase: (e.x + e.z) * 0.4 });
    g.add(blobShadow(1.9 * s));
    var h = 0.8 + 2.6 * s + 0.7 * s + 1.8;
    var bar = hpBar(isKeep ? 3.4 : 2.4, h);
    g.add(bar.group);
    return { group: g, bar: bar, height: h, baseY: 0 };
  }

  function buildRubble(e) {
    var g = new THREE.Group();
    var stone = lambert(0x55506e, 0x111111, 0.2);
    var base = new THREE.Mesh(geo('tBase', function () { return new THREE.CylinderGeometry(1.5, 1.8, 0.8, 10); }), stone);
    base.position.y = 0.4;
    base.scale.setScalar(e.kind === 'keep' ? 1.5 : 1.0);
    g.add(base);
    var chunk = new THREE.Mesh(geo('boxB', function () { return new THREE.BoxGeometry(1.15, 1.25, 0.8); }), stone);
    chunk.position.set(0.4, 0.9, 0.3);
    chunk.rotation.set(0.4, 0.7, 0.2);
    g.add(chunk);
    g.add(blobShadow(1.6));
    return { group: g, bar: null, height: 1, baseY: 0 };
  }

  function sync(match, dt, time) {
    var seen = new Set();
    for (var i = 0; i < match.entities.length; i++) {
      var e = match.entities[i];
      seen.add(e.id);
      var rec = meshes.get(e.id);
      if (!rec) {
        // A tower that already fell (e.g. after a fast-forward) is rubble.
        var built = e.isTower && e.dead ? buildRubble(e) : e.isTower ? buildTowerMesh(e) : buildUnitMesh(e);
        built.group.position.set(e.x, 0, e.z);
        scene.add(built.group);
        rec = { mesh: built.group, bar: built.bar, height: built.height, kind: e.card, side: e.side, isTower: e.isTower, seed: e.id * 0.37, baseScale: e.isTower ? 1 : 1.4, parts: built.parts || null };
        meshes.set(e.id, rec);
      }
      rec.mesh.position.x = e.x;
      rec.mesh.position.z = e.z;
      // Facing: toward heading when moving, else toward the enemy side.
      var face = e.heading !== undefined ? e.heading : (e.side === 'player' ? Math.PI : 0);
      rec.mesh.rotation.y = face;
      // Character animation: the walk cycle is driven by distance moved,
      // the strike by the attack flash, the rest by idle breathing.
      var bob = 0;
      var parts = rec.parts;
      if (parts) {
        var moved = 0;
        if (rec.prevX !== undefined) {
          var mdx = e.x - rec.prevX;
          var mdz = e.z - rec.prevZ;
          moved = Math.sqrt(mdx * mdx + mdz * mdz);
        }
        rec.prevX = e.x;
        rec.prevZ = e.z;
        rec.walkPhase = (rec.walkPhase || 0) + moved * 3.4;
        var targetAmp = moved > 0.002 ? 0.6 : 0;
        rec.swingAmp = rec.swingAmp === undefined ? targetAmp
          : rec.swingAmp + (targetAmp - rec.swingAmp) * 0.25;
        var swing = Math.sin(rec.walkPhase);
        var walkK = Math.min(1, rec.swingAmp * 2);
        var atk = e.attackFlash > 0 ? Math.min(1, e.attackFlash / 0.25) : 0;
        if (parts.legL) {
          parts.legL.rotation.x = swing * rec.swingAmp;
          parts.legR.rotation.x = -swing * rec.swingAmp;
          bob = -Math.abs(Math.cos(rec.walkPhase)) * 0.05 * walkK;
          rec.mesh.rotation.z = Math.sin(rec.walkPhase) * 0.03 * walkK;
        }
        if (parts.armL) parts.armL.rotation.x = -swing * rec.swingAmp * 0.7;
        if (parts.armR) parts.armR.rotation.x = -swing * rec.swingAmp * 0.7 - atk * 1.5;
        if (parts.head) {
          parts.head.rotation.y = Math.sin(time * 0.6 + rec.seed * 3) * 0.18 * (1 - walkK);
          parts.head.rotation.x = Math.sin(time * 1.7 + rec.seed * 5) * 0.04;
        }
        if (parts.core) parts.core.rotation.y += dt * 2;
        if (parts.scarf) parts.scarf.rotation.x = 0.35 + Math.sin(time * 6 + rec.seed) * 0.12 + walkK * 0.3;
        if (parts.halo) parts.halo.rotation.z += dt * 1.5;
        if (parts.robe) parts.robe.rotation.z = Math.sin(rec.walkPhase) * 0.05 * walkK;
        if (parts.orbit) {
          parts.orbitAngle = (parts.orbitAngle || 0) + dt * 1.6;
          parts.orbit.position.set(
            Math.cos(parts.orbitAngle) * 1.1,
            2.2 + Math.sin(time * 2 + rec.seed) * 0.15,
            Math.sin(parts.orbitAngle) * 1.1
          );
        }
        if (parts.rune) {
          parts.rune.position.y = 2.5 + Math.sin(time * 1.8 + rec.seed) * 0.15;
          parts.rune.rotation.y += dt;
        }
      }
      if (e.card === 'skymender') bob = Math.sin(time * 2.2 + rec.seed) * 0.18 + 0.15;
      rec.mesh.position.y = bob;
      var scale = rec.baseScale || 1;
      if (e.spawnT < 0.3) scale *= 0.4 + (e.spawnT / 0.3) * 0.6;
      if (e.attackFlash > 0) scale *= 1 + e.attackFlash * 0.25;
      rec.mesh.scale.setScalar(scale);
      if (rec.mesh.userData.crystal) {
        var crys = rec.mesh.userData.crystal;
        crys.rotation.y += dt * 1.2;
        crys.position.y = rec.mesh.userData.crystalY + Math.sin(time * 1.4 + rec.seed) * 0.12;
      }
      // HP bar.
      if (rec.bar) {
        var frac = Math.max(0, e.hp / e.maxHp);
        rec.bar.fg.scale.x = rec.bar.width * frac;
        rec.bar.fg.position.x = -rec.bar.width * (1 - frac) / 2;
        rec.bar.fg.material.color.setHex(frac > 0.5 ? 0x4ade80 : frac > 0.25 ? 0xfacc15 : 0xef4444);
        rec.bar.group.visible = e.hp < e.maxHp;
      }
    }
    // Remove meshes whose entities are gone (units swept by the sim).
    var dead = [];
    meshes.forEach(function (rec, id) {
      if (!seen.has(id) && !rec.isTower) dead.push(id);
    });
    for (var d = 0; d < dead.length; d++) {
      var gone = meshes.get(dead[d]);
      if (gone) {
        scene.remove(gone.mesh);
        meshes.delete(dead[d]);
      }
    }
    // Projectiles: pool sync.
    for (var p = 0; p < match.projectiles.length; p++) {
      var proj = match.projectiles[p];
      var pm = projectilePool[p];
      if (!pm) {
        pm = new THREE.Mesh(
          geo('proj', function () { return new THREE.SphereGeometry(0.22, 10, 8); }),
          basic(0xffffff)
        );
        scene.add(pm);
        projectilePool.push(pm);
      }
      pm.visible = true;
      pm.position.set(proj.x, 1.3 + Math.sin(time * 14 + p) * 0.08, proj.z);
      var col = proj.kind === 'frostobelisk' ? 0x93c5fd : proj.kind === 'emberlobber' ? 0xfb923c : SIDES[proj.side].color;
      pm.material = basic(col);
      pm.scale.setScalar(proj.splash > 0 ? 1.5 : 1);
    }
    for (var q = match.projectiles.length; q < projectilePool.length; q++) {
      projectilePool[q].visible = false;
    }
    // Spell markers: one ring + falling star per pending spell.
    var liveSpells = new Set(match.spells);
    spellMarkers.forEach(function (mesh, spell) {
      if (!liveSpells.has(spell)) {
        scene.remove(mesh);
        spellMarkers.delete(spell);
      }
    });
    for (var s = 0; s < match.spells.length; s++) {
      var sp = match.spells[s];
      var marker = spellMarkers.get(sp);
      if (!marker) {
        marker = new THREE.Group();
        var ringMesh = new THREE.Mesh(
          geo('spellRing', function () { return new THREE.RingGeometry(0.85, 1, 32); }),
          new THREE.MeshBasicMaterial({ color: 0xf87171, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide })
        );
        ringMesh.rotation.x = -Math.PI / 2;
        ringMesh.position.y = 0.1;
        marker.add(ringMesh);
        var star = new THREE.Mesh(geo('oct0', function () { return new THREE.OctahedronGeometry(0.42); }), basic(0xfde68a));
        star.position.y = 14;
        marker.add(star);
        marker.userData.star = star;
        marker.userData.ring = ringMesh;
        scene.add(marker);
        spellMarkers.set(sp, marker);
      }
      marker.position.set(sp.x, 0, sp.z);
      var frac2 = 1 - sp.left / (CFG.CARDS[sp.key].delay || 0.8);
      marker.userData.ring.scale.setScalar(sp.radius);
      marker.userData.star.position.y = 14 * (1 - frac2) + 0.5;
      marker.userData.star.rotation.y += dt * 6;
    }
  }

  function onEvent(ev, match) {
    if (ev.type === 'deploy') {
      burst(ev.x, ev.z, SIDES[ev.side].color, 16, 2.2, 3, 0.5);
      spawnRing(ev.x, ev.z, SIDES[ev.side].color, 1.6, 0.4);
    } else if (ev.type === 'hit') {
      burst(ev.x, ev.z, ev.big ? 0xfca5a5 : 0xfde68a, ev.big ? 26 : 8, 2.5, 2.5, 0.35);
    } else if (ev.type === 'splash') {
      burst(ev.x, ev.z, 0xfb923c, 18, 3.2, 3.5, 0.5);
      spawnRing(ev.x, ev.z, 0xfb923c, (ev.radius || 2) + 0.5, 0.4);
    } else if (ev.type === 'shoot') {
      burst(ev.x, ev.z, 0xfff7cc, 5, 1.2, 1.5, 0.2);
    } else if (ev.type === 'swing') {
      burst(ev.x, ev.z, 0xffffff, 4, 1.8, 1.5, 0.25);
    } else if (ev.type === 'spell') {
      burst(ev.x, ev.z, 0xf87171, 8, 1.5, 2, 0.4);
    } else if (ev.type === 'spellHit') {
      burst(ev.x, ev.z, 0xf87171, 46, 5, 6, 0.7);
      burst(ev.x, ev.z, 0xfde68a, 24, 3, 5, 0.6);
      spawnRing(ev.x, ev.z, 0xf87171, ev.radius + 0.8, 0.55);
      addShake(0.55);
    } else if (ev.type === 'die') {
      burst(ev.x, ev.z, SIDES[ev.side].color, ev.quiet ? 8 : 22, 3, 3.5, 0.55);
      if (ev.kind === 'keep' || ev.kind === 'spire') addShake(0.8);
    } else if (ev.type === 'towerDown') {
      // Swap the tower mesh for rubble.
      meshes.forEach(function (rec, id) {
        if (!rec.isTower) return;
        var ent = null;
        for (var i = 0; i < match.entities.length; i++) {
          if (match.entities[i].id === id) ent = match.entities[i];
        }
        if (ent && ent.dead && Math.abs(ent.x - ev.x) < 0.5 && Math.abs(ent.z - ev.z) < 0.5) {
          scene.remove(rec.mesh);
          var rubble = buildRubble(ent);
          rubble.group.position.set(ent.x, 0, ent.z);
          scene.add(rubble.group);
          meshes.set(id, { mesh: rubble.group, bar: null, height: 1, kind: ent.card, side: ent.side, isTower: true, seed: 0 });
        }
      });
      burst(ev.x, ev.z, 0xa8a29e, 40, 4, 5, 0.8);
      burst(ev.x, ev.z, SIDES[ev.side].color, 26, 3, 4, 0.7);
      spawnRing(ev.x, ev.z, 0xf5b942, 3.5, 0.7);
      addShake(0.9);
    } else if (ev.type === 'heal') {
      burst(ev.x, ev.z, 0x6ee7b7, 6, 0.8, 2.5, 0.5, -1);
    } else if (ev.type === 'crown') {
      burst(ev.x, ev.z, 0xfde68a, 30, 3.5, 5, 0.8, 2);
    }
  }

  function frame(match, dt, time) {
    elapsed = time;
    // Particles.
    for (var i = 0; i < PMAX; i++) {
      var p = parts[i];
      if (p.life > 0) {
        p.life -= dt;
        p.vy -= p.grav * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        if (p.y < 0.1) { p.y = 0.1; p.vy = 0; }
        var fade = Math.max(0, p.life / p.maxLife);
        pPos[i * 3] = p.x;
        pPos[i * 3 + 1] = p.y;
        pPos[i * 3 + 2] = p.z;
        pCol[i * 3] = p.r * fade;
        pCol[i * 3 + 1] = p.g * fade;
        pCol[i * 3 + 2] = p.b * fade;
      } else {
        pPos[i * 3 + 1] = -999;
      }
    }
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.color.needsUpdate = true;
    // Rings.
    for (var r = rings.length - 1; r >= 0; r--) {
      var ring = rings[r];
      ring.t += dt;
      var f = ring.t / ring.dur;
      if (f >= 1) {
        scene.remove(ring.mesh);
        rings.splice(r, 1);
      } else {
        ring.mesh.scale.setScalar(0.2 + f * ring.maxR);
        ring.mesh.material.opacity = 0.9 * (1 - f);
      }
    }
    // Ambient floaters.
    for (var f2 = 0; f2 < floaters.length; f2++) {
      var fl = floaters[f2];
      fl.mesh.position.y = fl.baseY + Math.sin(time * 0.7 + fl.phase) * fl.amp;
      fl.mesh.rotation.y += dt * fl.spin;
    }
    // Star-motes drift upward and wrap.
    if (moteGeo) {
      for (var mi = 0; mi < MOTE_MAX; mi++) {
        var my = motePos[mi * 3 + 1] + moteSpeed[mi] * dt;
        if (my > 14) my = 0.5;
        motePos[mi * 3 + 1] = my;
      }
      moteGeo.attributes.position.needsUpdate = true;
    }
    // Tower foot rings breathe.
    for (var pr = 0; pr < pulseRings.length; pr++) {
      var prr = pulseRings[pr];
      prr.mesh.material.opacity = 0.2 + 0.16 * Math.sin(time * 1.6 + prr.phase);
    }
    // Dying shrink animations.
    for (var d = dying.length - 1; d >= 0; d--) {
      var dn = dying[d];
      dn.t += dt;
      var k = dn.t / 0.35;
      if (k >= 1) {
        scene.remove(dn.rec.mesh);
        dying.splice(d, 1);
      } else {
        dn.rec.mesh.scale.setScalar(Math.max(0.01, 1 - k));
        dn.rec.mesh.position.y = -k * 0.4;
      }
    }
    // Camera shake.
    if (shakeT > 0) {
      shakeT -= dt;
      var m = shakeMag * Math.max(0, shakeT / 0.35);
      camera.position.set(
        cameraBase.x + (Math.random() * 2 - 1) * m,
        cameraBase.y + (Math.random() * 2 - 1) * m * 0.6,
        cameraBase.z + (Math.random() * 2 - 1) * m
      );
      if (shakeT <= 0) { shakeMag = 0; camera.position.copy(cameraBase); }
    }
    if (match) sync(match, dt, time);
    renderer.render(scene, camera);
  }

  function reset() {
    meshes.forEach(function (rec) { scene.remove(rec.mesh); });
    meshes.clear();
    for (var i = 0; i < dying.length; i++) scene.remove(dying[i].rec.mesh);
    dying = [];
    for (var r = 0; r < rings.length; r++) scene.remove(rings[r].mesh);
    rings = [];
    pulseRings = [];
    spellMarkers.forEach(function (mesh) { scene.remove(mesh); });
    spellMarkers.clear();
    for (var p = 0; p < projectilePool.length; p++) projectilePool[p].visible = false;
    for (var k = 0; k < PMAX; k++) { parts[k].life = 0; pPos[k * 3 + 1] = -999; }
    hideGhost();
  }

  function showGhost(x, z, radius, valid) {
    ghost.visible = true;
    ghost.position.set(x, 0, z);
    ghost.scale.setScalar(radius);
    var col = valid ? 0x4ade80 : 0xef4444;
    ghost.children[0].material.color.setHex(col);
    ghost.children[1].material.color.setHex(col);
  }
  function hideGhost() { if (ghost) ghost.visible = false; }

  function screenToGround(clientX, clientY) {
    var rect = renderer.domElement.getBoundingClientRect();
    var nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    var ny = -((clientY - rect.top) / rect.height) * 2 + 1;
    var vec = new THREE.Vector3(nx, ny, 0.5);
    vec.unproject(camera);
    var dir = vec.sub(camera.position).normalize();
    if (dir.y >= -0.001) return null;
    var t = -camera.position.y / dir.y;
    return { x: camera.position.x + dir.x * t, z: camera.position.z + dir.z * t };
  }

  window.SS = window.SS || {};
  window.SS.render = {
    init: init, frame: frame, reset: reset, onEvent: onEvent,
    showGhost: showGhost, hideGhost: hideGhost,
    screenToGround: screenToGround, burst: burst, addShake: addShake,
  };
})();
