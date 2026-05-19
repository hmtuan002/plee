"use strict";
// ═══════════════════════════════════════════════════════════════
//  VVSS FPS — Raycasting 3D multiplayer shooter
//  Engine: Software raycaster (Wolfenstein-style) on <canvas>
//  Network: Firebase Realtime Database (same project as original)
// ═══════════════════════════════════════════════════════════════

// ─── MAP ──────────────────────────────────────────────────────
// 0 = open, 1-4 = wall types
const MAP_W = 16, MAP_H = 16;
const MAP = [
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,0,0,2,2,0,0,0,0,3,3,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,2,0,0,0,0,0,0,0,0,0,0,2,0,1],
  [1,0,2,0,0,0,0,0,0,0,0,0,0,2,0,1],
  [1,0,0,0,0,0,4,4,4,0,0,0,0,0,0,1],
  [1,0,0,0,0,0,4,0,4,0,0,0,0,0,0,1],
  [1,0,0,0,0,0,4,4,4,0,0,0,0,0,0,1],
  [1,0,3,0,0,0,0,0,0,0,0,0,0,3,0,1],
  [1,0,3,0,0,0,0,0,0,0,0,0,0,3,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,0,0,2,0,0,0,0,0,0,2,0,0,0,1],
  [1,0,0,0,2,0,0,0,0,0,0,2,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
];

function mapAt(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  if (xi < 0 || xi >= MAP_W || yi < 0 || yi >= MAP_H) return 1;
  return MAP[yi][xi];
}

// Spawn spots (open cells)
const SPAWN_SPOTS = [];
for (let y = 1; y < MAP_H-1; y++)
  for (let x = 1; x < MAP_W-1; x++)
    if (MAP[y][x] === 0) SPAWN_SPOTS.push({x: x+0.5, y: y+0.5});

function randomSpawn() {
  return SPAWN_SPOTS[Math.floor(Math.random() * SPAWN_SPOTS.length)];
}

// ─── PLAYER STATE ─────────────────────────────────────────────
let me = {
  x: 1.5, y: 1.5, angle: 0,
  hp: 100, coins: 0,
  name: "SOLDIER",
  color: "blue",
  id: null,
};
let isDead = false;

// ─── REMOTE PLAYERS ───────────────────────────────────────────
let remotePlayers = {}; // uid → { x, y, angle, hp, name, color, coins }

// ─── CANVAS ───────────────────────────────────────────────────
const canvas  = document.getElementById("game-canvas");
const ctx     = canvas.getContext("2d");
let W = 0, H = 0;

function resize() {
  W = canvas.width  = canvas.offsetWidth;
  H = canvas.height = canvas.offsetHeight;
}
window.addEventListener("resize", resize);
resize();

// ─── WALL COLORS ──────────────────────────────────────────────
const WALL_COLORS = [
  null,
  { h: "#8B4513", d: "#5C2E00" }, // type 1 — brown brick
  { h: "#2255aa", d: "#122244" }, // type 2 — blue slate
  { h: "#aa5522", d: "#552200" }, // type 3 — red brick
  { h: "#226633", d: "#113322" }, // type 4 — dark green
];

// ─── FLOOR / CEILING colors ───────────────────────────────────
const CEIL_TOP    = "#0a0a14";
const CEIL_BOT    = "#111128";
const FLOOR_TOP   = "#1a1410";
const FLOOR_BOT   = "#0a0906";

// ─── FOV ──────────────────────────────────────────────────────
const FOV = Math.PI / 2.8; // ~64°

// ─── RAYCASTER ────────────────────────────────────────────────
function castRay(px, py, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  let x = px, y = py;
  const stepSize = 0.02;
  let dist = 0;
  let wallType = 0;
  let side = 0; // 0=NS 1=EW

  // DDA
  const dirX = cos, dirY = sin;
  const mapX0 = Math.floor(x), mapY0 = Math.floor(y);

  const deltaX = Math.abs(1 / dirX) || 1e30;
  const deltaY = Math.abs(1 / dirY) || 1e30;

  let stepX, stepY, sideDistX, sideDistY;
  let mx = Math.floor(x), my = Math.floor(y);

  if (dirX < 0) { stepX = -1; sideDistX = (x - mx) * deltaX; }
  else          { stepX =  1; sideDistX = (mx + 1 - x) * deltaX; }
  if (dirY < 0) { stepY = -1; sideDistY = (y - my) * deltaY; }
  else          { stepY =  1; sideDistY = (my + 1 - y) * deltaY; }

  let hit = false;
  let maxDist = 20;

  while (!hit && maxDist-- > 0) {
    if (sideDistX < sideDistY) {
      sideDistX += deltaX; mx += stepX; side = 0;
    } else {
      sideDistY += deltaY; my += stepY; side = 1;
    }
    wallType = mapAt(mx, my);
    if (wallType > 0) hit = true;
  }

  let perpDist;
  if (side === 0) perpDist = sideDistX - deltaX;
  else            perpDist = sideDistY - deltaY;

  return { dist: Math.max(0.001, perpDist), wallType, side };
}

