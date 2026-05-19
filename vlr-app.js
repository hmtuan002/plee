"use strict";
// ═══════════════════════════════════════════════════════════════
//  VÂN LÔ RẦN — FPS 3D Thật (Three.js Engine)
//  Chuyển đổi từ raycasting 2D sang Three.js 3D hoàn toàn
//  Network: Firebase Realtime Database
// ═══════════════════════════════════════════════════════════════

// ─── BẢN ĐỒ ──────────────────────────────────────────────────
// 0 = ô trống, 1-4 = loại tường
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

const CELL = 4; // 1 ô bản đồ = 4 đơn vị Three.js
const WALL_H = 4;

function mapAt(gx, gy) {
  const xi = Math.floor(gx), yi = Math.floor(gy);
  if (xi < 0 || xi >= MAP_W || yi < 0 || yi >= MAP_H) return 1;
  return MAP[yi][xi];
}

// Vị trí spawn (ô trống)
const SPAWN_SPOTS = [];
for (let y = 1; y < MAP_H-1; y++)
  for (let x = 1; x < MAP_W-1; x++)
    if (MAP[y][x] === 0) SPAWN_SPOTS.push({ x: x + 0.5, y: y + 0.5 });

function randomSpawn() {
  return SPAWN_SPOTS[Math.floor(Math.random() * SPAWN_SPOTS.length)];
}

// Grid → World
function gridToWorld(gx, gy) {
  return new THREE.Vector3(gx * CELL, 0, gy * CELL);
}

// ─── MÀU SẮC TƯỜNG ───────────────────────────────────────────
const WALL_COLORS_HEX = [null, 0x7a3a1a, 0x1a4499, 0x993322, 0x1a5530];
const FLOOR_COLOR  = 0x1a1410;
const CEIL_COLOR   = 0x0a0a14;
const AMBIENT_LIGHT = 0x202030;
const FOG_COLOR    = 0x000000;
const FOG_NEAR     = 8;
const FOG_FAR      = 60;

// ─── TRẠNG THÁI NGƯỜI CHƠI ────────────────────────────────────
let me = {
  x: 1.5, y: 1.5,   // vị trí lưới
  angle: 0,          // góc nhìn (radian)
  hp: 100, coins: 0,
  name: "LÍNH",
  color: "blue",
  id: null,
};
let isDead = false;

// ─── NGƯỜI CHƠI KHÁC ──────────────────────────────────────────
let remotePlayers = {}; // uid → data
let remoteModels  = {}; // uid → { group, nameTag, hpBar, ... }

// ─── THREE.JS SETUP ───────────────────────────────────────────
const canvas = document.getElementById("vlr-canvas");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(FOG_COLOR, FOG_NEAR, FOG_FAR);
scene.background = new THREE.Color(CEIL_COLOR);

// Camera FPS
const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 80);
camera.position.set(0, WALL_H * 0.45, 0); // mắt người chơi

function resize() {
  const W = window.innerWidth, H = window.innerHeight;
  renderer.setSize(W, H);
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

// ─── ÁNH SÁNG ─────────────────────────────────────────────────
const ambientLight = new THREE.AmbientLight(AMBIENT_LIGHT, 3);
scene.add(ambientLight);

// Đèn điểm ở trung tâm bản đồ
const mapCX = (MAP_W / 2) * CELL;
const mapCZ = (MAP_H / 2) * CELL;
const centerLight = new THREE.PointLight(0x5577ff, 1.5, 50);
centerLight.position.set(mapCX, WALL_H * 0.8, mapCZ);
scene.add(centerLight);

// Đèn vàng nhỏ rải rác
[[3,3],[3,13],[13,3],[13,13],[8,8]].forEach(([gx,gy]) => {
  const pl = new THREE.PointLight(0xffaa44, 0.8, 18);
  pl.position.set(gx * CELL, WALL_H * 0.75, gy * CELL);
  scene.add(pl);
});

// ─── XÂY BẢN ĐỒ 3D ───────────────────────────────────────────
const wallMaterials = WALL_COLORS_HEX.map((c, i) => {
  if (!c) return null;
  // Tạo texture procedural
  const size = 64;
  const data = new Uint8Array(size * size * 3);
  const r0 = (c >> 16) & 0xff;
  const g0 = (c >> 8) & 0xff;
  const b0 = c & 0xff;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const idx = (py * size + px) * 3;
      // Gạch
      const bx = Math.floor(px / 16), by = Math.floor(py / 8);
      const mortar = (px % 16 === 0 || py % 8 === 0) ? 0.6 : 1.0;
      const noise = 0.9 + Math.random() * 0.1;
      data[idx]   = Math.min(255, r0 * mortar * noise);
      data[idx+1] = Math.min(255, g0 * mortar * noise);
      data[idx+2] = Math.min(255, b0 * mortar * noise);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBFormat);
  tex.needsUpdate = true;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 1);
  return new THREE.MeshLambertMaterial({ map: tex });
});

