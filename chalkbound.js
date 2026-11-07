"use strict";

(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d", { alpha: false });
  const W = canvas.width;
  const H = canvas.height;
  const VIEW = { x: 0, y: 22, w: W, h: 172 };
  const ROOM_W = 320;
  const ROOM_H = 220;
  const CELL_X = 420;
  const CELL_Y = 290;
  const MAX_LEVEL = 12;
  const keys = new Set();
  const lights = document.createElement("canvas");
  lights.width = 96;
  lights.height = 43;
  const lightCtx = lights.getContext("2d");

  let state = "title";
  let level = 1;
  let world;
  let player;
  let camera = { x: 0, y: 0 };
  let projectiles = [];
  let runes = [];
  let message = "";
  let messageTime = 0;
  let drawing = false;
  let stroke = [];
  let strokeDistance = 0;
  let shotCooldown = 0;
  let dashCooldown = 0;
  let dashTime = 0;
  let invulnerability = 0;
  let boss = null;
  let clearedTime = 0;
  let lastTime = 0;
  let mouse = { x: W / 2, y: H / 2, down: false };
  let worldSeed = 1;
  let decorSeed = 0;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const rand = (min, max) => min + Math.random() * (max - min);
  const sign = value => value < 0 ? -1 : 1;

  function showMessage(text, time = 1.4) {
    message = text;
    messageTime = time;
  }

  function beginGame() {
    level = 1;
    player = { x: 0, y: 0, hp: 6, chalk: 1, r: 5, faceX: 1, faceY: 0 };
    startLevel(false);
    state = "playing";
  }

  function startLevel(keepChalk = true) {
    const chalk = keepChalk && player ? player.chalk : 1;
    worldSeed = Math.floor(Math.random() * 0x7fffffff);
    decorSeed = worldSeed;
    world = makeDungeon(level, worldSeed);
    projectiles = [];
    runes = [];
    player.x = ROOM_W / 2;
    player.y = ROOM_H / 2;
    player.hp = 6;
    player.chalk = clamp(chalk, 0, 3);
    player.r = 5;
    player.faceX = 1;
    player.faceY = 0;
    boss = {
      x: 2 * CELL_X + ROOM_W / 2,
      y: 2 * CELL_Y + ROOM_H / 2,
      hits: 0,
      required: 3 + Math.floor((level - 1) / 2),
      phase: 1,
      mode: "dormant",
      timer: 0,
      attack: 0,
      pulse: 0,
      contactCooldown: 0
    };
    shotCooldown = 0;
    dashCooldown = 0;
    dashTime = 0;
    invulnerability = 0;
    drawing = false;
    stroke = [];
    strokeDistance = 0;
    camera = { x: 0, y: 0 };
    showMessage(`LEVEL ${level}  /  ${MAX_LEVEL}`, 2);
  }

  function makeDungeon(dungeonLevel, seed) {
    const rng = mulberry32(seed);
    const rooms = [];
    const roomAt = (row, col) => rooms.find(room => room.row === row && room.col === col);
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const room = {
          id: row * 3 + col,
          row,
          col,
          x: col * CELL_X,
          y: row * CELL_Y,
          w: ROOM_W,
          h: ROOM_H,
          doors: new Set(),
          props: [],
          stones: [],
          torches: []
        };
        const local = mulberry32(seed ^ (room.id * 0x9e3779b9));
        for (let i = 0; i < 44; i++) {
          room.stones.push({
            x: room.x + 18 + local() * (ROOM_W - 36),
            y: room.y + 18 + local() * (ROOM_H - 36),
            kind: local()
          });
        }
        room.torches.push({ x: room.x + 24, y: room.y + 25 });
        room.torches.push({ x: room.x + ROOM_W - 24, y: room.y + ROOM_H - 25 });
        rooms.push(room);
      }
    }

    const links = [];
    const connect = (a, b) => {
      if (links.some(link => link.a === a && link.b === b || link.a === b && link.b === a)) return;
      const first = roomAt(Math.floor(a / 3), a % 3);
      const second = roomAt(Math.floor(b / 3), b % 3);
      const side = second.col > first.col ? "E" : second.col < first.col ? "W" : second.row > first.row ? "S" : "N";
      first.doors.add(side);
      second.doors.add(({ E: "W", W: "E", N: "S", S: "N" })[side]);
      links.push({ a, b, side, first, second });
    };

    const visited = new Set([0]);
    function carve(roomId) {
      const row = Math.floor(roomId / 3);
      const col = roomId % 3;
      const neighbors = [];
      if (row > 0) neighbors.push(roomId - 3);
      if (col < 2) neighbors.push(roomId + 1);
      if (row < 2) neighbors.push(roomId + 3);
      if (col > 0) neighbors.push(roomId - 1);
      for (let i = neighbors.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [neighbors[i], neighbors[j]] = [neighbors[j], neighbors[i]];
      }
      for (const next of neighbors) {
        if (next === 8 || visited.has(next)) continue;
        visited.add(next);
        connect(roomId, next);
        carve(next);
      }
    }
    carve(0);
    connect(rng() < 0.5 ? 5 : 7, 8);
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const id = row * 3 + col;
        if (col < 2 && id + 1 !== 8 && rng() < 0.22) connect(id, id + 1);
        if (row < 2 && id + 3 !== 8 && rng() < 0.22) connect(id, id + 3);
      }
    }

    const solids = [];
    for (const room of rooms) {
      const x = room.x;
      const y = room.y;
      const t = 12;
      addWallSide(solids, x, y, ROOM_W, t, room.doors.has("N"), true);
      addWallSide(solids, x, y + ROOM_H - t, ROOM_W, t, room.doors.has("S"), true);
      addWallSide(solids, x, y, ROOM_H, t, room.doors.has("W"), false);
      addWallSide(solids, x + ROOM_W - t, y, ROOM_H, t, room.doors.has("E"), false);
      const propCount = room.id === 8 ? 0 : 2 + Math.floor(rng() * 4) + Math.floor(dungeonLevel / 5);
      for (let i = 0; i < propCount; i++) {
        const kind = rng() < 0.35 ? "pillar" : rng() < 0.68 ? "crate" : "rubble";
        const w = kind === "pillar" ? 16 : kind === "crate" ? 20 : 26;
        const h = kind === "pillar" ? 16 : kind === "crate" ? 18 : 12;
        const px = x + 36 + rng() * (ROOM_W - 72 - w);
        const py = y + 34 + rng() * (ROOM_H - 68 - h);
        const nearDoor = (room.doors.has("E") || room.doors.has("W")) && Math.abs(py + h / 2 - (y + ROOM_H / 2)) < 36;
        const nearVerticalDoor = (room.doors.has("N") || room.doors.has("S")) && Math.abs(px + w / 2 - (x + ROOM_W / 2)) < 36;
        const nearCenter = Math.hypot(px + w / 2 - (x + ROOM_W / 2), py + h / 2 - (y + ROOM_H / 2)) < 38;
        if (nearDoor || nearVerticalDoor || nearCenter) continue;
        const prop = { x: px, y: py, w, h, kind };
        room.props.push(prop);
        if (kind !== "rubble") solids.push({ ...prop, kind: "cover" });
      }
    }

    const corridors = [];
    for (const link of links) {
      if (link.side === "E" || link.side === "W") {
        const left = link.first.col < link.second.col ? link.first : link.second;
        corridors.push({ x: left.x + ROOM_W - 12, y: left.y + ROOM_H / 2 - 27, w: CELL_X - ROOM_W + 24, h: 54 });
      } else {
        const top = link.first.row < link.second.row ? link.first : link.second;
        corridors.push({ x: top.x + ROOM_W / 2 - 27, y: top.y + ROOM_H - 12, w: 54, h: CELL_Y - ROOM_H + 24 });
      }
    }
    const bossLink = links.find(link => link.a === 8 || link.b === 8);
    let gate;
    if (bossLink.side === "E" || bossLink.side === "W") {
      const left = bossLink.first.col < bossLink.second.col ? bossLink.first : bossLink.second;
      gate = { x: left.x + ROOM_W + (CELL_X - ROOM_W) / 2 - 6, y: left.y + ROOM_H / 2 - 27, w: 12, h: 54 };
    } else {
      const top = bossLink.first.row < bossLink.second.row ? bossLink.first : bossLink.second;
      gate = { x: top.x + ROOM_W / 2 - 27, y: top.y + ROOM_H + (CELL_Y - ROOM_H) / 2 - 6, w: 54, h: 12 };
    }

    const enemies = [];
    let enemyId = 0;
    for (const room of rooms.slice(1, 8)) {
      const count = 1 + (dungeonLevel >= 5 && rng() < 0.3 ? 1 : 0) + (dungeonLevel >= 9 && rng() < 0.25 ? 1 : 0);
      for (let i = 0; i < count; i++) {
        const specialChance = Math.min(0.42, 0.11 + (dungeonLevel - 1) * 0.022);
        const special = rng() < specialChance;
        enemies.push({
          id: enemyId++, type: special ? "special" : "skeleton",
          x: room.x + 78 + rng() * (ROOM_W - 156),
          y: room.y + 62 + rng() * (ROOM_H - 124),
          homeX: room.x + ROOM_W / 2, homeY: room.y + ROOM_H / 2,
          hp: special ? 1 : 1,
          speed: (special ? 24 : 20) + dungeonLevel * 1.4,
          attackCooldown: 0,
          hurt: 0,
          burn: 0,
          burnTick: 0,
          frozen: 0,
          phase: rng() * Math.PI * 2,
          alive: true
        });
      }
    }

    const pickups = [];
    let pickupId = 0;
    for (const room of rooms) {
      if (room.id === 8) continue;
      const count = room.id === 0 ? 1 : 1 + (rng() < 0.32 ? 1 : 0);
      for (let i = 0; i < count; i++) {
        pickups.push({ id: pickupId++, x: room.x + 52 + rng() * (ROOM_W - 104), y: room.y + 46 + rng() * (ROOM_H - 92), bob: rng() * 6 });
      }
    }

    return {
      rooms, links, corridors, solids, enemies, pickups, nextEnemyId: enemyId,
      gate,
      worldW: 2 * CELL_X + ROOM_W,
      worldH: 2 * CELL_Y + ROOM_H
    };
  }

  function addWallSide(solids, x, y, length, thickness, hasDoor, horizontal) {
    if (!hasDoor) {
      solids.push({ x, y, w: horizontal ? length : thickness, h: horizontal ? thickness : length, kind: "wall" });
      return;
    }
    const center = length / 2;
    const gap = 48;
    if (horizontal) {
      solids.push({ x, y, w: center - gap / 2, h: thickness, kind: "wall" });
      solids.push({ x: x + center + gap / 2, y, w: length - center - gap / 2, h: thickness, kind: "wall" });
    } else {
      solids.push({ x, y, w: thickness, h: center - gap / 2, kind: "wall" });
      solids.push({ x, y: y + center + gap / 2, w: thickness, h: length - center - gap / 2, kind: "wall" });
    }
  }

  function mulberry32(seed) {
    return function () {
      let value = seed += 0x6D2B79F5;
      value = Math.imul(value ^ value >>> 15, value | 1);
      value ^= value + Math.imul(value ^ value >>> 7, value | 61);
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
  }

  function startDrawing() {
    if (state !== "playing" || drawing) return;
    drawing = true;
    stroke = [{ x: player.x, y: player.y }];
    strokeDistance = 0;
  }

  function finishDrawing() {
    if (!drawing) return;
    drawing = false;
    if (distance(stroke[0], player) > 3) stroke.push({ x: player.x, y: player.y });
    const kind = classifyStroke(stroke);
    if (!kind) {
      showMessage("SHAPE UNCLEAR  /  TRY AGAIN");
      stroke = [];
      return;
    }
    if (player.chalk < 1) {
      showMessage("NO CHALK");
      stroke = [];
      return;
    }
    player.chalk--;
    const points = stroke.map(point => ({ ...point }));
    const center = points.reduce((sum, point) => ({ x: sum.x + point.x / points.length, y: sum.y + point.y / points.length }), { x: 0, y: 0 });
    const glyph = { kind, points, center, life: 0.9, hit: new Set() };
    runes.push(glyph);
    activateGlyph(glyph);
    stroke = [];
  }

  function classifyStroke(points) {
    if (points.length < 5) return null;
    let total = 0;
    for (let i = 1; i < points.length; i++) total += distance(points[i - 1], points[i]);
    if (total < 66) return null;
    const closed = distance(points[0], points[points.length - 1]) < Math.max(25, total * 0.22);
    const corners = [];
    let prior = points[0];
    let previousDir = null;
    for (let i = 1; i < points.length; i++) {
      const dx = points[i].x - prior.x;
      const dy = points[i].y - prior.y;
      const segmentLength = Math.hypot(dx, dy);
      if (segmentLength < 2) {
        prior = points[i];
        continue;
      }
      const dir = { x: dx / segmentLength, y: dy / segmentLength };
      if (previousDir && previousDir.x * dir.x + previousDir.y * dir.y < 0.56) {
        corners.push(points[i - 1]);
        prior = points[i - 1];
        previousDir = null;
        i--;
        continue;
      }
      previousDir = dir;
      prior = points[i];
    }
    if (closed) {
      const count = corners.length + 1;
      if (count === 3 && polygonIsBalanced(points, 3)) return "fire";
      if (count === 4 && polygonIsBalanced(points, 4)) return "ice";
      return null;
    }
    if (corners.length >= 2 && alternatingStroke(points)) return "lightning";
    return null;
  }

  function polygonIsBalanced(points, sides) {
    const sample = [];
    const stride = Math.max(1, Math.floor((points.length - 1) / sides));
    for (let i = 0; i < points.length - 1; i += stride) sample.push(points[i]);
    if (sample.length < sides) return false;
    const lengths = [];
    for (let i = 0; i < sample.length; i++) lengths.push(distance(sample[i], sample[(i + 1) % sample.length]));
    const valid = lengths.filter(length => length > 14);
    if (valid.length < sides) return false;
    return Math.max(...valid) / Math.min(...valid) < 3.4;
  }

  function alternatingStroke(points) {
    const turns = [];
    let last = points[0];
    let dir = null;
    for (let i = 1; i < points.length; i++) {
      const dx = points[i].x - last.x;
      const dy = points[i].y - last.y;
      const magnitude = Math.hypot(dx, dy);
      if (magnitude < 9) continue;
      const next = { x: dx / magnitude, y: dy / magnitude };
      if (dir && dir.x * next.x + dir.y * next.y < 0.4) turns.push(Math.sign(dir.x * next.y - dir.y * next.x));
      dir = next;
      last = points[i];
    }
    if (turns.length < 2) return false;
    let alternations = 0;
    for (let i = 1; i < turns.length; i++) if (turns[i] !== turns[i - 1]) alternations++;
    return alternations >= 1;
  }

  function activateGlyph(glyph) {
    const radius = glyph.kind === "fire" ? 59 : glyph.kind === "ice" ? 66 : 74;
    for (const enemy of world.enemies) {
      if (!enemy.alive || distance(enemy, glyph.center) > radius) continue;
      hurtEnemy(enemy);
      glyph.hit.add(enemy.id);
      if (glyph.kind === "ice") enemy.frozen = 1.8;
      if (glyph.kind === "fire" && enemy.alive) {
        enemy.burn = 1.4;
        enemy.burnTick = 0.35;
      }
    }
    if (boss && boss.mode !== "dormant" && boss.hits < boss.required && distance(boss, glyph.center) < 86) {
      if (boss.mode === "open") {
        boss.hits++;
        boss.pulse = 0.65;
        boss.phase = Math.min(3, 1 + Math.floor(boss.hits * 3 / boss.required));
        showMessage(`RUNE STRIKE  ${boss.hits} / ${boss.required}`, 1.8);
        if (boss.hits >= boss.required) {
          boss.mode = "defeated";
          clearedTime = 2.2;
          showMessage("THE WARDEN FALLS", 2.2);
        }
      } else {
        showMessage("BOSS GUARDED  /  WAIT FOR THE CHALK", 1.5);
      }
    }
  }

  function hurtEnemy(enemy) {
    enemy.hp--;
    enemy.hurt = 0.2;
    if (enemy.hp <= 0) enemy.alive = false;
  }

  function update(dt) {
    if (messageTime > 0) messageTime -= dt;
    if (state !== "playing") {
      if (state === "cleared") {
        clearedTime -= dt;
        if (clearedTime <= 0) {
          if (level >= MAX_LEVEL) state = "victory";
          else {
            level++;
            startLevel(true);
            state = "playing";
          }
        }
      }
      return;
    }

    shotCooldown = Math.max(0, shotCooldown - dt);
    dashCooldown = Math.max(0, dashCooldown - dt);
    dashTime = Math.max(0, dashTime - dt);
    invulnerability = Math.max(0, invulnerability - dt);
    for (const rune of runes) rune.life -= dt;
    runes = runes.filter(rune => rune.life > 0);

    let dx = (keys.has("d") ? 1 : 0) - (keys.has("a") ? 1 : 0);
    let dy = (keys.has("s") ? 1 : 0) - (keys.has("w") ? 1 : 0);
    const magnitude = Math.hypot(dx, dy);
    if (magnitude > 0) {
      dx /= magnitude;
      dy /= magnitude;
      player.faceX = dx;
      player.faceY = dy;
    }
    if (dashTime > 0 && player.dashX !== undefined) {
      dx = player.dashX;
      dy = player.dashY;
    }
    const speed = dashTime > 0 ? 235 : 72;
    moveEntity(player, dx * speed * dt, dy * speed * dt);
    if (drawing && magnitude > 0) recordStroke();

    if (keys.has(" ") && dashCooldown <= 0) {
      let dashX = magnitude ? dx : player.faceX;
      let dashY = magnitude ? dy : player.faceY;
      const length = Math.hypot(dashX, dashY) || 1;
      player.dashX = dashX / length;
      player.dashY = dashY / length;
      dashTime = 0.17;
      dashCooldown = 1.35;
      invulnerability = Math.max(invulnerability, 0.28);
      keys.delete(" ");
    }

    if (mouse.down && !drawing && shotCooldown <= 0) fireWand();
    updateEnemies(dt);
    updateProjectiles(dt);
    updatePickups();
    updateBoss(dt);
    camera.x = clamp(player.x - W / 2, 0, world.worldW - W);
    camera.y = clamp(player.y - VIEW.h / 2, 0, world.worldH - VIEW.h);
  }

  function recordStroke() {
    const last = stroke[stroke.length - 1];
    const step = distance(last, player);
    strokeDistance += step;
    if (step >= 7) stroke.push({ x: player.x, y: player.y });
  }

  function moveEntity(entity, mx, my) {
    const gateClosed = world.enemies.some(enemy => enemy.alive);
    const solids = gateClosed ? [...world.solids, world.gate] : world.solids;
    if (mx) {
      entity.x += mx;
      if (solids.some(rect => circleRect(entity.x, entity.y, entity.r || 4, rect))) entity.x -= mx;
    }
    if (my) {
      entity.y += my;
      if (solids.some(rect => circleRect(entity.x, entity.y, entity.r || 4, rect))) entity.y -= my;
    }
  }

  function circleRect(cx, cy, radius, rect) {
    const nx = clamp(cx, rect.x, rect.x + rect.w);
    const ny = clamp(cy, rect.y, rect.y + rect.h);
    return (cx - nx) ** 2 + (cy - ny) ** 2 < radius ** 2;
  }

  function fireWand() {
    const target = { x: camera.x + mouse.x, y: camera.y + mouse.y - VIEW.y };
    let dx = target.x - player.x;
    let dy = target.y - player.y;
    const length = Math.hypot(dx, dy) || 1;
    dx /= length;
    dy /= length;
    projectiles.push({ x: player.x + dx * 8, y: player.y + dy * 8, vx: dx * 156, vy: dy * 156, r: 2, life: 1.1 });
    shotCooldown = 0.32;
  }

  function updateEnemies(dt) {
    for (const enemy of world.enemies) {
      if (!enemy.alive) continue;
      enemy.hurt = Math.max(0, enemy.hurt - dt);
      enemy.attackCooldown = Math.max(0, enemy.attackCooldown - dt);
      enemy.phase += dt * 7;
      if (enemy.burn > 0) {
        enemy.burn -= dt;
        enemy.burnTick -= dt;
        if (enemy.burnTick <= 0 && enemy.alive) {
          enemy.burnTick = 0.4;
          hurtEnemy(enemy);
        }
      }
      enemy.frozen = Math.max(0, enemy.frozen - dt);
      const dist = distance(enemy, player);
      if (dist < 150 && enemy.frozen <= 0) {
        const mx = (player.x - enemy.x) / (dist || 1);
        const my = (player.y - enemy.y) / (dist || 1);
        moveEntity(enemy, mx * enemy.speed * dt, my * enemy.speed * dt);
      }
      if (dist < (enemy.type === "special" ? 13 : 11) && enemy.attackCooldown <= 0) {
        damagePlayer(enemy.type === "special" ? 2 : 1);
        enemy.attackCooldown = 0.9;
      }
    }
  }

  function updateProjectiles(dt) {
    for (const shot of projectiles) {
      shot.x += shot.vx * dt;
      shot.y += shot.vy * dt;
      shot.life -= dt;
      if (world.solids.some(rect => circleRect(shot.x, shot.y, shot.r, rect))) shot.life = 0;
      if (shot.hostile && shot.life > 0 && distance(shot, player) < shot.r + player.r) {
        damagePlayer(2);
        shot.life = 0;
        continue;
      }
      for (const enemy of world.enemies) {
        if (!enemy.alive || enemy.type !== "skeleton") continue;
        if (distance(shot, enemy) < shot.r + 5) {
          hurtEnemy(enemy);
          shot.life = 0;
          break;
        }
      }
    }
    projectiles = projectiles.filter(shot => shot.life > 0);
  }

  function updatePickups() {
    for (const pickup of world.pickups) {
      if (pickup.taken || player.chalk >= 3) continue;
      if (distance(player, pickup) < 11) {
        pickup.taken = true;
        player.chalk++;
        showMessage("CHALK +1", 1.1);
      }
    }
  }

  function updateBoss(dt) {
    if (!boss || boss.mode === "defeated") return;
    if (boss.mode === "dormant") {
      if (!world.enemies.some(enemy => enemy.alive) && player.x > 2 * CELL_X && player.y > 2 * CELL_Y) {
        boss.mode = "telegraph";
        boss.timer = 1.4;
        showMessage("THE WARDEN AWAKENS", 2);
      }
      return;
    }
    boss.contactCooldown = Math.max(0, boss.contactCooldown - dt);
    if (distance(boss, player) < 18 && boss.contactCooldown <= 0) {
      damagePlayer(2);
      boss.contactCooldown = 1;
    }
    boss.pulse = Math.max(0, boss.pulse - dt);
    boss.timer -= dt;
    if (boss.mode === "telegraph" && boss.timer <= 0) {
      boss.mode = "attack";
      boss.timer = 1.35;
      boss.attack = (boss.attack + 1) % 3;
      fireBossPattern();
    } else if (boss.mode === "attack" && boss.timer <= 0) {
      boss.mode = "open";
      boss.timer = 4.8;
      dropBossChalk();
      showMessage("WARDEN EXPOSED  /  DRAW A RUNE", 2);
    } else if (boss.mode === "open" && boss.timer <= 0) {
      boss.phase = boss.phase % 3 + 1;
      boss.mode = "telegraph";
      boss.timer = 1.5;
    }
  }

  function fireBossPattern() {
    const pattern = boss.phase - 1;
    const baseAngle = Math.atan2(player.y - boss.y, player.x - boss.x);
    const count = pattern === 0 ? 7 : pattern === 1 ? 3 : 6;
    for (let i = 0; i < count; i++) {
      let angle;
      if (pattern === 0) angle = baseAngle + (i - (count - 1) / 2) * 0.42;
      else if (pattern === 1) angle = baseAngle + (i - 1) * 0.24;
      else angle = (Math.PI * 2 * i / count) + baseAngle * 0.2;
      const speed = pattern === 1 ? 89 : 68;
      projectiles.push({ x: boss.x, y: boss.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, r: 3, life: 2.7, hostile: true });
    }
  }

  function dropBossChalk() {
    const needed = boss.required - boss.hits;
    const count = Math.min(3, Math.max(1, needed), Math.max(1, 3 - player.chalk));
    for (let i = 0; i < count; i++) {
      const angle = Math.PI * 2 * (i / count) + rand(-0.2, 0.2);
      const radius = 62 + (i % 2) * 26;
      world.pickups.push({ id: 1000 + boss.hits * 4 + i, x: boss.x + Math.cos(angle) * radius, y: boss.y + Math.sin(angle) * radius, bob: rand(0, 6) });
    }
  }

  function damagePlayer(halfHearts) {
    if (invulnerability > 0 || state !== "playing") return;
    player.hp = Math.max(0, player.hp - halfHearts);
    invulnerability = 0.95;
    if (player.hp <= 0) {
      state = "gameover";
      drawing = false;
    }
  }

  function draw() {
    ctx.fillStyle = "#050607";
    ctx.fillRect(0, 0, W, H);
    if (state === "title") return drawTitle();
    if (state === "gameover") return drawEndScreen("GAME OVER", "THE DUNGEON CLAIMS YOU", "PRESS ENTER TO DESCEND AGAIN");
    if (state === "victory") return drawEndScreen("VICTORY", "THE TWELFTH WARD IS BROKEN", "THE CHALK HOLDS");
    drawWorld();
    drawLighting();
    drawHud();
    if (state === "paused") drawOverlay("PAUSED", "PRESS ESC OR P TO RETURN");
    if (state === "cleared") drawOverlay(level >= MAX_LEVEL ? "WARDEN DEFEATED" : "LEVEL CLEARED", "THE DUNGEON SHIFTS");
  }

  function drawWorld() {
    ctx.save();
    ctx.beginPath();
    ctx.rect(VIEW.x, VIEW.y, VIEW.w, VIEW.h);
    ctx.clip();
    for (const room of world.rooms) drawRoom(room);
    for (const corridor of world.corridors) {
      ctx.fillStyle = "#17191a";
      ctx.fillRect(px(corridor.x), py(corridor.y), corridor.w, corridor.h);
      ctx.strokeStyle = "#252728";
      ctx.lineWidth = 2;
      ctx.strokeRect(px(corridor.x), py(corridor.y), corridor.w, corridor.h);
    }
    for (const room of world.rooms) drawRoomDetails(room);
    drawGate();
    for (const pickup of world.pickups) if (!pickup.taken) drawPickup(pickup);
    for (const rune of runes) drawRune(rune);
    for (const shot of projectiles) drawProjectile(shot);
    for (const enemy of world.enemies) if (enemy.alive) drawEnemy(enemy);
    if (boss && boss.mode !== "dormant" && boss.mode !== "defeated") drawBoss();
    drawPlayer();
    if (drawing && stroke.length > 1) drawTrace(stroke, "#eeeeee", 0.8);
    ctx.restore();
  }

  function drawRoom(room) {
    const x = px(room.x);
    const y = py(room.y);
    ctx.fillStyle = "#111314";
    ctx.fillRect(x, y, room.w, room.h);
    ctx.fillStyle = "#1a1c1d";
    for (const stone of room.stones) {
      const sx = px(stone.x);
      const sy = py(stone.y);
      ctx.fillRect(sx, sy, stone.kind < 0.5 ? 2 : 1, 1);
      if (stone.kind > 0.83) {
        ctx.fillStyle = "#222425";
        ctx.fillRect(sx + 2, sy + 3, 4, 1);
        ctx.fillStyle = "#1a1c1d";
      }
    }
    ctx.fillStyle = "#292b2c";
    for (const solid of world.solids) {
      if (solid.kind !== "wall" || solid.x < room.x - 1 || solid.x > room.x + room.w || solid.y < room.y - 1 || solid.y > room.y + room.h) continue;
      ctx.fillRect(px(solid.x), py(solid.y), solid.w, solid.h);
      ctx.fillStyle = "#3a3b3b";
      ctx.fillRect(px(solid.x), py(solid.y), solid.w, Math.min(2, solid.h));
      ctx.fillStyle = "#292b2c";
    }
  }

  function drawRoomDetails(room) {
    for (const prop of room.props) {
      const x = px(prop.x);
      const y = py(prop.y);
      if (prop.kind === "pillar") {
        ctx.fillStyle = "#090a0a";
        ctx.fillRect(x - 2, y + 3, prop.w + 4, prop.h);
        ctx.fillStyle = "#484746";
        ctx.fillRect(x + 2, y, prop.w - 4, prop.h);
        ctx.fillStyle = "#68635a";
        ctx.fillRect(x + 4, y + 2, prop.w - 9, 3);
      } else if (prop.kind === "crate") {
        ctx.fillStyle = "#252321";
        ctx.fillRect(x, y, prop.w, prop.h);
        ctx.fillStyle = "#555149";
        ctx.fillRect(x + 2, y + 2, prop.w - 4, 2);
        ctx.fillRect(x + prop.w / 2 - 1, y + 3, 2, prop.h - 6);
        ctx.fillStyle = "#111211";
        ctx.fillRect(x + 2, y + prop.h - 3, prop.w - 4, 2);
      } else {
        ctx.fillStyle = "#30302f";
        ctx.fillRect(x, y + 4, prop.w, prop.h - 4);
        ctx.fillStyle = "#4a4946";
        ctx.fillRect(x + 3, y, prop.w - 8, 5);
      }
    }
    for (const torch of room.torches) drawTorch(torch);
    if (room.id === 8) {
      const center = { x: room.x + ROOM_W / 2, y: room.y + ROOM_H / 2 };
      ctx.strokeStyle = "#30302c";
      ctx.lineWidth = 1;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(px(center.x), py(center.y), 30 + i * 10, 0, Math.PI * 2);
        ctx.stroke();
      }
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4;
        ctx.fillStyle = "#40403a";
        ctx.fillRect(px(center.x + Math.cos(a) * 48), py(center.y + Math.sin(a) * 48), 3, 3);
      }
    }
  }

  function drawTorch(torch) {
    const x = px(torch.x);
    const y = py(torch.y);
    ctx.fillStyle = "#62605a";
    ctx.fillRect(x - 2, y, 4, 7);
    ctx.fillStyle = "#ded7be";
    ctx.fillRect(x - 1, y - 4, 2, 4);
    ctx.fillStyle = "#a99d78";
    ctx.fillRect(x, y - 6, 1, 2);
  }

  function drawGate() {
    if (!world.enemies.some(enemy => enemy.alive)) return;
    const gate = world.gate;
    const x = px(gate.x);
    const y = py(gate.y);
    ctx.fillStyle = "#6e6c63";
    ctx.fillRect(x, y, gate.w, gate.h);
    ctx.fillStyle = "#131414";
    for (let i = 3; i < gate.h; i += 8) ctx.fillRect(x - 3, y + i, gate.w + 6, 2);
  }

  function drawPickup(pickup) {
    const x = px(pickup.x);
    const y = py(pickup.y + Math.sin(performance.now() / 210 + pickup.bob) * 2);
    ctx.fillStyle = "#050505";
    ctx.fillRect(x - 4, y - 4, 9, 9);
    ctx.fillStyle = "#e8e8df";
    ctx.fillRect(x - 2, y - 3, 5, 7);
    ctx.fillStyle = "#777872";
    ctx.fillRect(x - 1, y - 1, 3, 3);
  }

  function drawPlayer() {
    const x = px(player.x);
    const y = py(player.y);
    if (invulnerability > 0 && Math.floor(performance.now() / 85) % 2 === 0) return;
    const bob = keys.has("w") || keys.has("a") || keys.has("s") || keys.has("d") ? Math.sin(performance.now() / 60) : 0;
    ctx.fillStyle = "#050606";
    ctx.fillRect(x - 5, y + 2 + bob, 11, 6);
    ctx.fillStyle = "#626765";
    ctx.fillRect(x - 4, y - 1 + bob, 8, 8);
    ctx.fillStyle = "#95958b";
    ctx.fillRect(x - 3, y - 5 + bob, 6, 5);
    ctx.fillStyle = "#171818";
    ctx.fillRect(x - 2, y - 3 + bob, 1, 1);
    ctx.fillRect(x + 2, y - 3 + bob, 1, 1);
    ctx.fillStyle = "#deded2";
    ctx.fillRect(x + (player.faceX >= 0 ? 4 : -5), y - 1 + bob, 4, 2);
    ctx.fillStyle = "#b4b2a7";
    ctx.fillRect(x - 4, y + 7, 3, 2);
    ctx.fillRect(x + 2, y + 7, 3, 2);
  }

  function drawEnemy(enemy) {
    const x = px(enemy.x);
    const y = py(enemy.y);
    const bob = Math.sin(enemy.phase) * 1.2;
    if (enemy.hurt > 0) ctx.fillStyle = "#f2eee0";
    else ctx.fillStyle = enemy.type === "special" ? "#685949" : "#77766d";
    ctx.fillRect(x - 4, y - 1 + bob, 8, 8);
    ctx.fillStyle = enemy.type === "special" ? "#a68a62" : "#aaa89c";
    ctx.fillRect(x - 3, y - 5 + bob, 6, 5);
    ctx.fillStyle = enemy.type === "special" ? "#eee1bc" : "#292929";
    ctx.fillRect(x - 2, y - 3 + bob, 1, 1);
    ctx.fillRect(x + 1, y - 3 + bob, 1, 1);
    ctx.fillStyle = enemy.type === "special" ? "#473424" : "#4b4945";
    ctx.fillRect(x - 4, y + 6, 3, 3);
    ctx.fillRect(x + 1, y + 6, 3, 3);
    if (enemy.type === "special") {
      ctx.fillStyle = "#d2c19b";
      ctx.fillRect(x - 6, y - 6 + bob, 2, 3);
      ctx.fillRect(x + 4, y - 6 + bob, 2, 3);
    }
    if (enemy.burn > 0) {
      ctx.fillStyle = "#ddd0ae";
      ctx.fillRect(x - 1, y - 10 + Math.floor(performance.now() / 100) % 2, 2, 3);
    }
  }

  function drawBoss() {
    const x = px(boss.x);
    const y = py(boss.y);
    const pulse = boss.pulse > 0 || boss.mode === "open";
    const bob = Math.sin(performance.now() / 210) * 1.5;
    ctx.fillStyle = pulse ? "#8c8778" : "#4c4a45";
    ctx.fillRect(x - 12, y - 8 + bob, 24, 21);
    ctx.fillStyle = pulse ? "#b3ad9c" : "#77746b";
    ctx.fillRect(x - 9, y - 15 + bob, 18, 10);
    ctx.fillStyle = "#171716";
    ctx.fillRect(x - 6, y - 12 + bob, 3, 3);
    ctx.fillRect(x + 3, y - 12 + bob, 3, 3);
    ctx.fillStyle = pulse ? "#e8e3d3" : "#b5a981";
    ctx.fillRect(x - 5, y - 11 + bob, 1, 1);
    ctx.fillRect(x + 4, y - 11 + bob, 1, 1);
    ctx.fillStyle = "#777268";
    ctx.fillRect(x - 15, y - 9 + bob, 4, 3);
    ctx.fillRect(x + 11, y - 9 + bob, 4, 3);
    ctx.fillStyle = "#282724";
    ctx.fillRect(x - 10, y + 12 + bob, 6, 5);
    ctx.fillRect(x + 4, y + 12 + bob, 6, 5);
    if (boss.mode === "telegraph") {
      ctx.strokeStyle = "#d8d5ca";
      ctx.strokeRect(x - 19, y - 21, 38, 42);
    }
  }

  function drawProjectile(shot) {
    const x = px(shot.x);
    const y = py(shot.y);
    ctx.fillStyle = shot.hostile ? "#c2b9a2" : "#f1f0e7";
    ctx.fillRect(x - shot.r, y - shot.r, shot.r * 2 + 1, shot.r * 2 + 1);
    ctx.fillStyle = "#fff";
    ctx.fillRect(x - 1, y - 1, 2, 2);
  }

  function drawRune(rune) {
    const alpha = clamp(rune.life / 0.9, 0, 1);
    ctx.globalAlpha = alpha;
    const color = rune.kind === "ice" ? "#cbd7d6" : rune.kind === "fire" ? "#d2bda0" : "#d6d6d0";
    drawTrace(rune.points, color, 1);
    ctx.fillStyle = color;
    const x = px(rune.center.x);
    const y = py(rune.center.y);
    ctx.fillRect(x - 2, y - 2, 5, 5);
    ctx.globalAlpha = 1;
  }

  function drawTrace(points, color, alpha) {
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineCap = "square";
    ctx.beginPath();
    ctx.moveTo(px(points[0].x), py(points[0].y));
    for (let i = 1; i < points.length; i++) ctx.lineTo(px(points[i].x), py(points[i].y));
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawLighting() {
    lightCtx.clearRect(0, 0, lights.width, lights.height);
    lightCtx.fillStyle = "rgba(0,0,0,0.84)";
    lightCtx.fillRect(0, 0, lights.width, lights.height);
    lightCtx.globalCompositeOperation = "destination-out";
    lightCtx.globalAlpha = 0.92;
    const sources = [{ x: player.x, y: player.y, radius: 25 }];
    for (const room of world.rooms) {
      for (const torch of room.torches) sources.push({ ...torch, radius: 16 });
    }
    for (const enemy of world.enemies) if (enemy.alive && distance(enemy, player) < 180) sources.push({ x: enemy.x, y: enemy.y, radius: 10 });
    if (boss && boss.mode !== "dormant" && boss.mode !== "defeated") sources.push({ x: boss.x, y: boss.y, radius: 21 });
    for (const source of sources) {
      const sx = (source.x - camera.x) / 4;
      const sy = (source.y - camera.y) / 4;
      for (const band of [[source.radius * 0.42, 0.48], [source.radius * 0.72, 0.3], [source.radius, 0.17]]) {
        lightCtx.globalAlpha = band[1];
        lightCtx.beginPath();
        lightCtx.arc(sx, sy, band[0], 0, Math.PI * 2);
        lightCtx.fill();
      }
    }
    lightCtx.globalAlpha = 1;
    lightCtx.globalCompositeOperation = "source-over";
    ctx.drawImage(lights, VIEW.x, VIEW.y, VIEW.w, VIEW.h);
  }

  function drawHud() {
    ctx.fillStyle = "#050505";
    ctx.fillRect(0, 0, W, 22);
    ctx.strokeStyle = "#e5e5dc";
    ctx.lineWidth = 1;
    ctx.strokeRect(2.5, 2.5, W - 5, 17);
    pixelText(`LEVEL ${level} / ${MAX_LEVEL}`, 8, 14, 8, "left");
    for (let i = 0; i < 3; i++) drawHeart(104 + i * 13, 7, player.hp - i * 2);
    pixelText("CHALK", 293, 14, 7, "left");
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = "#f0f0e8";
      ctx.strokeRect(332 + i * 12.5, 7, 7, 8);
      if (player.chalk > i) {
        ctx.fillStyle = "#f0f0e8";
        ctx.fillRect(334 + i * 12.5, 9, 3, 4);
      }
    }
    ctx.fillStyle = "#030303";
    ctx.fillRect(0, 194, W, 22);
    if (boss && boss.mode !== "dormant") {
      pixelText(`WARDEN  ${boss.hits}/${boss.required}  PHASE ${Math.min(3, boss.phase)}/3`, W / 2, 203, 7, "center");
      ctx.strokeStyle = "#f0f0e8";
      ctx.strokeRect(128, 207, 128, 5);
      ctx.fillStyle = "#f0f0e8";
      ctx.fillRect(130, 209, Math.floor(124 * (1 - boss.hits / boss.required)), 1);
    } else {
      const choices = ["ZIG-ZAG = LIGHTNING", "DIAMOND = ICE", "TRIANGLE = FIRE"];
      pixelText(choices[Math.floor(performance.now() / 2600) % choices.length], W / 2, 207, 7, "center");
    }
    if (messageTime > 0 && message) {
      ctx.fillStyle = "#000";
      ctx.fillRect(70, 27, 244, 13);
      pixelText(message, W / 2, 36, 7, "center");
    }
    if (boss && boss.mode === "dormant" && !world.enemies.some(enemy => enemy.alive)) {
      pixelText("THE WARDEN WAITS BELOW", W / 2, 31, 7, "center");
    }
  }

  function drawHeart(x, y, halfHearts) {
    const pattern = ["0110", "1111", "1111", "0110", "0010"];
    for (let row = 0; row < pattern.length; row++) {
      for (let col = 0; col < pattern[row].length; col++) {
        if (pattern[row][col] !== "1") continue;
        const filled = halfHearts >= 2 || halfHearts === 1 && col < 2;
        ctx.fillStyle = filled ? "#f0f0e8" : "#050505";
        ctx.fillRect(x + col, y + row, 1, 1);
      }
    }
    ctx.strokeStyle = "#f0f0e8";
    ctx.strokeRect(x - 0.5, y - 0.5, 5, 6);
  }

  function pixelText(text, x, y, size = 8, align = "left") {
    ctx.fillStyle = "#f0f0e8";
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.font = `bold ${size}px "Courier New", monospace`;
    ctx.fillText(text, x, y);
  }

  function drawTitle() {
    drawBackdrop();
    ctx.fillStyle = "#090a0a";
    ctx.fillRect(25, 16, 334, 184);
    ctx.strokeStyle = "#eee";
    ctx.strokeRect(27.5, 18.5, 329, 179);
    drawTitleArt();
    pixelText("CHALKBOUND", W / 2, 65, 20, "center");
    pixelText("THE WARDS ARE BROKEN. THE CHALK REMAINS.", W / 2, 83, 6, "center");
    ctx.strokeStyle = "#d6d6cc";
    ctx.beginPath();
    ctx.moveTo(98, 94);
    ctx.lineTo(286, 94);
    ctx.stroke();
    pixelText("WASD MOVE   SPACE DASH   CLICK WAND", W / 2, 109, 7, "center");
    pixelText("HOLD C + WASD TO DRAW   ESC / P PAUSE", W / 2, 122, 7, "center");
    pixelText("ZIG-ZAG: LIGHTNING   DIAMOND: ICE", W / 2, 140, 7, "center");
    pixelText("TRIANGLE: FIRE   RUNE HITS COST 1 CHALK", W / 2, 152, 7, "center");
    ctx.fillStyle = "#f0f0e8";
    ctx.fillRect(130, 169, 124, 15);
    ctx.fillStyle = "#050505";
    ctx.fillRect(132, 171, 120, 11);
    pixelText("ENTER TO DESCEND", W / 2, 176, 7, "center");
    pixelText("12 DUNGEONS  /  3 HEARTS  /  3 CHALK", W / 2, 191, 6, "center");
  }

  function drawBackdrop() {
    ctx.fillStyle = "#101212";
    ctx.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += 16) {
      for (let x = (y / 16 % 2) * 8; x < W; x += 16) {
        ctx.fillStyle = "#151717";
        ctx.fillRect(x, y, 15, 15);
        ctx.fillStyle = "#1b1d1d";
        ctx.fillRect(x + 1, y + 1, 13, 1);
      }
    }
  }

  function drawTitleArt() {
    const cx = W / 2;
    const cy = 42;
    ctx.fillStyle = "#3b3c39";
    ctx.fillRect(cx - 6, cy - 9, 12, 14);
    ctx.fillStyle = "#8d8c83";
    ctx.fillRect(cx - 4, cy - 13, 8, 6);
    ctx.fillStyle = "#171817";
    ctx.fillRect(cx - 2, cy - 11, 1, 1);
    ctx.fillRect(cx + 2, cy - 11, 1, 1);
    ctx.fillStyle = "#dad8cd";
    ctx.fillRect(cx + 6, cy - 8, 14, 2);
    ctx.fillRect(cx + 18, cy - 10, 2, 3);
    ctx.fillStyle = "#55534c";
    ctx.fillRect(cx - 11, cy + 6, 22, 3);
    ctx.strokeStyle = "#d0cfc6";
    ctx.beginPath();
    ctx.moveTo(cx - 28, cy + 1);
    ctx.lineTo(cx - 22, cy - 6);
    ctx.lineTo(cx - 16, cy + 1);
    ctx.lineTo(cx - 10, cy - 6);
    ctx.stroke();
    ctx.strokeRect(cx + 22.5, cy - 6.5, 12, 12);
    ctx.beginPath();
    ctx.moveTo(cx + 28, cy - 6);
    ctx.lineTo(cx + 34, cy);
    ctx.lineTo(cx + 28, cy + 6);
    ctx.lineTo(cx + 22, cy);
    ctx.closePath();
    ctx.stroke();
  }

  function drawOverlay(title, subtitle) {
    ctx.fillStyle = "rgba(0,0,0,0.78)";
    ctx.fillRect(0, 22, W, 172);
    ctx.strokeStyle = "#f0f0e8";
    ctx.strokeRect(75.5, 78.5, 233, 57);
    pixelText(title, W / 2, 98, 13, "center");
    pixelText(subtitle, W / 2, 119, 7, "center");
  }

  function drawEndScreen(title, subtitle, prompt) {
    drawBackdrop();
    ctx.strokeStyle = "#f0f0e8";
    ctx.strokeRect(43.5, 41.5, 297, 133);
    pixelText(title, W / 2, 77, 18, "center");
    pixelText(subtitle, W / 2, 103, 7, "center");
    pixelText(prompt, W / 2, 131, 7, "center");
  }

  function px(x) { return Math.round(x - camera.x); }
  function py(y) { return Math.round(y - camera.y + VIEW.y); }

  function onPointerMove(event) {
    const rect = canvas.getBoundingClientRect();
    mouse.x = (event.clientX - rect.left) * W / rect.width;
    mouse.y = (event.clientY - rect.top) * H / rect.height;
  }

  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerdown", event => {
    canvas.focus();
    onPointerMove(event);
    if (state === "title" || state === "gameover") {
      beginGame();
      return;
    }
    if (state === "playing") mouse.down = true;
  });
  window.addEventListener("pointerup", () => { mouse.down = false; });
  window.addEventListener("keydown", event => {
    const key = event.key.toLowerCase();
    if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) event.preventDefault();
    if (key === "escape" || key === "p") {
      if (state === "playing") {
        state = "paused";
        mouse.down = false;
        drawing = false;
      } else if (state === "paused") state = "playing";
      return;
    }
    if ((state === "title" || state === "gameover") && (key === "enter" || key === " ")) {
      beginGame();
      return;
    }
    if (state !== "playing") return;
    if (key === "c" && !event.repeat) startDrawing();
    if (key === " ") keys.add(" ");
    if (["w", "a", "s", "d"].includes(key)) keys.add(key);
  });
  window.addEventListener("keyup", event => {
    const key = event.key.toLowerCase();
    keys.delete(key);
    if (key === "c") finishDrawing();
  });
  window.addEventListener("blur", () => {
    keys.clear();
    mouse.down = false;
    if (drawing) finishDrawing();
  });

  function frame(time) {
    const dt = lastTime ? Math.min(0.04, (time - lastTime) / 1000) : 0;
    lastTime = time;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})();