// Starfall Spires — interface. The DOM layer: card hand, energy bar, tower
// health, timer, title / pause / end screens, deck picker and banners. All
// card icons are inline SVG drawn in code: original geometric art, no files.
(function () {
  'use strict';

  var CFG = window.SS.config;
  var CARDS = CFG.CARDS;

  var ICONS = {
    shardlings: '<svg viewBox="0 0 48 48"><path d="M14 30 L20 14 L26 30 Z" fill="#7dd3fc"/><path d="M24 34 L30 18 L36 34 Z" fill="#38bdf8"/><path d="M8 38 L14 26 L20 38 Z" fill="#bae6fd"/></svg>',
    sparkarcher: '<svg viewBox="0 0 48 48"><path d="M10 38 Q24 30 38 10" stroke="#fde68a" stroke-width="3" fill="none"/><line x1="10" y1="38" x2="38" y2="10" stroke="#fde68a" stroke-width="2"/><circle cx="24" cy="24" r="5" fill="#f59e0b"/></svg>',
    galerunner: '<svg viewBox="0 0 48 48"><path d="M6 32 L30 32 L40 20 L28 20 L34 10 L14 22 L22 26 L10 26 Z" fill="#86efac"/><path d="M6 38 L26 38" stroke="#4ade80" stroke-width="3"/></svg>',
    bulwark: '<svg viewBox="0 0 48 48"><rect x="12" y="10" width="24" height="28" rx="3" fill="#f59e0b"/><rect x="17" y="16" width="14" height="16" rx="2" fill="#78350f"/><rect x="8" y="14" width="6" height="12" rx="2" fill="#d97706"/><rect x="34" y="14" width="6" height="12" rx="2" fill="#d97706"/></svg>',
    emberlobber: '<svg viewBox="0 0 48 48"><path d="M24 6 Q34 20 30 30 Q26 38 18 32 Q10 26 16 16 Q19 10 24 6 Z" fill="#fb923c"/><circle cx="24" cy="30" r="7" fill="#f97316"/><circle cx="24" cy="30" r="3.5" fill="#fde68a"/></svg>',
    skymender: '<svg viewBox="0 0 48 48"><path d="M24 6 L34 24 L24 42 L14 24 Z" fill="#6ee7b7"/><path d="M24 16 L28 24 L24 32 L20 24 Z" fill="#ecfdf5"/><circle cx="24" cy="24" r="3" fill="#059669"/></svg>',
    frostobelisk: '<svg viewBox="0 0 48 48"><path d="M24 4 L30 34 L18 34 Z" fill="#93c5fd"/><path d="M24 4 L27 34 L21 34 Z" fill="#dbeafe"/><rect x="14" y="34" width="20" height="6" rx="2" fill="#60a5fa"/></svg>',
    runebastion: '<svg viewBox="0 0 48 48"><rect x="9" y="12" width="30" height="26" rx="3" fill="#d6d3d1"/><path d="M24 17 L29 24 L24 31 L19 24 Z" fill="#78716c"/><circle cx="24" cy="24" r="2.5" fill="#f5b942"/></svg>',
    stormcolossus: '<svg viewBox="0 0 48 48"><path d="M10 40 L14 16 L24 8 L34 16 L38 40 Z" fill="#c4b5fd"/><path d="M24 14 L28 24 L22 24 L26 34 L18 24 L24 24 Z" fill="#fde68a"/></svg>',
    meteorcall: '<svg viewBox="0 0 48 48"><circle cx="30" cy="16" r="9" fill="#f87171"/><circle cx="30" cy="16" r="4" fill="#fca5a5"/><path d="M24 22 L12 36 M30 26 L20 40 M36 24 L28 38" stroke="#fbbf24" stroke-width="3"/></svg>',
  };

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  function fmtTime(sec) {
    sec = Math.max(0, Math.ceil(sec));
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  var ui = {
    handEls: [],
    nextEl: null,
    energyFill: null,
    energyText: null,
    timerEl: null,
    phaseEl: null,
    playerKeepEl: null,
    rivalKeepEl: null,
    playerCrownsEl: null,
    rivalCrownsEl: null,
    bannerEl: null,
    bannerTimer: 0,
    toastEl: null,
    toastTimer: 0,

    init: function (hooks) {
      this.hooks = hooks;
      var hud = document.getElementById('hud');
      // Top bar.
      var top = el('div', 'topbar');
      var rivalBox = el('div', 'sidebox rival');
      rivalBox.appendChild(el('div', 'sidename', 'UMBRAL COURT'));
      this.rivalKeepEl = el('div', 'keepbar');
      this.rivalKeepEl.appendChild(el('div', 'keepfill'));
      rivalBox.appendChild(this.rivalKeepEl);
      this.rivalCrownsEl = el('div', 'crowns', '');
      rivalBox.appendChild(this.rivalCrownsEl);
      top.appendChild(rivalBox);
      var mid = el('div', 'midbox');
      this.timerEl = el('div', 'timer', '3:00');
      this.phaseEl = el('div', 'phase', 'BATTLE');
      mid.appendChild(this.timerEl);
      mid.appendChild(this.phaseEl);
      top.appendChild(mid);
      var playerBox = el('div', 'sidebox player');
      playerBox.appendChild(el('div', 'sidename', 'AURUM WARD — YOU'));
      this.playerKeepEl = el('div', 'keepbar');
      this.playerKeepEl.appendChild(el('div', 'keepfill'));
      playerBox.appendChild(this.playerKeepEl);
      this.playerCrownsEl = el('div', 'crowns', '');
      playerBox.appendChild(this.playerCrownsEl);
      top.appendChild(playerBox);
      hud.appendChild(top);
      // Corner buttons.
      var corner = el('div', 'cornerbtns');
      var muteBtn = el('button', 'iconbtn', '♪');
      muteBtn.title = 'Mute (M)';
      muteBtn.addEventListener('click', function () { hooks.onMuteKey(); });
      var pauseBtn = el('button', 'iconbtn', 'II');
      pauseBtn.title = 'Pause (P)';
      pauseBtn.addEventListener('click', function () { hooks.onPauseKey(); });
      corner.appendChild(muteBtn);
      corner.appendChild(pauseBtn);
      hud.appendChild(corner);
      this.muteBtn = muteBtn;
      // Bottom bar: energy + hand + next.
      var bottom = el('div', 'bottombar');
      var energyWrap = el('div', 'energywrap');
      energyWrap.appendChild(el('div', 'energylabel', 'STARLIGHT'));
      var energyBar = el('div', 'energybar');
      this.energyFill = el('div', 'energyfill');
      energyBar.appendChild(this.energyFill);
      energyWrap.appendChild(energyBar);
      this.energyText = el('div', 'energytext', '5 / 10');
      energyWrap.appendChild(this.energyText);
      bottom.appendChild(energyWrap);
      var hand = el('div', 'hand');
      for (var i = 0; i < 4; i++) {
        (function (idx) {
          var card = el('div', 'card');
          card.addEventListener('click', function () {
            window.SS.audio.unlock();
            hooks.onCardClick(idx);
          });
          hand.appendChild(card);
          ui.handEls.push(card);
        })(i);
      }
      bottom.appendChild(hand);
      var nextWrap = el('div', 'nextwrap');
      nextWrap.appendChild(el('div', 'nextlabel', 'NEXT'));
      this.nextEl = el('div', 'card next');
      nextWrap.appendChild(this.nextEl);
      bottom.appendChild(nextWrap);
      hud.appendChild(bottom);
      // Banner + toast.
      this.bannerEl = el('div', 'banner hidden');
      hud.appendChild(this.bannerEl);
      this.toastEl = el('div', 'toast hidden');
      hud.appendChild(this.toastEl);
    },

    cardHtml: function (key) {
      var def = CARDS[key];
      return '<div class="cost">✦' + def.cost + '</div>' +
        '<div class="icon">' + (ICONS[key] || '') + '</div>' +
        '<div class="cname">' + def.name + '</div>' +
        '<div class="cblurb">' + def.blurb + '</div>';
    },

    updateHand: function (match, selected) {
      var st = match.player;
      for (var i = 0; i < 4; i++) {
        var key = st.hand[i];
        var cardEl = this.handEls[i];
        if (!key) { cardEl.innerHTML = ''; cardEl.className = 'card empty'; continue; }
        if (cardEl.getAttribute('data-key') !== key) {
          cardEl.innerHTML = this.cardHtml(key);
          cardEl.setAttribute('data-key', key);
        }
        var afford = st.energy >= CARDS[key].cost;
        cardEl.className = 'card' + (i === selected ? ' selected' : '') + (afford ? '' : ' poor');
        cardEl.setAttribute('data-keynum', String(i + 1));
      }
      var nextKey = st.queue[0];
      if (nextKey) {
        if (this.nextEl.getAttribute('data-key') !== nextKey) {
          this.nextEl.innerHTML = this.cardHtml(nextKey);
          this.nextEl.setAttribute('data-key', nextKey);
        }
      }
      var pct = (st.energy / CFG.ARENA.energyMax) * 100;
      this.energyFill.style.width = pct + '%';
      this.energyText.textContent = Math.floor(st.energy) + ' / ' + CFG.ARENA.energyMax;
      this.energyFill.className = 'energyfill' + (st.energy >= CFG.ARENA.energyMax ? ' full' : '');
    },

    updateTop: function (match) {
      var remain;
      var phase;
      if (match.phase === 'overtime') {
        remain = CFG.ARENA.matchSeconds + CFG.ARENA.overtimeSeconds - match.time;
        phase = 'OVERTIME — NEXT CROWN WINS';
      } else {
        remain = CFG.ARENA.matchSeconds - match.time;
        phase = match.time >= CFG.ARENA.doubleTimeAt ? 'DOUBLE STARLIGHT' : 'BATTLE';
      }
      this.timerEl.textContent = fmtTime(remain);
      this.phaseEl.textContent = phase;
      this.phaseEl.className = 'phase' + (match.phase === 'overtime' ? ' overtime' : '');
      var pf = Math.max(0, match.playerKeep.hp / match.playerKeep.maxHp);
      var rf = Math.max(0, match.rivalKeep.hp / match.rivalKeep.maxHp);
      this.playerKeepEl.firstChild.style.width = (pf * 100) + '%';
      this.rivalKeepEl.firstChild.style.width = (rf * 100) + '%';
      this.playerCrownsEl.textContent = '♛'.repeat(match.player.crowns) || '—';
      this.rivalCrownsEl.textContent = '♛'.repeat(match.rival.crowns) || '—';
      // Spire pips via keep bar glow when a spire is down.
      this.playerKeepEl.className = 'keepbar' + (match.playerSpires.some(function (s) { return s.dead; }) ? ' breached' : '');
      this.rivalKeepEl.className = 'keepbar' + (match.rivalSpires.some(function (s) { return s.dead; }) ? ' breached' : '');
    },

    banner: function (text, seconds) {
      this.bannerEl.textContent = text;
      this.bannerEl.className = 'banner';
      this.bannerTimer = seconds || 2.2;
    },

    toast: function (text) {
      this.toastEl.textContent = text;
      this.toastEl.className = 'toast';
      this.toastTimer = 1.6;
    },

    tick: function (dt) {
      if (this.bannerTimer > 0) {
        this.bannerTimer -= dt;
        if (this.bannerTimer <= 0) this.bannerEl.className = 'banner hidden';
      }
      if (this.toastTimer > 0) {
        this.toastTimer -= dt;
        if (this.toastTimer <= 0) this.toastEl.className = 'toast hidden';
      }
    },

    setMuted: function (m) {
      this.muteBtn.textContent = m ? '✕' : '♪';
      this.muteBtn.className = 'iconbtn' + (m ? ' off' : '');
    },

    showTitle: function (deckIndex, onPick, onStart) {
      var overlay = document.getElementById('title-screen');
      overlay.className = 'overlay';
      var decksEl = document.getElementById('deck-list');
      decksEl.innerHTML = '';
      CFG.DECKS.forEach(function (deck, idx) {
        var d = el('div', 'deck' + (idx === deckIndex ? ' picked' : ''));
        d.appendChild(el('div', 'deckname', deck.name));
        d.appendChild(el('div', 'deckstyle', deck.style));
        var chips = el('div', 'deckchips');
        deck.cards.forEach(function (key) {
          chips.appendChild(el('span', 'chip', CARDS[key].name + ' ✦' + CARDS[key].cost));
        });
        d.appendChild(chips);
        d.addEventListener('click', function () {
          window.SS.audio.unlock();
          window.SS.audio.select();
          onPick(idx);
        });
        decksEl.appendChild(d);
      });
      var startBtn = document.getElementById('start-btn');
      startBtn.onclick = function () {
        window.SS.audio.unlock();
        onStart();
      };
      document.getElementById('hud').className = 'hidden';
    },

    hideTitle: function () {
      document.getElementById('title-screen').className = 'overlay hidden';
      document.getElementById('hud').className = '';
    },

    showPause: function (show, onResume, onRestart, onQuit) {
      var overlay = document.getElementById('pause-screen');
      overlay.className = show ? 'overlay' : 'overlay hidden';
      if (!show) return;
      document.getElementById('resume-btn').onclick = onResume;
      document.getElementById('restart-btn').onclick = onRestart;
      document.getElementById('quit-btn').onclick = onQuit;
    },

    showEnd: function (result, stats, onAgain, onDecks) {
      var overlay = document.getElementById('end-screen');
      overlay.className = 'overlay';
      var title = document.getElementById('end-title');
      if (result === 'victory') {
        title.textContent = 'VICTORY';
        title.className = 'endtitle win';
      } else if (result === 'defeat') {
        title.textContent = 'DEFEAT';
        title.className = 'endtitle lose';
      } else {
        title.textContent = 'DRAW';
        title.className = 'endtitle draw';
      }
      document.getElementById('end-sub').textContent =
        result === 'victory' ? 'The Umbral keep lies in ruins. The spires are yours.'
        : result === 'defeat' ? 'Your keep has fallen. The Court takes the arena — this time.'
        : 'Neither keep fell. The arena calls it even.';
      document.getElementById('stat-time').textContent = fmtTime(stats.time);
      document.getElementById('stat-crowns').textContent = stats.crowns + ' — ' + stats.rivalCrowns;
      document.getElementById('stat-deployed').textContent = String(stats.deployed);
      document.getElementById('stat-damage').textContent = String(Math.round(stats.damage));
      document.getElementById('again-btn').onclick = onAgain;
      document.getElementById('decks-btn').onclick = onDecks;
    },

    hideEnd: function () {
      document.getElementById('end-screen').className = 'overlay hidden';
    },
  };

  window.SS = window.SS || {};
  window.SS.ui = ui;
})();