// Nền sàn
{
  const geo = new THREE.PlaneGeometry(MAP_W * CELL, MAP_H * CELL);
  // Texture sàn procedural
  const size = 128;
  const data = new Uint8Array(size * size * 3);
  for (let i = 0; i < size * size; i++) {
    const v = 20 + Math.floor(Math.random() * 10);
    data[i*3] = v; data[i*3+1] = v * 0.9; data[i*3+2] = v * 0.7;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBFormat);
  tex.needsUpdate = true;
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, map: tex });
  const floor = new THREE.Mesh(geo, mat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(MAP_W * CELL / 2, 0, MAP_H * CELL / 2);
  scene.add(floor);
}

// Trần
{
  const geo = new THREE.PlaneGeometry(MAP_W * CELL, MAP_H * CELL);
  const mat = new THREE.MeshLambertMaterial({ color: CEIL_COLOR });
  const ceil = new THREE.Mesh(geo, mat);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(MAP_W * CELL / 2, WALL_H, MAP_H * CELL / 2);
  scene.add(ceil);
}

// Tường
for (let row = 0; row < MAP_H; row++) {
  for (let col = 0; col < MAP_W; col++) {
    const cell = MAP[row][col];
    if (!cell) continue;
    const mat = wallMaterials[cell] || new THREE.MeshLambertMaterial({ color: 0x444444 });
    const geo = new THREE.BoxGeometry(CELL, WALL_H, CELL);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(
      col * CELL + CELL / 2,
      WALL_H / 2,
      row * CELL + CELL / 2
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
}

// ─── MÔ HÌNH NGƯỜI CHƠI (billboard character) ─────────────────
const PLAYER_COLORS_MAP = {
  blue: 0x3366ff, red: 0xff3333, orange: 0xff8800,
  yellow: 0xffee00, green: 0x33ff66, purple: 0xaa44ff
};

function createPlayerModel(color) {
  const group = new THREE.Group();
  const clr = PLAYER_COLORS_MAP[color] || 0xaaaaaa;

  // Thân
  const bodyGeo = new THREE.BoxGeometry(0.7, 1.0, 0.4);
  const bodyMat = new THREE.MeshLambertMaterial({ color: clr });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.5;
  group.add(body);

  // Đầu
  const headGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
  const headMat = new THREE.MeshLambertMaterial({ color: 0xe0c090 });
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.y = 1.25;
  group.add(head);

  // Mũ bảo hiểm
  const helmetGeo = new THREE.BoxGeometry(0.52, 0.22, 0.52);
  const helmetMat = new THREE.MeshLambertMaterial({ color: clr });
  const helmet = new THREE.Mesh(helmetGeo, helmetMat);
  helmet.position.y = 1.58;
  group.add(helmet);

  // Tay
  [-0.45, 0.45].forEach(xOff => {
    const armGeo = new THREE.BoxGeometry(0.2, 0.7, 0.2);
    const arm = new THREE.Mesh(armGeo, bodyMat);
    arm.position.set(xOff, 0.45, 0);
    group.add(arm);
  });

  // Chân
  [-0.18, 0.18].forEach(xOff => {
    const legGeo = new THREE.BoxGeometry(0.25, 0.65, 0.25);
    const legMat = new THREE.MeshLambertMaterial({ color: 0x222233 });
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(xOff, -0.33, 0);
    group.add(leg);
  });

  return group;
}

// ─── SPRITE NHÃN TÊN (CSS2D-style bằng DOM) ───────────────────
const spritesLayer = document.getElementById("sprites-layer");
let spriteEls = {};

function getOrCreateSpriteEl(uid) {
  if (!spriteEls[uid]) {
    const el = document.createElement("div");
    el.className = "enemy-label";
    spritesLayer.appendChild(el);
    spriteEls[uid] = el;
  }
  return spriteEls[uid];
}

function removeSpriteEl(uid) {
  if (spriteEls[uid]) {
    spriteEls[uid].remove();
    delete spriteEls[uid];
  }
}

// Chiếu vị trí 3D → tọa độ màn hình 2D
function worldToScreen(pos3d) {
  const v = pos3d.clone().project(camera);
  if (v.z > 1) return null; // sau lưng
  const W = window.innerWidth, H = window.innerHeight;
  return {
    x: (v.x * 0.5 + 0.5) * W,
    y: (-v.y * 0.5 + 0.5) * H,
    depth: v.z,
  };
}

// ─── QUẢN LÝ REMOTE PLAYERS ───────────────────────────────────
function addRemoteModel(uid, data) {
  if (remoteModels[uid]) return;
  const group = createPlayerModel(data.color || "blue");
  scene.add(group);
  remoteModels[uid] = { group };
}

function removeRemoteModel(uid) {
  if (remoteModels[uid]) {
    scene.remove(remoteModels[uid].group);
    delete remoteModels[uid];
  }
  removeSpriteEl(uid);
}

function syncRemoteModels() {
  Object.entries(remotePlayers).forEach(([uid, rp]) => {
    if (!remoteModels[uid]) addRemoteModel(uid, rp);
    const m = remoteModels[uid];
    if (!m) return;

    // Vị trí world
    const wx = rp.x * CELL;
    const wz = rp.y * CELL;
    m.group.position.set(wx, 0, wz);

    // Xoay nhìn về hướng angle
    m.group.rotation.y = -rp.angle;

    // Hiện/ẩn tuỳ HP
    m.group.visible = rp.hp > 0;

    // Nhãn tên DOM
    if (rp.hp > 0) {
      const headPos = new THREE.Vector3(wx, WALL_H * 0.6, wz);
      const sc = worldToScreen(headPos);
      const el = getOrCreateSpriteEl(uid);
      if (sc && sc.depth < 1) {
        el.style.left   = sc.x + "px";
        el.style.top    = sc.y + "px";
        el.style.opacity = "1";
        const hpPct = Math.max(0, rp.hp ?? 100);
        el.innerHTML = `${rp.name || "???"} <span class="elabel-hp">♥${hpPct}</span>`;
      } else {
        el.style.opacity = "0";
      }
    } else {
      const el = spriteEls[uid];
      if (el) el.style.opacity = "0";
    }
  });

  // Xóa model đã rời
  Object.keys(remoteModels).forEach(uid => {
    if (!remotePlayers[uid]) {
      removeRemoteModel(uid);
    }
  });
}

// ─── ĐẠN ─────────────────────────────────────────────────────
let bullets = [];
const BULLET_SPEED = 24; // world units/s
const BULLET_DAMAGE = 10;
const BULLET_MAX_DIST = 15 * CELL;

const bulletGeo = new THREE.SphereGeometry(0.12, 6, 6);
const bulletMat = new THREE.MeshBasicMaterial({ color: 0xffee33 });
bulletMat.emissive = new THREE.Color(0xffee33);

// Ánh sáng điểm kèm đạn
function makeBulletMesh() {
  const mesh = new THREE.Mesh(bulletGeo, bulletMat.clone());
  const light = new THREE.PointLight(0xffee33, 1.5, 4);
  mesh.add(light);
  return mesh;
}

function fireBullet() {
  if (isDead) return;
  const id = firebase.database().ref("vlr_bullets").push().key;

  const wx = me.x * CELL;
  const wz = me.y * CELL;
  const vx = Math.sin(me.angle) * BULLET_SPEED;
  const vz = Math.cos(me.angle) * BULLET_SPEED;

  const mesh = makeBulletMesh();
  mesh.position.set(wx, WALL_H * 0.45, wz);
  scene.add(mesh);

  const b = {
    id, ownerId: me.id,
    x: wx, y: WALL_H * 0.45, z: wz,
    vx, vz,
    dist: 0,
    mesh,
    createdAt: Date.now(),
  };
  bullets.push(b);

  firebase.database().ref(`vlr_bullets/${id}`).set({
    id, ownerId: me.id,
    x: wx, y: WALL_H * 0.45, z: wz,
    vx, vz,
    createdAt: firebase.database.ServerValue.TIMESTAMP,
  });

  // Recoil animation
  recoilActive = true;
  recoilTime = 0;
}

let hitBullets = new Set();
let recoilActive = false, recoilTime = 0;

function updateBullets(dt) {
  bullets = bullets.filter(b => {
    const step = dt;
    b.x += b.vx * step;
    b.z += b.vz * step;
    b.dist += Math.sqrt(b.vx * b.vx + b.vz * b.vz) * step;
    b.mesh.position.set(b.x, b.y, b.z);

    // Chạm tường?
    const gx = b.x / CELL, gz = b.z / CELL;
    if (mapAt(gx, gz) > 0 || b.dist > BULLET_MAX_DIST) {
      scene.remove(b.mesh);
      if (b.ownerId === me.id)
        firebase.database().ref(`vlr_bullets/${b.id}`).remove();
      return false;
    }

    // Ta bắn → kiểm tra chạm người khác
    if (b.ownerId === me.id) {
      for (const [uid, rp] of Object.entries(remotePlayers)) {
        if (rp.hp <= 0) continue;
        const rx = rp.x * CELL, rz = rp.y * CELL;
        const dx = b.x - rx, dz = b.z - rz;
        if (Math.sqrt(dx*dx + dz*dz) < 0.8) {
          firebase.database().ref(`vlr_bullets/${b.id}/hitTarget`).set(uid);
          firebase.database().ref(`vlr_bullets/${b.id}`).remove();
          showKillFeed(me.name, rp.name || uid, false);
          scene.remove(b.mesh);
          return false;
        }
      }
    }

    // Đạn người khác → ta bị bắn
    if (b.ownerId !== me.id && !hitBullets.has(b.id) && me.hp > 0) {
      const mwx = me.x * CELL, mwz = me.y * CELL;
      const dx = b.x - mwx, dz = b.z - mwz;
      if (Math.sqrt(dx*dx + dz*dz) < 0.8) {
        hitBullets.add(b.id);
        const newHp = Math.max(0, me.hp - BULLET_DAMAGE);
        if (playerRef) playerRef.update({ hp: newHp });
        me.hp = newHp;
        showDamageFlash();
        scene.remove(b.mesh);
        return false;
      }
    }

    return true;
  });
}

// ─── VA CHẠM VÀ DI CHUYỂN ─────────────────────────────────────
const MOVE_SPEED = 3.2; // grid units/s
const MOUSE_SENS = 0.0018;
let pointerLocked = false;
const keys = {};

document.addEventListener("keydown", e => { keys[e.code] = true; });
document.addEventListener("keyup",   e => { keys[e.code] = false; });

canvas.addEventListener("click", () => { canvas.requestPointerLock(); });
document.addEventListener("pointerlockchange", () => {
  pointerLocked = document.pointerLockElement === canvas;
});

let lastShot = 0;
const FIRE_RATE = 300;
document.addEventListener("mousemove", e => {
  if (!pointerLocked) return;
  me.angle += e.movementX * MOUSE_SENS;
});
document.addEventListener("mousedown", e => {
  if (!pointerLocked || e.button !== 0) return;
  const now = Date.now();
  if (now - lastShot < FIRE_RATE) return;
  lastShot = now;
  fireBullet();
});

function movePlayer(dt) {
  if (isDead) return;

  const sin = Math.sin(me.angle);
  const cos = Math.cos(me.angle);
  const speed = MOVE_SPEED * dt;

  let dx = 0, dz = 0;
  if (keys["KeyW"] || keys["ArrowUp"])    { dx += sin; dz += cos; }
  if (keys["KeyS"] || keys["ArrowDown"])  { dx -= sin; dz -= cos; }
  if (keys["KeyA"])                        { dx -= cos; dz += sin; }
  if (keys["KeyD"])                        { dx += cos; dz -= sin; }

  if (!pointerLocked) {
    if (keys["ArrowLeft"]  || keys["KeyQ"]) me.angle -= 2.0 * dt;
    if (keys["ArrowRight"] || keys["KeyE"]) me.angle += 2.0 * dt;
  }

  const margin = 0.3;
  const nx = me.x + dx * speed;
  const nz = me.y + dz * speed;
  if (mapAt(nx, me.y) === 0) me.x = nx;
  if (mapAt(me.x, nz) === 0) me.y = nz;

  // Cập nhật camera
  camera.position.x = me.x * CELL;
  camera.position.z = me.y * CELL;

  // Bob khi di chuyển
  const moving = dx !== 0 || dz !== 0;
  const t = performance.now() * 0.003;
  if (moving) {
    camera.position.y = WALL_H * 0.45 + Math.sin(t * 6) * 0.05;
  } else {
    camera.position.y += (WALL_H * 0.45 - camera.position.y) * 0.1;
  }

  // Xoay camera
  camera.rotation.y = -me.angle + Math.PI; // Three.js: y-up, axis inverted
}

// Recoil camera
function updateRecoil(dt) {
  if (!recoilActive) return;
  recoilTime += dt;
  const kick = Math.max(0, 0.04 - recoilTime * 0.3);
  camera.rotation.x = -kick;
  if (recoilTime > 0.3) {
    recoilActive = false;
    camera.rotation.x = 0;
  }
}

// ─── MINIMAP ─────────────────────────────────────────────────
const mmCanvas = document.getElementById("mm-canvas");
const mmCtx = mmCanvas.getContext("2d");
const MM = 140;
const MC = MM / MAP_W;

function drawMinimap() {
  mmCtx.clearRect(0, 0, MM, MM);
  mmCtx.fillStyle = "rgba(0,0,0,0.7)";
  mmCtx.fillRect(0, 0, MM, MM);

  // Ô bản đồ
  for (let row = 0; row < MAP_H; row++) {
    for (let col = 0; col < MAP_W; col++) {
      const cell = MAP[row][col];
      if (cell > 0) {
        const wcs = ["#000","#6b3a1f","#1a3d88","#882211","#144d28"];
        mmCtx.fillStyle = wcs[cell] || "#444";
      } else {
        mmCtx.fillStyle = "rgba(255,255,255,0.06)";
      }
      mmCtx.fillRect(col * MC, row * MC, MC, MC);
    }
  }

  // Người chơi khác
  const cMap = { blue:"#3366ff",red:"#ff4444",orange:"#ff8800",yellow:"#ffee00",green:"#33ff66",purple:"#cc44ff" };
  Object.values(remotePlayers).forEach(rp => {
    if (rp.hp <= 0) return;
    const rx = rp.x * MC, ry = rp.y * MC;
    mmCtx.fillStyle = cMap[rp.color] || "#fff";
    mmCtx.beginPath();
    mmCtx.arc(rx, ry, 2.5, 0, Math.PI * 2);
    mmCtx.fill();
    mmCtx.strokeStyle = cMap[rp.color] || "#fff";
    mmCtx.lineWidth = 1;
    mmCtx.beginPath();
    mmCtx.moveTo(rx, ry);
    mmCtx.lineTo(rx + Math.sin(rp.angle) * 5, ry + Math.cos(rp.angle) * 5);
    mmCtx.stroke();
  });

  // Bản thân — mũi tên xanh lam
  const mx = me.x * MC, my = me.y * MC;
  mmCtx.fillStyle = "#00ffe7";
  mmCtx.beginPath();
  mmCtx.arc(mx, my, 3.5, 0, Math.PI * 2);
  mmCtx.fill();

  mmCtx.strokeStyle = "rgba(0,255,231,0.5)";
  mmCtx.lineWidth = 1;
  const fov = Math.PI / 2.8;
  mmCtx.beginPath();
  mmCtx.moveTo(mx, my);
  mmCtx.lineTo(mx + Math.sin(me.angle - fov/2) * 18, my + Math.cos(me.angle - fov/2) * 18);
  mmCtx.moveTo(mx, my);
  mmCtx.lineTo(mx + Math.sin(me.angle + fov/2) * 18, my + Math.cos(me.angle + fov/2) * 18);
  mmCtx.stroke();

  // Số người
  const total = Object.keys(remotePlayers).length;
  mmCtx.fillStyle = "rgba(0,255,231,0.6)";
  mmCtx.font = "8px 'Share Tech Mono', monospace";
  mmCtx.fillText(`${total} lính online`, 2, MM - 3);
}

// ─── HUD ─────────────────────────────────────────────────────
const hudHpBar   = document.getElementById("hud-hp-bar");
const hudHpNum   = document.getElementById("hud-hp-num");
const hudCoins   = document.getElementById("hud-coins-num");
const hudName    = document.getElementById("hud-name");
const killFeed   = document.getElementById("hud-kill-feed");
const deathScreen= document.getElementById("death-screen");
const killBanner = document.getElementById("kill-banner");
const dmgFlash   = document.getElementById("damage-flash");

function updateHUD() {
  const hp = Math.max(0, me.hp);
  hudHpBar.style.width = hp + "%";
  hudHpBar.style.background = hp > 50
    ? "linear-gradient(90deg,#59ff5a,#a8ff78)"
    : hp > 25
    ? "linear-gradient(90deg,#ffcc00,#ffe066)"
    : "linear-gradient(90deg,#ff3333,#ff6666)";
  hudHpNum.textContent = hp;
  hudHpNum.style.color = hp > 50 ? "#59ff5a" : hp > 25 ? "#ffcc00" : "#ff3333";
  hudCoins.textContent = me.coins;
  hudName.textContent  = me.name.toUpperCase();
}

function showDamageFlash() {
  dmgFlash.classList.remove("hit");
  void dmgFlash.offsetWidth;
  dmgFlash.classList.add("hit");
}

function showKillFeed(killer, victim) {
  const el = document.createElement("div");
  el.className = "kill-entry";
  el.textContent = `${killer} ⚡ ${victim}`;
  killFeed.appendChild(el);
  setTimeout(() => el.remove(), 4200);
  if (killer === me.name) showKillBanner(`ĐÃ HẠ GỤC ${victim}`);
}

function showKillBanner(text) {
  killBanner.textContent = text;
  killBanner.classList.remove("hidden");
  killBanner.style.animation = "none";
  void killBanner.offsetWidth;
  killBanner.style.animation = "";
  setTimeout(() => killBanner.classList.add("hidden"), 2600);
}

// ─── CHẾT & HỒI SINH ──────────────────────────────────────────
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
    if (playerRef) playerRef.update({ hp: 100, x: me.x, y: me.y });
  }, 3000);
}