function drawScene() {
  if (!ctx) return;

  // Sky gradient
  const skyGrad = ctx.createLinearGradient(0, 0, 0, H/2);
  skyGrad.addColorStop(0, CEIL_TOP);
  skyGrad.addColorStop(1, CEIL_BOT);
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, W, H/2);

  // Floor gradient
  const floorGrad = ctx.createLinearGradient(0, H/2, 0, H);
  floorGrad.addColorStop(0, FLOOR_TOP);
  floorGrad.addColorStop(1, FLOOR_BOT);
  ctx.fillStyle = floorGrad;
  ctx.fillRect(0, H/2, W, H/2);

  // Walls — column by column
  for (let col = 0; col < W; col++) {
    const rayAngle = me.angle - FOV / 2 + (col / W) * FOV;
    const { dist, wallType, side } = castRay(me.x, me.y, rayAngle);

    const wallH = Math.min(H, Math.floor(H / dist));
    const top   = Math.floor((H - wallH) / 2);

    const colors = WALL_COLORS[wallType] || { h: "#888", d: "#444" };
    let shade = side === 1 ? colors.d : colors.h;

    // Distance fog
    const fog = Math.min(1, dist / 12);
    ctx.globalAlpha = 1 - fog * 0.7;

    ctx.fillStyle = shade;
    ctx.fillRect(col, top, 1, wallH);

    // Scanline texture (cheap)
    ctx.fillStyle = "rgba(0,0,0,0.15)";
    for (let ty = top; ty < top + wallH; ty += 4) {
      ctx.fillRect(col, ty, 1, 1);
    }
  }
  ctx.globalAlpha = 1;
}

// ─── SPRITE / ENEMY LABELS ────────────────────────────────────
const spritesLayer = document.getElementById("sprites-layer");
let spriteEls = {}; // uid → DOM element

function updateSprites() {
  // Remove stale
  Object.keys(spriteEls).forEach(uid => {
    if (!remotePlayers[uid]) {
      spriteEls[uid].remove();
      delete spriteEls[uid];
    }
  });

  Object.entries(remotePlayers).forEach(([uid, rp]) => {
    if (rp.hp <= 0) {
      if (spriteEls[uid]) spriteEls[uid].style.opacity = "0";
      return;
    }

    // Vector from me → them
    const dx = rp.x - me.x;
    const dy = rp.y - me.y;
    const dist = Math.sqrt(dx*dx + dy*dy);
    if (dist < 0.3) return;

    // Angle difference
    const spriteAngle = Math.atan2(dy, dx);
    let angleDiff = spriteAngle - me.angle;
    // Normalize
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

    const halfFov = FOV / 2 + 0.2;
    if (Math.abs(angleDiff) > halfFov) {
      if (spriteEls[uid]) spriteEls[uid].style.opacity = "0";
      return;
    }

    // Check if wall is blocking
    const { dist: wallDist } = castRay(me.x, me.y, spriteAngle);
    if (wallDist < dist - 0.5) {
      if (spriteEls[uid]) spriteEls[uid].style.opacity = "0";
      return;
    }

    // Screen position
    const screenX = W / 2 + (angleDiff / (FOV / 2)) * (W / 2);
    const scale = Math.min(1, 1.2 / dist);
    const screenY = H / 2 - scale * 40;

    // Create or update DOM element
    if (!spriteEls[uid]) {
      const el = document.createElement("div");
      el.className = "enemy-label";
      spritesLayer.appendChild(el);
      spriteEls[uid] = el;
    }
    const el = spriteEls[uid];
    const hpPct = Math.max(0, rp.hp ?? 100);
    el.innerHTML = `${rp.name || "???"} <span class="elabel-hp">♥${hpPct}</span>`;
    el.style.left   = screenX + "px";
    el.style.top    = screenY + "px";
    el.style.opacity = Math.min(1, 1 - dist / 10 + 0.3).toString();
    el.style.fontSize = Math.max(8, 13 * scale) + "px";

    // Draw enemy shape on canvas (simple quad)
    const spriteW = Math.floor(W * scale * 0.25);
    const spriteH = Math.floor(H * scale * 0.5);
    const sx = Math.floor(screenX - spriteW / 2);
    const sy = Math.floor(H / 2 - spriteH / 2);

    // Body colour by player colour
    const colorMap = {
      blue:"#3366ff", red:"#ff3333", orange:"#ff8800",
      yellow:"#ffee00", green:"#33ff66", purple:"#aa44ff"
    };
    const bodyColor = colorMap[rp.color] || "#aaa";

    ctx.globalAlpha = Math.min(1, 0.3 + (1 - dist/10));
    // Body
    ctx.fillStyle = bodyColor;
    ctx.fillRect(sx, sy, spriteW, spriteH);
    // Head
    const headW = Math.floor(spriteW * 0.6);
    const headH = Math.floor(spriteH * 0.35);
    ctx.fillStyle = "#e0c090";
    ctx.fillRect(sx + Math.floor((spriteW - headW)/2), sy - headH, headW, headH);
    // Eyes
    ctx.fillStyle = "#000";
    const ew = Math.max(2, Math.floor(headW*0.15));
    const ey = sy - headH + Math.floor(headH*0.3);
    ctx.fillRect(sx + Math.floor((spriteW - headW)/2) + Math.floor(headW*0.2), ey, ew, ew);
    ctx.fillRect(sx + Math.floor((spriteW - headW)/2) + Math.floor(headW*0.6), ey, ew, ew);
    ctx.globalAlpha = 1;
  });
}

