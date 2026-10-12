// Chomp: a small maze game in the spirit of the arcade classics.
// Eat every dot, dodge the four ghosts, and turn the tables with a power pellet.
// No libraries. Everything is drawn on one canvas.
(function () {
  'use strict';

  var canvas = document.getElementById('chomp');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');

  // ---------- the maze ----------
  // #  wall        .  dot        o  power pellet
  // -  ghost door  G  ghost house    x  outside the maze
  // the row with open ends is a tunnel that wraps around
  var MAP = [
    '###################',
    '#........#........#',
    '#o##.###.#.###.##o#',
    '#.................#',
    '#.##.#.#####.#.##.#',
    '#....#...#...#....#',
    '####.### # ###.####',
    'xxx#.#       #.#xxx',
    '####.# ##-## #.####',
    '    .  #GGG#  .    ',
    '####.# ##### #.####',
    'xxx#.#       #.#xxx',
    '####.# ##### #.####',
    '#........#........#',
    '#.##.###.#.###.##.#',
    '#o.#..... .....#.o#',
    '##.#.#.#####.#.#.##',
    '#....#...#...#....#',
    '#.######.#.######.#',
    '#.................#',
    '###################'
  ];
  var COLS = 19, ROWS = 21, T = 24, TUNNEL = 9;
  var DOOR_OUT = { x: 9, y: 7 }, HOME = { x: 9, y: 9 }, START = { x: 9, y: 15 };

  var UP = { x: 0, y: -1, a: -Math.PI / 2 }, DOWN = { x: 0, y: 1, a: Math.PI / 2 };
  var LEFT = { x: -1, y: 0, a: Math.PI }, RIGHT = { x: 1, y: 0, a: 0 };
  var NONE = { x: 0, y: 0, a: 0 };
  var ORDER = [UP, LEFT, DOWN, RIGHT];
  var KEYS = {
    ArrowUp: UP, ArrowDown: DOWN, ArrowLeft: LEFT, ArrowRight: RIGHT,
    w: UP, s: DOWN, a: LEFT, d: RIGHT, W: UP, S: DOWN, A: LEFT, D: RIGHT
  };
  function opposite(d) { return d === UP ? DOWN : d === DOWN ? UP : d === LEFT ? RIGHT : d === RIGHT ? LEFT : NONE; }

  // ---------- sharp drawing on any screen ----------
  var dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = COLS * T * dpr;
  canvas.height = ROWS * T * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // ---------- state ----------
  var grid, dotsLeft, walls;
  var score = 0, lives = 3, level = 1, best = 0;
  var state = 'title'; // title | ready | play | dying | cleared | over | paused
  var stateT = 0, clock = 0, playT = 0;
  var modeT = 0, modeIx = 0, frightT = 0, combo = 0;
  var MODES = [7, 20, 7, 20, 5, 1e9]; // seconds: scatter, chase, scatter, chase...
  var player, ghosts;
  var visible = true;
  var armed = false; // the keyboard only drives the game after a click or tap on it

  try { best = parseInt(localStorage.getItem('chomp.best'), 10) || 0; } catch (e) { best = 0; }

  var hud = {
    score: document.getElementById('c-score'),
    best: document.getElementById('c-best'),
    lives: document.getElementById('c-lives'),
    level: document.getElementById('c-level')
  };
  function renderHud() {
    if (hud.score) hud.score.textContent = score;
    if (hud.best) hud.best.textContent = best;
    if (hud.lives) hud.lives.textContent = lives;
    if (hud.level) hud.level.textContent = level;
  }

  function cell(x, y) {
    if (y < 0 || y >= ROWS) return 'x';
    if (x < 0 || x >= COLS) return y === TUNNEL ? ' ' : 'x';
    return grid[y][x];
  }

  function loadMaze() {
    grid = MAP.map(function (r) { return r.split(''); });
    dotsLeft = 0;
    for (var y = 0; y < ROWS; y++) for (var x = 0; x < COLS; x++) if (grid[y][x] === '.' || grid[y][x] === 'o') dotsLeft++;
    walls = buildWalls();
  }

  // Walls are drawn once into their own canvas: rounded pipes joining neighbouring wall cells.
  function buildWalls() {
    var c = document.createElement('canvas');
    c.width = canvas.width; c.height = canvas.height;
    var g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.lineCap = 'round';
    g.strokeStyle = '#4C57D6';
    g.fillStyle = '#4C57D6';
    g.lineWidth = T * 0.3;
    g.shadowColor = 'rgba(110, 120, 255, .8)';
    g.shadowBlur = 8;
    g.beginPath();
    for (var y = 0; y < ROWS; y++) {
      for (var x = 0; x < COLS; x++) {
        if (MAP[y][x] !== '#') continue;
        var cx = (x + 0.5) * T, cy = (y + 0.5) * T;
        var lone = true;
        if (x + 1 < COLS && MAP[y][x + 1] === '#') { g.moveTo(cx, cy); g.lineTo(cx + T, cy); lone = false; }
        if (y + 1 < ROWS && MAP[y + 1][x] === '#') { g.moveTo(cx, cy); g.lineTo(cx, cy + T); lone = false; }
        if (lone && !(x > 0 && MAP[y][x - 1] === '#') && !(y > 0 && MAP[y - 1][x] === '#')) { g.moveTo(cx, cy); g.lineTo(cx + 0.01, cy); }
      }
    }
    g.stroke();
    // the ghost door
    g.shadowBlur = 0;
    g.strokeStyle = '#FF9AD5';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(DOOR_OUT.x * T + 3, (DOOR_OUT.y + 1.5) * T);
    g.lineTo((DOOR_OUT.x + 1) * T - 3, (DOOR_OUT.y + 1.5) * T);
    g.stroke();
    return c;
  }

  // ---------- movement: entities walk from tile centre to tile centre ----------
  function makeEntity(x, y) { return { x: x, y: y, tx: x, ty: y, dir: NONE }; }

  function advance(e, dist, decide) {
    var guard = 0;
    while (dist > 0 && guard++ < 8) {
      if (e.dir === NONE) {
        var d0 = decide(e);
        if (d0 === NONE) return;
        e.dir = d0; e.tx = e.x + d0.x; e.ty = e.y + d0.y;
      }
      var rem = Math.abs(e.tx - e.x) + Math.abs(e.ty - e.y);
      if (rem > dist) {
        e.x += e.dir.x * dist; e.y += e.dir.y * dist;
        return;
      }
      e.x = e.tx; e.y = e.ty; dist -= rem;
      if (e.x <= -1) e.x = e.tx = COLS;        // through the tunnel
      else if (e.x >= COLS) e.x = e.tx = -1;
      var d = decide(e);
      e.dir = d;
      if (d === NONE) return;
      e.tx = e.x + d.x; e.ty = e.y + d.y;
    }
  }

  function turnAround(e) {
    if (e.dir === NONE) return;
    e.tx -= e.dir.x; e.ty -= e.dir.y;
    e.dir = opposite(e.dir);
  }

  // ---------- the player ----------
  function playerCanEnter(x, y) {
    var c = cell(x, y);
    return c !== '#' && c !== 'x' && c !== '-' && c !== 'G';
  }

  function playerDecide(e) {
    eat(e.x, e.y);
    var want = e.next;
    if (want && want !== NONE && playerCanEnter(e.x + want.x, e.y + want.y)) return want;
    if (e.dir !== NONE && playerCanEnter(e.x + e.dir.x, e.y + e.dir.y)) return e.dir;
    return NONE;
  }

  function eat(x, y) {
    if (x < 0 || x >= COLS) return;
    var c = grid[y][x];
    if (c === '.') { grid[y][x] = ' '; dotsLeft--; addScore(10); }
    else if (c === 'o') { grid[y][x] = ' '; dotsLeft--; addScore(50); frighten(); }
  }

  function addScore(n) {
    score += n;
    if (score > best) {
      best = score;
      try { localStorage.setItem('chomp.best', String(best)); } catch (e) { /* private window */ }
    }
    renderHud();
  }

  // ---------- the ghosts ----------
  var GHOSTS = [
    { name: 'blaze', color: '#FF5E6C', x: 9, y: 7, release: 0, corner: { x: 17, y: -2 } },
    { name: 'blush', color: '#FF9AD5', x: 9, y: 9, release: 1, corner: { x: 1, y: -2 } },
    { name: 'frost', color: '#5EE6FF', x: 8, y: 9, release: 5, corner: { x: 18, y: 22 } },
    { name: 'moss', color: '#9DF0A0', x: 10, y: 9, release: 10, corner: { x: 0, y: 22 } }
  ];

  function ghostCanEnter(g, x, y) {
    var c = cell(x, y);
    if (c === '#' || c === 'x') return false;
    if (c === '-') return g.state === 'leaving' || g.state === 'entering';
    if (c === 'G') return g.state === 'leaving' || g.state === 'entering' || g.state === 'house';
    return true;
  }

  function chaseTarget(g) {
    var p = player, d = p.dir === NONE ? LEFT : p.dir;
    if (g.name === 'blaze') return { x: p.x, y: p.y };
    if (g.name === 'blush') return { x: p.x + d.x * 4, y: p.y + d.y * 4 };
    if (g.name === 'frost') {
      var b = ghosts[0], ax = p.x + d.x * 2, ay = p.y + d.y * 2;
      return { x: ax * 2 - b.x, y: ay * 2 - b.y };
    }
    var dx = p.x - g.x, dy = p.y - g.y;
    return dx * dx + dy * dy > 49 ? { x: p.x, y: p.y } : g.corner;
  }

  function ghostDecide(g) {
    var x = Math.round(g.x), y = Math.round(g.y);
    // arrivals change what a ghost is doing
    if (g.state === 'leaving' && x === DOOR_OUT.x && y === DOOR_OUT.y) { g.state = 'active'; g.dir = LEFT; }
    else if (g.state === 'eaten' && x === DOOR_OUT.x && y === DOOR_OUT.y) { g.state = 'entering'; g.dir = DOWN; }
    else if (g.state === 'entering' && x === HOME.x && y === HOME.y) { g.state = 'leaving'; g.fright = false; g.dir = NONE; }

    var target;
    if (g.state === 'leaving' || g.state === 'eaten') target = DOOR_OUT;
    else if (g.state === 'entering') target = HOME;
    else if (g.fright) target = null;
    else target = (modeIx % 2 === 0) ? g.corner : chaseTarget(g);

    var back = opposite(g.dir), options = [];
    for (var i = 0; i < 4; i++) {
      var d = ORDER[i];
      if (d === back && g.state !== 'entering') continue;
      if (ghostCanEnter(g, x + d.x, y + d.y)) options.push(d);
    }
    if (!options.length) {
      if (back !== NONE && ghostCanEnter(g, x + back.x, y + back.y)) return back;
      return NONE;
    }
    if (!target) return options[Math.floor(Math.random() * options.length)];
    var bestD = options[0], bestDist = Infinity;
    for (var j = 0; j < options.length; j++) {
      var nx = x + options[j].x - target.x, ny = y + options[j].y - target.y;
      var dist = nx * nx + ny * ny;
      if (dist < bestDist) { bestDist = dist; bestD = options[j]; }
    }
    return bestD;
  }

  function frighten() {
    frightT = Math.max(2.5, 7 - (level - 1) * 0.75);
    combo = 0;
    ghosts.forEach(function (g) {
      if (g.state === 'active') { g.fright = true; turnAround(g); }
    });
  }

  // ---------- rounds ----------
  function resetPositions() {
    player = makeEntity(START.x, START.y);
    player.next = LEFT;
    ghosts = GHOSTS.map(function (d) {
      var g = makeEntity(d.x, d.y);
      g.name = d.name; g.color = d.color; g.corner = d.corner; g.release = d.release;
      g.state = d.y === DOOR_OUT.y ? 'active' : 'house';
      g.fright = false;
      if (g.state === 'active') { g.dir = LEFT; g.tx = g.x - 1; }
      return g;
    });
    frightT = 0; modeT = 0; modeIx = 0; playT = 0;
  }

  function newGame() {
    score = 0; lives = 3; level = 1;
    loadMaze(); resetPositions(); renderHud();
    setState('ready');
  }

  function setState(s) { state = s; stateT = 0; }

  function speeds() {
    var lv = Math.min(level - 1, 6);
    return { player: 6.2 + lv * 0.25, ghost: 5.6 + lv * 0.3 };
  }

  // ---------- the game loop ----------
  function update(dt) {
    stateT += dt;
    if (state === 'ready') { if (stateT > 1.6) setState('play'); return; }
    if (state === 'dying') {
      if (stateT > 1.4) {
        if (lives <= 0) { setState('over'); }
        else { resetPositions(); setState('ready'); }
      }
      return;
    }
    if (state === 'cleared') {
      if (stateT > 1.8) { level++; loadMaze(); resetPositions(); renderHud(); setState('ready'); }
      return;
    }
    if (state !== 'play') return;

    playT += dt;
    var sp = speeds();

    if (frightT > 0) {
      frightT -= dt;
      if (frightT <= 0) ghosts.forEach(function (g) { g.fright = false; });
    } else {
      modeT += dt;
      if (modeT > MODES[modeIx]) {
        modeT = 0; modeIx = Math.min(modeIx + 1, MODES.length - 1);
        ghosts.forEach(function (g) { if (g.state === 'active') turnAround(g); });
      }
    }

    // a reverse is allowed at any moment; other turns wait for the next tile centre
    if (player.next && player.next === opposite(player.dir)) turnAround(player);
    advance(player, sp.player * dt, playerDecide);
    if (dotsLeft <= 0) { setState('cleared'); return; }

    for (var i = 0; i < ghosts.length; i++) {
      var g = ghosts[i];
      if (g.state === 'house') {
        if (playT >= g.release) g.state = 'leaving';
        else continue;
      }
      var gs = g.state === 'eaten' ? sp.ghost * 2.2
        : g.state === 'leaving' || g.state === 'entering' ? sp.ghost * 0.6
        : g.fright ? sp.ghost * 0.55 : sp.ghost;
      advance(g, gs * dt, ghostDecide);
    }

    // collisions
    for (var k = 0; k < ghosts.length; k++) {
      var h = ghosts[k];
      if (h.state !== 'active') continue;
      if (Math.abs(h.x - player.x) + Math.abs(h.y - player.y) < 0.65) {
        if (h.fright) {
          h.fright = false; h.state = 'eaten';
          combo++;
          addScore(100 * Math.pow(2, combo));
        } else {
          lives--; renderHud();
          setState('dying');
          return;
        }
      }
    }
  }

  // ---------- drawing ----------
  function px(v) { return (v + 0.5) * T; }

  function drawPlayer() {
    var x = px(player.x), y = px(player.y), r = T * 0.42;
    var a = player.dir === NONE ? (player.next || LEFT).a : player.dir.a;
    var open;
    if (state === 'dying') open = Math.min(Math.PI, 0.2 + stateT * 2.6);
    else open = player.dir === NONE ? 0.35 : 0.08 + 0.5 * Math.abs(Math.sin(clock * 12));
    if (state === 'dying' && stateT > 1.2) return;
    ctx.fillStyle = '#FFB45E';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, r, a + open / 2, a + Math.PI * 2 - open / 2);
    ctx.closePath();
    ctx.fill();
  }

  function drawGhost(g) {
    if (state === 'dying' && stateT > 0.5) return;
    var bob = g.state === 'house' ? Math.sin(clock * 6 + g.x) * 0.12 : 0;
    var x = px(g.x), y = px(g.y + bob), r = T * 0.44;
    var flashing = g.fright && frightT < 2 && Math.floor(clock * 6) % 2 === 0;
    if (g.state !== 'eaten' && g.state !== 'entering') {
      ctx.fillStyle = g.fright ? (flashing ? '#F4F6FF' : '#3346FF') : g.color;
      ctx.beginPath();
      ctx.arc(x, y - r * 0.15, r, Math.PI, 0);
      var base = y + r * 0.85, w = r * 2, left = x - r;
      ctx.lineTo(x + r, base);
      var wave = Math.floor(clock * 8) % 2 ? 0 : r * 0.33;
      for (var i = 3; i >= 0; i--) {
        var sx = left + (w / 4) * i;
        ctx.lineTo(sx + w / 8, base - r * 0.3 + (i % 2 ? wave : r * 0.33 - wave));
        ctx.lineTo(sx, base);
      }
      ctx.closePath();
      ctx.fill();
    }
    if (g.fright && g.state === 'active') {
      ctx.fillStyle = flashing ? '#FF5E6C' : '#FFD9A8';
      ctx.fillRect(x - r * 0.45, y - r * 0.35, r * 0.22, r * 0.22);
      ctx.fillRect(x + r * 0.23, y - r * 0.35, r * 0.22, r * 0.22);
      return;
    }
    var d = g.dir === NONE ? DOWN : g.dir;
    [-1, 1].forEach(function (s) {
      var ex = x + s * r * 0.36, ey = y - r * 0.25;
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath(); ctx.arc(ex, ey, r * 0.27, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#16205E';
      ctx.beginPath(); ctx.arc(ex + d.x * r * 0.12, ey + d.y * r * 0.12, r * 0.13, 0, Math.PI * 2); ctx.fill();
    });
  }

  function drawDots() {
    var pulse = 0.55 + 0.45 * Math.abs(Math.sin(clock * 4));
    for (var y = 0; y < ROWS; y++) {
      for (var x = 0; x < COLS; x++) {
        var c = grid[y][x];
        if (c === '.') {
          ctx.fillStyle = '#FFD9A8';
          ctx.beginPath(); ctx.arc(px(x), px(y), 2.4, 0, Math.PI * 2); ctx.fill();
        } else if (c === 'o') {
          ctx.globalAlpha = pulse;
          ctx.fillStyle = '#FFE2B8';
          ctx.beginPath(); ctx.arc(px(x), px(y), 6.5, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
    }
  }

  function banner(title, sub, dim) {
    var W = COLS * T, H = ROWS * T;
    if (dim) { ctx.fillStyle = 'rgba(10, 12, 28, .72)'; ctx.fillRect(0, 0, W, H); }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#FFB45E';
    ctx.font = '800 ' + (dim ? 44 : 22) + 'px "Bricolage Grotesque", system-ui, sans-serif';
    ctx.fillText(title, W / 2, dim ? H / 2 - 18 : px(11));
    if (sub) {
      ctx.fillStyle = '#C9CDEA';
      ctx.font = '500 15px Figtree, system-ui, sans-serif';
      ctx.fillText(sub, W / 2, H / 2 + 26);
    }
  }

  function draw() {
    var W = COLS * T, H = ROWS * T;
    ctx.fillStyle = '#0A0C1C';
    ctx.fillRect(0, 0, W, H);
    var flash = state === 'cleared' && Math.floor(stateT * 5) % 2 === 1;
    ctx.globalAlpha = flash ? 0.35 : 1;
    ctx.drawImage(walls, 0, 0, W, H);
    ctx.globalAlpha = 1;
    drawDots();
    if (state !== 'title') {
      ghosts.forEach(drawGhost);
      drawPlayer();
    }
    if (state === 'title') banner('Chomp', 'Click or tap to play', true);
    else if (state === 'ready') banner('Ready!', '', false);
    else if (state === 'paused') banner('Paused', 'Click, tap or press an arrow key', true);
    else if (state === 'over') banner('Game over', 'Score ' + score + '. Click or tap to play again', true);
  }

  var last = 0;
  function frame(t) {
    var dt = Math.min(0.05, (t - last) / 1000 || 0);
    last = t;
    clock += dt;
    if (visible) { update(dt); draw(); }
    requestAnimationFrame(frame);
  }

  // ---------- input ----------
  function steer(d) {
    if (state === 'title' || state === 'over') { newGame(); player.next = d; return; }
    if (state === 'paused') { setState('play'); }
    player.next = d;
  }

  function active() { return state !== 'title' && state !== 'over'; }

  window.addEventListener('keydown', function (e) {
    var d = KEYS[e.key];
    if (!d || !visible || !armed) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    e.preventDefault();
    steer(d);
  });

  var touch = null;
  canvas.addEventListener('touchstart', function (e) {
    var p = e.changedTouches[0];
    touch = { x: p.clientX, y: p.clientY };
  }, { passive: true });
  canvas.addEventListener('touchend', function (e) {
    if (!touch) return;
    var p = e.changedTouches[0], dx = p.clientX - touch.x, dy = p.clientY - touch.y;
    touch = null;
    armed = true;
    if (Math.abs(dx) < 18 && Math.abs(dy) < 18) {
      if (!active()) newGame();
      else if (state === 'paused') setState('play');
      return;
    }
    steer(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? RIGHT : LEFT) : (dy > 0 ? DOWN : UP));
  });
  canvas.addEventListener('click', function () {
    armed = true;
    if (!active()) newGame();
    else if (state === 'paused') setState('play');
  });

  var pad = document.querySelectorAll('[data-chomp]');
  for (var i = 0; i < pad.length; i++) {
    pad[i].addEventListener('click', function (e) {
      var d = { up: UP, down: DOWN, left: LEFT, right: RIGHT }[e.currentTarget.getAttribute('data-chomp')];
      armed = true;
      if (d) steer(d);
    });
  }

  // pause when the game scrolls out of view or the tab is hidden
  function hide() { if (state === 'play' || state === 'ready') setState('paused'); }
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
      if (!visible) { hide(); draw(); }
    }, { threshold: 0.25 }).observe(canvas);
  }
  document.addEventListener('visibilitychange', function () { if (document.hidden) hide(); });

  // ---------- start ----------
  loadMaze();
  resetPositions();
  renderHud();
  draw();
  requestAnimationFrame(frame);

  // test hook, only with ?chomptest in the address
  if (/chomptest/.test(location.search)) {
    window.__chomp = {
      get state() { return state; }, get score() { return score; }, get lives() { return lives; },
      get dots() { return dotsLeft; }, get player() { return player; }, get ghosts() { return ghosts; },
      start: function () { armed = true; newGame(); }, steer: function (n) { steer({ up: UP, down: DOWN, left: LEFT, right: RIGHT }[n]); },
      frighten: frighten,
      place: function (i, x, y) { var g = ghosts[i]; g.x = g.tx = x; g.y = g.ty = y; g.dir = NONE; g.state = 'active'; },
      leaveOneDot: function () {
        for (var y = 0; y < ROWS; y++) for (var x = 0; x < COLS; x++) if (grid[y][x] === '.' || grid[y][x] === 'o') grid[y][x] = ' ';
        grid[15][8] = '.'; dotsLeft = 1;
      },
      get level() { return level; },
      step: function (sec) { for (var s = 0; s < sec * 60; s++) { clock += 1 / 60; update(1 / 60); } draw(); }
    };
  }
})();