// ─── FIREBASE ─────────────────────────────────────────────────
let playerRef = null, playerId = null;

function initFirebase() {
  const allRef = firebase.database().ref("vlr_players");
  const bulletRef = firebase.database().ref("vlr_bullets");

  allRef.on("child_added", snap => {
    if (snap.key === playerId) return;
    remotePlayers[snap.key] = snap.val();
  });
  allRef.on("child_changed", snap => {
    if (snap.key === playerId) return;
    remotePlayers[snap.key] = snap.val();
  });
  allRef.on("child_removed", snap => {
    delete remotePlayers[snap.key];
    removeRemoteModel(snap.key);
  });

  bulletRef.on("child_added", snap => {
    const b = snap.val();
    if (!b || b.ownerId === playerId) return;
    const mesh = makeBulletMesh();
    mesh.position.set(b.x, b.y, b.z);
    scene.add(mesh);
    bullets.push({ ...b, dist: 0, mesh });
  });

  bulletRef.on("child_removed", snap => {
    const id = snap.key;
    const idx = bullets.findIndex(b => b.id === id);
    if (idx !== -1) {
      scene.remove(bullets[idx].mesh);
      bullets.splice(idx, 1);
    }
  });

  // Dọn đạn cũ
  setInterval(() => {
    const now = Date.now();
    firebase.database().ref("vlr_bullets").once("value", snap => {
      const all = snap.val() || {};
      Object.entries(all).forEach(([id, b]) => {
        if (b.createdAt && now - b.createdAt > 6000)
          firebase.database().ref(`vlr_bullets/${id}`).remove();
      });
    });
  }, 6000);
}