// ─── BULLETS (local simulation + Firebase sync) ───────────────
let bullets = []; // { x, y, vx, vy, ownerId, id, dist }
const BULLET_SPEED = 6;
const BULLET_DAMAGE = 10;
const BULLET_MAX_DIST = 15;

function fireBullet() {
  if (isDead) return;
  const id = firebase.database().ref("fps_bullets").push().key;
  const b = {
    id, ownerId: me.id,
    x: me.x, y: me.y,
    vx: Math.cos(me.angle),
    vy: Math.sin(me.angle),
    createdAt: firebase.database.ServerValue.TIMESTAMP,
  };
  firebase.database().ref(`fps_bullets/${id}`).set(b);
  // local copy
  bullets.push({ ...b, dist: 0 });
}

let hitBullets = new Set();

function updateBullets(dt) {
  bullets = bullets.filter(b => {
    const step = BULLET_SPEED * dt;
    b.x += b.vx * step;
    b.y += b.vy * step;
    b.dist += step;

    // Hit wall?
    if (mapAt(b.x, b.y) > 0 || b.dist > BULLET_MAX_DIST) {
      if (b.ownerId === me.id)
        firebase.database().ref(`fps_bullets/${b.id}`).remove();
      return false;
    }

    // Hit enemy (only our bullets, check remote players)
    if (b.ownerId === me.id) {
      for (const [uid, rp] of Object.entries(remotePlayers)) {
        if (rp.hp <= 0) continue;
        const dx = b.x - rp.x, dy = b.y - rp.y;
        if (Math.sqrt(dx*dx + dy*dy) < 0.4) {
          // Signal hit; enemy client handles their own HP
          firebase.database().ref(`fps_bullets/${b.id}/hitTarget`).set(uid);
          firebase.database().ref(`fps_bullets/${b.id}`).remove();
          // Kill feed
          showKillFeed(me.name, rp.name || uid, false);
          return false;
        }
      }
    }

    // Someone else's bullet hit me?
    if (b.ownerId !== me.id && !hitBullets.has(b.id) && me.hp > 0) {
      const dx = b.x - me.x, dy = b.y - me.y;
      if (Math.sqrt(dx*dx + dy*dy) < 0.4) {
        hitBullets.add(b.id);
        const newHp = Math.max(0, (me.hp) - BULLET_DAMAGE);
        playerRef.update({ hp: newHp });
        me.hp = newHp;
        showDamageFlash();
        return false;
      }
    }

    return true;
  });
}