let lastPush = 0;
function pushPosition(now) {
  if (!playerRef || isDead) return;
  if (now - lastPush < 50) return;
  lastPush = now;
  playerRef.update({
    x: parseFloat(me.x.toFixed(3)),
    y: parseFloat(me.y.toFixed(3)),
    angle: parseFloat(me.angle.toFixed(4)),
    hp: me.hp, name: me.name,
    color: me.color, coins: me.coins,
  });
}

// ─── VÒNG LẶP GAME ────────────────────────────────────────────
let lastTime = 0;
function loop(ts) {
  const dt = Math.min(0.1, (ts - lastTime) / 1000);
  lastTime = ts;

  if (!isDead && me.hp <= 0) handleDeath();

  if (!isDead) {
    movePlayer(dt);
    updateBullets(dt);
    pushPosition(ts);
  }

  updateRecoil(dt);
  syncRemoteModels();
  updateHUD();
  drawMinimap();

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

// ─── CHỌN MÀU ─────────────────────────────────────────────────
const PLAYER_COLORS = ["blue","red","orange","yellow","green","purple"];
const COLORS_DISPLAY = {
  blue:"#3366ff",red:"#ff3333",orange:"#ff8800",
  yellow:"#ffee00",green:"#33ff66",purple:"#aa44ff"
};
let selectedColor = "blue";

const colorPicker = document.getElementById("color-picker");
PLAYER_COLORS.forEach(c => {
  const btn = document.createElement("div");
  btn.className = "color-opt" + (c === "blue" ? " selected" : "");
  btn.style.background = COLORS_DISPLAY[c];
  btn.addEventListener("click", () => {
    selectedColor = c;
    document.querySelectorAll(".color-opt").forEach(b => b.classList.remove("selected"));
    btn.classList.add("selected");
  });
  colorPicker.appendChild(btn);
});

// ─── ĐĂNG NHẬP ────────────────────────────────────────────────
const loginOverlay = document.getElementById("login-overlay");
const loginBtn     = document.getElementById("login-btn");
const nameInput    = document.getElementById("player-name-input");

loginBtn.addEventListener("click", startGame);
nameInput.addEventListener("keydown", e => { if (e.key === "Enter") startGame(); });

function startGame() {
  const rawName = nameInput.value.trim().toUpperCase();
  me.name  = rawName || ("LÍNH" + Math.floor(Math.random() * 99));
  me.color = selectedColor;

  loginOverlay.classList.add("hidden");

  firebase.auth().onAuthStateChanged(user => {
    if (!user) return;
    playerId = user.uid;
    me.id    = playerId;

    const spot = randomSpawn();
    me.x = spot.x; me.y = spot.y;
    me.angle = Math.random() * Math.PI * 2;

    // Đặt camera
    camera.position.set(me.x * CELL, WALL_H * 0.45, me.y * CELL);
    camera.rotation.order = "YXZ";
    camera.rotation.y = -me.angle + Math.PI;

    playerRef = firebase.database().ref(`vlr_players/${playerId}`);
    playerRef.set({
      id: playerId, x: me.x, y: me.y,
      angle: me.angle, hp: 100, coins: 0,
      name: me.name, color: me.color,
    });
    playerRef.onDisconnect().remove();

    initFirebase();
    lastTime = performance.now();
    requestAnimationFrame(loop);
  });

  firebase.auth().signInAnonymously().catch(console.error);
}