function drawBullets() {
  bullets.forEach(b => {
    // Project bullet to screen
    const dx = b.x - me.x, dy = b.y - me.y;
    const dist = Math.sqrt(dx*dx + dy*dy);
    if (dist < 0.1) return;
    const spriteAngle = Math.atan2(dy, dx);
    let angleDiff = spriteAngle - me.angle;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
    if (Math.abs(angleDiff) > FOV / 2 + 0.1) return;
    const screenX = W / 2 + (angleDiff / (FOV / 2)) * (W / 2);
    const screenY = H / 2;
    const r = Math.max(2, Math.floor(5 / dist));
    ctx.save();
    ctx.shadowColor = "#ffee33";
    ctx.shadowBlur  = 10;
    ctx.fillStyle   = "#ffee33";
    ctx.beginPath();
    ctx.arc(screenX, screenY, r, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
  });
}

// ─── HUD ──────────────────────────────────────────────────────
const hudHpBar  = document.getElementById("hud-hp-bar");
const hudHpNum  = document.getElementById("hud-hp-num");
const hudCoins  = document.getElementById("hud-coins-num");
const hudName   = document.getElementById("hud-name");
const killFeed  = document.getElementById("hud-kill-feed");
const deathScreen = document.getElementById("death-screen");
const killBanner  = document.getElementById("kill-banner");
const dmgFlash    = document.getElementById("damage-flash");

function updateHUD() {
  const hp = Math.max(0, me.hp);
  const pct = hp;
  hudHpBar.style.width = pct + "%";
  hudHpBar.style.background = pct > 50
    ? "linear-gradient(90deg,#59ff5a,#a8ff78)"
    : pct > 25
    ? "linear-gradient(90deg,#ffcc00,#ffe066)"
    : "linear-gradient(90deg,#ff3333,#ff6666)";
  hudHpNum.textContent = hp;
  hudHpNum.style.color = pct > 50 ? "#59ff5a" : pct > 25 ? "#ffcc00" : "#ff3333";
  hudCoins.textContent = me.coins;
  hudName.textContent  = me.name.toUpperCase();
}

function showDamageFlash() {
  dmgFlash.classList.remove("hit");
  void dmgFlash.offsetWidth;
  dmgFlash.classList.add("hit");
}

function showKillFeed(killer, victim, iWasDead) {
  const el = document.createElement("div");
  el.className = "kill-entry";
  el.textContent = `${killer} ⚡ ${victim}`;
  killFeed.appendChild(el);
  setTimeout(() => el.remove(), 4200);

  if (!iWasDead && killer === me.name) {
    showKillBanner(`ELIMINATED ${victim}`);
  }
}

function showKillBanner(text) {
  killBanner.textContent = text;
  killBanner.classList.remove("hidden");
  killBanner.style.animation = "none";
  void killBanner.offsetWidth;
  killBanner.style.animation = "";
  setTimeout(() => killBanner.classList.add("hidden"), 2600);
}

// ─── CONTROLS ─────────────────────────────────────────────────
const keys = {};
let mouseX = 0;
const MOUSE_SENSITIVITY = 0.0018;
let pointerLocked = false;

document.addEventListener("keydown", e => { keys[e.code] = true; });
document.addEventListener("keyup",   e => { keys[e.code] = false; });

canvas.addEventListener("click", () => {
  canvas.requestPointerLock();
});
document.addEventListener("pointerlockchange", () => {
  pointerLocked = document.pointerLockElement === canvas;
});

document.addEventListener("mousemove", e => {
  if (!pointerLocked) return;
  me.angle += e.movementX * MOUSE_SENSITIVITY;
});

// Shoot on left click while locked
let lastShot = 0;
const FIRE_RATE = 300; // ms
document.addEventListener("mousedown", e => {
  if (!pointerLocked || e.button !== 0) return;
  const now = Date.now();
  if (now - lastShot < FIRE_RATE) return;
  lastShot = now;
  fireBullet();
});

// ─── MOVEMENT ─────────────────────────────────────────────────
const MOVE_SPEED = 3.5; // units/s
const TURN_SPEED = 2.2;

function movePlayer(dt) {
  if (isDead) return;

  let nx = me.x, ny = me.y;
  const cos = Math.cos(me.angle), sin = Math.sin(me.angle);

  // Keyboard turning (fallback if no pointer lock)
  if (!pointerLocked) {
    if (keys["ArrowLeft"]  || keys["KeyQ"]) me.angle -= TURN_SPEED * dt;
    if (keys["ArrowRight"] || keys["KeyE"]) me.angle += TURN_SPEED * dt;
  }

  if (keys["KeyW"] || keys["ArrowUp"]) {
    nx += cos * MOVE_SPEED * dt;
    ny += sin * MOVE_SPEED * dt;
  }
  if (keys["KeyS"] || keys["ArrowDown"]) {
    nx -= cos * MOVE_SPEED * dt;
    ny -= sin * MOVE_SPEED * dt;
  }
  if (keys["KeyA"]) {
    nx += sin * MOVE_SPEED * dt;
    ny -= cos * MOVE_SPEED * dt;
  }
  if (keys["KeyD"]) {
    nx -= sin * MOVE_SPEED * dt;
    ny += cos * MOVE_SPEED * dt;
  }

  const margin = 0.25;
  if (mapAt(nx, me.y) === 0) me.x = nx;
  if (mapAt(me.x, ny) === 0) me.y = ny;
}

// ─── FIREBASE ─────────────────────────────────────────────────
let playerRef = null;
let playerId  = null;

function initFirebase() {
  const allPlayersRef = firebase.database().ref("fps_players");
  const allBulletsRef = firebase.database().ref("fps_bullets");

  allPlayersRef.on("child_added", snap => {
    const p = snap.val();
    if (!p || snap.key === playerId) return;
    remotePlayers[snap.key] = p;
  });
  allPlayersRef.on("child_changed", snap => {
    const p = snap.val();
    if (!p || snap.key === playerId) return;
    remotePlayers[snap.key] = p;
  });
  allPlayersRef.on("child_removed", snap => {
    delete remotePlayers[snap.key];
    if (spriteEls[snap.key]) { spriteEls[snap.key].remove(); delete spriteEls[snap.key]; }
  });

  allBulletsRef.on("child_added", snap => {
    const b = snap.val();
    if (!b || b.ownerId === playerId) return; // own bullets added locally
    bullets.push({ ...b, dist: 0, vx: b.vx, vy: b.vy });

    // Watch for hitTarget (if it targets me — already handled in updateBullets)
  });

  allBulletsRef.on("child_removed", snap => {
    const key = snap.key;
    bullets = bullets.filter(b => b.id !== key);
  });

  // Clean stale fps_bullets
  setInterval(() => {
    const now = Date.now();
    firebase.database().ref("fps_bullets").once("value", snap => {
      const all = snap.val() || {};
      Object.entries(all).forEach(([id, b]) => {
        if (b.createdAt && now - b.createdAt > 6000)
          firebase.database().ref(`fps_bullets/${id}`).remove();
      });
    });
  }, 6000);
}

// Push our position every ~50ms
let lastPush = 0;
function pushPosition(now) {
  if (!playerRef || isDead) return;
  if (now - lastPush < 50) return;
  lastPush = now;
  playerRef.update({
    x: parseFloat(me.x.toFixed(3)),
    y: parseFloat(me.y.toFixed(3)),
    angle: parseFloat(me.angle.toFixed(4)),
    hp: me.hp,
    name: me.name,
    color: me.color,
    coins: me.coins,
  });
}

// ─── RESPAWN ──────────────────────────────────────────────────
function handleDeath() {
  isDead = true;
  deathScreen.classList.remove("hidden");
  setTimeout(() => {
    const spot = randomSpawn();
    me.x = spot.x; me.y = spot.y;
    me.angle = Math.random() * Math.PI * 2;
    me.hp = 100;
    isDead = false;
    deathScreen.classList.add("hidden");
    playerRef.update({ hp: 100, x: me.x, y: me.y });
  }, 3000);
}

// ─── MINIMAP ──────────────────────────────────────────────────
const MM_SIZE   = 140; // px
const MM_CELL   = MM_SIZE / MAP_W;
const MM_MARGIN = 16;

function drawMinimap() {
  const ox = W - MM_SIZE - MM_MARGIN;
  const oy = H - MM_SIZE - MM_MARGIN;

  // Background
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(ox - 2, oy - 2, MM_SIZE + 4, MM_SIZE + 4);

  // Walls
  for (let row = 0; row < MAP_H; row++) {
    for (let col = 0; col < MAP_W; col++) {
      const cell = MAP[row][col];
      if (cell > 0) {
        const wallColors = ["#000","#6b3a1f","#1a3d88","#882211","#144d28"];
        ctx.fillStyle = wallColors[cell] || "#444";
      } else {
        ctx.fillStyle = "rgba(255,255,255,0.06)";
      }
      ctx.fillRect(ox + col * MM_CELL, oy + row * MM_CELL, MM_CELL, MM_CELL);
    }
  }

  // Remote players — dot + tiny name
  const colorMap = {
    blue:"#3366ff", red:"#ff4444", orange:"#ff8800",
    yellow:"#ffee00", green:"#33ff66", purple:"#cc44ff"
  };
  Object.values(remotePlayers).forEach(rp => {
    if (rp.hp <= 0) return;
    const rx = ox + rp.x * MM_CELL;
    const ry = oy + rp.y * MM_CELL;
    ctx.fillStyle = colorMap[rp.color] || "#fff";
    ctx.beginPath();
    ctx.arc(rx, ry, 3, 0, Math.PI * 2);
    ctx.fill();
    // direction tick
    ctx.strokeStyle = colorMap[rp.color] || "#fff";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(rx, ry);
    ctx.lineTo(rx + Math.cos(rp.angle) * 6, ry + Math.sin(rp.angle) * 6);
    ctx.stroke();
    // name
    ctx.fillStyle = "#fff";
    ctx.font = "7px 'Share Tech Mono', monospace";
    ctx.fillText((rp.name || "?").slice(0,8), rx + 4, ry - 3);
  });

  // Self — white dot with FOV cone
  const mx = ox + me.x * MM_CELL;
  const my = oy + me.y * MM_CELL;
  const coneLen = 18;
  ctx.strokeStyle = "rgba(0,255,231,0.3)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(mx, my);
  ctx.lineTo(mx + Math.cos(me.angle - FOV/2) * coneLen, my + Math.sin(me.angle - FOV/2) * coneLen);
  ctx.moveTo(mx, my);
  ctx.lineTo(mx + Math.cos(me.angle + FOV/2) * coneLen, my + Math.sin(me.angle + FOV/2) * coneLen);
  ctx.stroke();

  ctx.fillStyle = "#00ffe7";
  ctx.beginPath();
  ctx.arc(mx, my, 3.5, 0, Math.PI * 2);
  ctx.fill();

  // Player count label
  const total = Object.keys(remotePlayers).length;
  ctx.fillStyle = "rgba(0,255,231,0.6)";
  ctx.font = "8px 'Share Tech Mono', monospace";
  ctx.fillText(`${total} player${total !== 1 ? "s" : ""} online`, ox, oy - 4);
}

// ─── MAIN LOOP ────────────────────────────────────────────────
let lastTime = 0;
function loop(ts) {
  const dt = Math.min(0.1, (ts - lastTime) / 1000);
  lastTime = ts;

  // Death check
  if (!isDead && me.hp <= 0) handleDeath();

  if (!isDead) {
    movePlayer(dt);
    updateBullets(dt);
    pushPosition(ts);
  }

  drawScene();
  drawBullets();
  updateSprites();
  drawMinimap();
  updateHUD();

  requestAnimationFrame(loop);
}

// ─── LOGIN / START ─────────────────────────────────────────────
const loginOverlay = document.getElementById("login-overlay");
const loginBtn     = document.getElementById("login-btn");
const nameInput    = document.getElementById("player-name-input");

loginBtn.addEventListener("click", startGame);
nameInput.addEventListener("keydown", e => {
  if (e.key === "Enter") startGame();
});

const PLAYER_COLORS = ["blue","red","orange","yellow","green","purple"];

function startGame() {
  const rawName = nameInput.value.trim().toUpperCase();
  me.name = rawName || ("SOLDIER" + Math.floor(Math.random()*99));
  me.color = PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)];

  loginOverlay.classList.add("hidden");

  firebase.auth().onAuthStateChanged(user => {
    if (user) {
      playerId = user.uid;
      me.id    = playerId;

      const spot = randomSpawn();
      me.x = spot.x; me.y = spot.y;
      me.angle = Math.random() * Math.PI * 2;

      playerRef = firebase.database().ref(`fps_players/${playerId}`);
      playerRef.set({
        id: playerId, x: me.x, y: me.y,
        angle: me.angle, hp: 100, coins: 0,
        name: me.name, color: me.color,
      });
      playerRef.onDisconnect().remove();

      initFirebase();
      lastTime = performance.now();
      requestAnimationFrame(loop);
    }
  });

  firebase.auth().signInAnonymously().catch(console.error);
}
