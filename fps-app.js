"use strict";
// ═══════════════════════════════════════════════════════════════
//  VÂN LÔ RẦN — Three.js 3D Multiplayer FPS
//  Engine: Three.js r128 — true 3D perspective
//  Network: Firebase Realtime Database
// ═══════════════════════════════════════════════════════════════

// ─── MAP ──────────────────────────────────────────────────────
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

const CELL = 4; // world units per map cell
const WALL_H = 4;
const PLAYER_H = 1.7;

function mapAt(wx, wz) {
  const xi = Math.floor(wx / CELL);
  const zi = Math.floor(wz / CELL);
  if (xi < 0 || xi >= MAP_W || zi < 0 || zi >= MAP_H) return 1;
  return MAP[zi][xi];
}

const SPAWN_SPOTS = [];
for (let z = 1; z < MAP_H-1; z++)
  for (let x = 1; x < MAP_W-1; x++)
    if (MAP[z][x] === 0) SPAWN_SPOTS.push({ x: (x + 0.5)*CELL, z: (z + 0.5)*CELL });

function randomSpawn() {
  return SPAWN_SPOTS[Math.floor(Math.random() * SPAWN_SPOTS.length)];
}

// ─── PLAYER STATE ─────────────────────────────────────────────
let me = {
  x: CELL*1.5, y: PLAYER_H, z: CELL*1.5,
  yaw: 0, pitch: 0,
  hp: 100, coins: 0,
  name: "LÍNH", color: "blue", id: null,
  velY: 0, onGround: true,
  weapon: 1, // 1=dao, 2=súng
};
let isDead = false;

// ─── REMOTE PLAYERS ───────────────────────────────────────────
let remotePlayers = {};

// ─── THREE.JS SETUP ───────────────────────────────────────────
const canvas = document.getElementById("game-canvas");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(0x111122);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x111122, 10, 60);

const camera = new THREE.PerspectiveCamera(80, 1, 0.05, 80);
scene.add(camera);

function resize() {
  const W = window.innerWidth, H = window.innerHeight;
  renderer.setSize(W, H);
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

// ─── LIGHTING ─────────────────────────────────────────────────
const ambient = new THREE.AmbientLight(0x223344, 0.7);
scene.add(ambient);

const dirLight = new THREE.DirectionalLight(0x8899cc, 0.6);
dirLight.position.set(20, 30, 20);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 1024;
dirLight.shadow.mapSize.height = 1024;
scene.add(dirLight);

// Point lights scattered around map for atmosphere
const lightPositions = [
  [8,3,8],[24,3,8],[8,3,24],[24,3,24],[16,3,16],
  [4,3,4],[28,3,4],[4,3,28],[28,3,28]
];
lightPositions.forEach(([lx,ly,lz]) => {
  const pl = new THREE.PointLight(0x0033ff, 0.5, 20);
  pl.position.set(lx*CELL/8, ly, lz*CELL/8);
  scene.add(pl);
});
const redLight = new THREE.PointLight(0xff2200, 0.4, 18);
redLight.position.set(16, 3, 16);
scene.add(redLight);

// ─── WALL MATERIALS ───────────────────────────────────────────
const wallMats = [
  null,
  // Type 1: brown brick
  new THREE.MeshLambertMaterial({
    color: 0x7a3b12,
    emissive: 0x110500,
  }),
  // Type 2: blue slate
  new THREE.MeshLambertMaterial({
    color: 0x1a3a88,
    emissive: 0x050a1a,
  }),
  // Type 3: red brick
  new THREE.MeshLambertMaterial({
    color: 0xaa3311,
    emissive: 0x150500,
  }),
  // Type 4: dark green
  new THREE.MeshLambertMaterial({
    color: 0x1a5522,
    emissive: 0x030a04,
  }),
];

const floorMat = new THREE.MeshLambertMaterial({ color: 0x1a1510, emissive: 0x050402 });
const ceilMat  = new THREE.MeshLambertMaterial({ color: 0x0a0a18, emissive: 0x020205 });

// ─── BUILD MAP GEOMETRY ───────────────────────────────────────
function buildMap() {
  const wallGeo = new THREE.BoxGeometry(CELL, WALL_H, CELL);

  // Floor
  const floorGeo = new THREE.PlaneGeometry(MAP_W * CELL, MAP_H * CELL);
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(MAP_W*CELL/2, 0, MAP_H*CELL/2);
  floor.receiveShadow = true;
  scene.add(floor);

  // Ceiling
  const ceilGeo = new THREE.PlaneGeometry(MAP_W * CELL, MAP_H * CELL);
  const ceil = new THREE.Mesh(ceilGeo, ceilMat);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(MAP_W*CELL/2, WALL_H, MAP_H*CELL/2);
  scene.add(ceil);

  // Walls
  for (let z = 0; z < MAP_H; z++) {
    for (let x = 0; x < MAP_W; x++) {
      const t = MAP[z][x];
      if (t === 0) continue;
      const mat = wallMats[t] || wallMats[1];
      const mesh = new THREE.Mesh(wallGeo, mat);
      mesh.position.set(x*CELL + CELL/2, WALL_H/2, z*CELL + CELL/2);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
    }
  }
}
buildMap();

// ─── REMOTE PLAYER MESHES ─────────────────────────────────────
const playerColors = {
  blue:"#3366ff", red:"#ff3333", orange:"#ff8800",
  yellow:"#ffee00", green:"#33ff66", purple:"#aa44ff"
};
const remoteMeshes = {}; // uid → { body, head, nameLabel }

function getOrCreateRemoteMesh(uid, rp) {
  if (remoteMeshes[uid]) return remoteMeshes[uid];

  const color = new THREE.Color(playerColors[rp.color] || "#888");
  const bodyGeo = new THREE.BoxGeometry(0.7, 1.2, 0.4);
  const bodyMat = new THREE.MeshLambertMaterial({ color });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.castShadow = true;

  const headGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
  const headMat = new THREE.MeshLambertMaterial({ color: 0xe8c070 });
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.y = 0.85;

  const eyeGeo = new THREE.BoxGeometry(0.1, 0.1, 0.01);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
  eyeL.position.set(-0.12, 0.05, 0.26);
  const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
  eyeR.position.set(0.12, 0.05, 0.26);
  head.add(eyeL, eyeR);

  const group = new THREE.Group();
  group.add(body, head);
  scene.add(group);

  // Canvas label
  const labelCanvas = document.createElement("canvas");
  labelCanvas.width = 256; labelCanvas.height = 64;
  const lctx = labelCanvas.getContext("2d");
  lctx.fillStyle = "rgba(0,0,0,0.7)";
  lctx.fillRect(0,0,256,64);
  lctx.fillStyle = "#00ffe7";
  lctx.font = "bold 28px 'Orbitron', monospace";
  lctx.textAlign = "center";
  lctx.fillText((rp.name||"???").toUpperCase(), 128, 40);
  const labelTex = new THREE.CanvasTexture(labelCanvas);
  const labelGeo = new THREE.PlaneGeometry(1.5, 0.4);
  const labelMat = new THREE.MeshBasicMaterial({ map: labelTex, transparent: true, depthWrite: false });
  const label = new THREE.Mesh(labelGeo, labelMat);
  label.position.y = 1.6;
  group.add(label);

  remoteMeshes[uid] = { group, body, head, label };
  return remoteMeshes[uid];
}

function updateRemoteMeshes() {
  // Remove stale
  Object.keys(remoteMeshes).forEach(uid => {
    if (!remotePlayers[uid]) {
      scene.remove(remoteMeshes[uid].group);
      delete remoteMeshes[uid];
    }
  });

  Object.entries(remotePlayers).forEach(([uid, rp]) => {
    if (!rp) return;
    const m = getOrCreateRemoteMesh(uid, rp);
    const wx = rp.x || 0, wz = rp.z || 0;
    m.group.position.set(wx, PLAYER_H - 0.6, wz);
    m.group.rotation.y = -(rp.yaw || 0);
    m.group.visible = (rp.hp || 0) > 0;
    // Billboard label always faces camera
    m.label.lookAt(camera.position);
  });
}

// ─── WEAPON CANVAS (2D overlay) ───────────────────────────────
const wCanvas = document.getElementById("weapon-canvas");
const wCtx    = wCanvas.getContext("2d");
let weaponBob = 0;
let weaponSwing = 0; // for knife slash anim
let knifeAnimT = -1;
let shootAnimT = -1;

function resizeWeaponCanvas() {
  wCanvas.width  = wCanvas.offsetWidth;
  wCanvas.height = wCanvas.offsetHeight;
}
window.addEventListener("resize", resizeWeaponCanvas);
resizeWeaponCanvas();

function drawKnife(ctx, W, H, swing) {
  ctx.clearRect(0, 0, W, H);
  const bob = weaponBob;
  const cx = W * 0.72 + Math.sin(bob)*4;
  const cy = H * 0.55 + Math.abs(Math.sin(bob))*6;

  // Slash anim
  const slashAngle = swing > 0 ? -0.8 + swing*2.5 : 0;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(slashAngle);

  // Handle
  ctx.fillStyle = "#5c3a1a";
  ctx.strokeStyle = "#3a200a";
  ctx.lineWidth = 2;
  roundRect(ctx, -8, 20, 18, 55, 4);
  ctx.fill(); ctx.stroke();

  // Guard
  ctx.fillStyle = "#888";
  ctx.fillRect(-14, 14, 30, 10);
  ctx.strokeRect(-14, 14, 30, 10);

  // Blade
  ctx.beginPath();
  ctx.moveTo(-4, 14);
  ctx.lineTo(8, 14);
  ctx.lineTo(12, -55);
  ctx.lineTo(-3, -50);
  ctx.closePath();
  ctx.fillStyle = swing > 0.3
    ? "#eef8ff"
    : "linear-gradient(0deg, #bbb, #eee)";
  ctx.fillStyle = "#ccddee";
  ctx.strokeStyle = "#9ab";
  ctx.lineWidth = 1;
  ctx.fill(); ctx.stroke();

  // Blade shine
  ctx.beginPath();
  ctx.moveTo(5, 10);
  ctx.lineTo(10, -50);
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Slash effect
  if (swing > 0.1 && swing < 0.8) {
    ctx.beginPath();
    ctx.arc(0, -30, 35, -0.5, 0.5);
    ctx.strokeStyle = "rgba(200,230,255,0.4)";
    ctx.lineWidth = 12;
    ctx.stroke();
  }

  ctx.restore();
}

function drawGun(ctx, W, H, shootT) {
  ctx.clearRect(0, 0, W, H);
  const bob = weaponBob;
  const recoil = shootT > 0 ? Math.sin(shootT * Math.PI) * 14 : 0;
  const cx = W * 0.68 + Math.sin(bob)*3;
  const cy = H * 0.45 + Math.abs(Math.sin(bob))*5 + recoil;

  ctx.save();
  ctx.translate(cx, cy);

  // Barrel
  ctx.fillStyle = "#222";
  ctx.strokeStyle = "#111";
  ctx.lineWidth = 1;
  roundRect(ctx, -5, -80, 14, 80, 3);
  ctx.fill(); ctx.stroke();

  // Muzzle
  ctx.fillStyle = "#333";
  ctx.fillRect(-7, -85, 18, 8);

  // Body
  ctx.fillStyle = "#2a2a2a";
  roundRect(ctx, -12, -30, 38, 55, 5);
  ctx.fill(); ctx.stroke();

  // Slide top
  ctx.fillStyle = "#333";
  roundRect(ctx, -10, -55, 30, 30, 3);
  ctx.fill();

  // Grip
  ctx.fillStyle = "#1a1a1a";
  roundRect(ctx, -5, 20, 20, 40, 4);
  ctx.fill();

  // Trigger guard
  ctx.beginPath();
  ctx.arc(10, 25, 12, 0.2, Math.PI - 0.2);
  ctx.strokeStyle = "#555";
  ctx.lineWidth = 3;
  ctx.stroke();

  // Trigger
  ctx.beginPath();
  ctx.moveTo(8, 18); ctx.lineTo(12, 28);
  ctx.strokeStyle = "#888";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Sight
  ctx.fillStyle = "#00ffe7";
  ctx.fillRect(-2, -88, 4, 4);
  ctx.fillRect(8, -88, 4, 4);

  // Muzzle flash
  if (shootT > 0.6) {
    const intensity = (shootT - 0.6) / 0.4;
    ctx.save();
    ctx.globalAlpha = intensity;
    const grad = ctx.createRadialGradient(2, -90, 0, 2, -90, 25);
    grad.addColorStop(0, "#fff");
    grad.addColorStop(0.3, "#ffee44");
    grad.addColorStop(1, "transparent");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(2, -90, 25 * intensity, 0, Math.PI*2);
    ctx.fill();
    // Sparks
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const r = 10 + Math.random() * 15;
      ctx.strokeStyle = "#ffcc00";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(2, -90);
      ctx.lineTo(2 + Math.cos(a)*r, -90 + Math.sin(a)*r);
      ctx.stroke();
    }
    ctx.restore();
  }

  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.lineTo(x+w-r, y);
  ctx.quadraticCurveTo(x+w, y, x+w, y+r);
  ctx.lineTo(x+w, y+h-r);
  ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
  ctx.lineTo(x+r, y+h);
  ctx.quadraticCurveTo(x, y+h, x, y+h-r);
  ctx.lineTo(x, y+r);
  ctx.quadraticCurveTo(x, y, x+r, y);
  ctx.closePath();
}

function drawWeapon(dt) {
  const W = wCanvas.width, H = wCanvas.height;
  if (W < 10 || H < 10) return;

  // Bob
  const isMoving = keys["KeyW"]||keys["KeyS"]||keys["KeyA"]||keys["KeyD"]||joystickActive;
  if (isMoving) weaponBob += dt * 5;

  if (me.weapon === 1) {
    if (knifeAnimT > 0) {
      knifeAnimT -= dt * 2.5;
      weaponSwing = knifeAnimT;
    } else {
      weaponSwing = 0;
    }
    drawKnife(wCtx, W, H, weaponSwing);
  } else {
    if (shootAnimT > 0) shootAnimT -= dt * 3;
    drawGun(wCtx, W, H, shootAnimT);
  }
}

// ─── BULLET TRACERS (3D lines) ─────────────────────────────────
const BULLET_SPEED = 60; // units/s (very fast)
const BULLET_DAMAGE = 10;
const BULLET_MAX_DIST = 60;
const KNIFE_DAMAGE = 30;
const KNIFE_REACH = 3.0;

let bullets = []; // { x,y,z, dx,dy,dz, dist, id, ownerId, line }
let tracerLines = []; // { line, life }

function createTracerLine(x1,y1,z1, x2,y2,z2) {
  const points = [new THREE.Vector3(x1,y1,z1), new THREE.Vector3(x2,y2,z2)];
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const mat = new THREE.LineBasicMaterial({
    color: 0xffee33,
    transparent: true,
    opacity: 1,
    linewidth: 2,
  });
  const line = new THREE.Line(geo, mat);
  scene.add(line);
  return line;
}

function updateBullets(dt) {
  bullets = bullets.filter(b => {
    const step = BULLET_SPEED * dt;
    const px = b.x, py = b.y, pz = b.z;
    b.x += b.dx * step;
    b.y += b.dy * step;
    b.z += b.dz * step;
    b.dist += step;

    // Tracer
    if (b.ownerId === me.id) {
      const line = createTracerLine(px, py, pz, b.x, b.y, b.z);
      tracerLines.push({ line, life: 0.08 });
    }

    // Hit wall
    if (mapAt(b.x, b.z) > 0 || b.y < 0 || b.y > WALL_H || b.dist > BULLET_MAX_DIST) {
      if (b.ownerId === me.id)
        firebase.database().ref(`fps_bullets/${b.id}`).remove();
      // Spark effect at wall
      createWallSpark(b.x, b.y, b.z);
      return false;
    }

    // Hit remote player
    if (b.ownerId === me.id) {
      for (const [uid, rp] of Object.entries(remotePlayers)) {
        if (!rp || (rp.hp||0) <= 0) continue;
        const dx = b.x - (rp.x||0), dy = b.y - PLAYER_H, dz = b.z - (rp.z||0);
        if (Math.sqrt(dx*dx+dy*dy+dz*dz) < 0.8) {
          firebase.database().ref(`fps_bullets/${b.id}/hitTarget`).set(uid);
          firebase.database().ref(`fps_bullets/${b.id}`).remove();
          showKillFeed(me.name, rp.name||uid, false);
          me.coins = (me.coins||0) + 10;
          return false;
        }
      }
    }

    // Someone else hits me
    if (b.ownerId !== me.id && !hitBullets.has(b.id) && me.hp > 0) {
      const dx = b.x - me.x, dy = b.y - me.y, dz = b.z - me.z;
      if (Math.sqrt(dx*dx+dy*dy+dz*dz) < 0.7) {
        hitBullets.add(b.id);
        const newHp = Math.max(0, me.hp - BULLET_DAMAGE);
        playerRef.update({ hp: newHp });
        me.hp = newHp;
        showDamageFlash();
        return false;
      }
    }
    return true;
  });

  // Update tracers
  tracerLines = tracerLines.filter(t => {
    t.life -= dt;
    t.line.material.opacity = Math.max(0, t.life * 12);
    if (t.life <= 0) {
      scene.remove(t.line);
      t.line.geometry.dispose();
      t.line.material.dispose();
      return false;
    }
    return true;
  });
}

// Spark particles at wall hit
const sparks = [];
function createWallSpark(x, y, z) {
  for (let i = 0; i < 5; i++) {
    const geo = new THREE.SphereGeometry(0.04, 4, 4);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffcc00 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    scene.add(mesh);
    sparks.push({
      mesh,
      vx: (Math.random()-0.5)*4,
      vy: (Math.random()+0.5)*3,
      vz: (Math.random()-0.5)*4,
      life: 0.3+Math.random()*0.2
    });
  }
}
function updateSparks(dt) {
  for (let i = sparks.length-1; i >= 0; i--) {
    const s = sparks[i];
    s.mesh.position.x += s.vx*dt;
    s.mesh.position.y += s.vy*dt;
    s.mesh.position.z += s.vz*dt;
    s.vy -= 12*dt;
    s.life -= dt;
    s.mesh.material.opacity = s.life * 4;
    if (s.life <= 0) {
      scene.remove(s.mesh);
      sparks.splice(i,1);
    }
  }
}

function fireBullet() {
  if (isDead || me.weapon !== 2) return;
  const id = firebase.database().ref("fps_bullets").push().key;
  const yaw = me.yaw, pitch = me.pitch;
  const dx = -Math.sin(yaw)*Math.cos(pitch);
  const dy = Math.sin(pitch);
  const dz = -Math.cos(yaw)*Math.cos(pitch);
  const b = {
    id, ownerId: me.id,
    x: me.x + dx*0.3, y: me.y, z: me.z + dz*0.3,
    dx, dy, dz,
    createdAt: firebase.database.ServerValue.TIMESTAMP,
  };
  firebase.database().ref(`fps_bullets/${id}`).set(b);
  bullets.push({ ...b, dist: 0 });

  // Shoot anim
  shootAnimT = 1.0;

  // Recoil camera pitch
  me.pitch = Math.min(Math.PI/2, me.pitch + 0.04);
}

function knifeAttack() {
  if (isDead || me.weapon !== 1) return;
  knifeAnimT = 1.0;

  // Check range
  for (const [uid, rp] of Object.entries(remotePlayers)) {
    if (!rp || (rp.hp||0) <= 0) continue;
    const dx = (rp.x||0) - me.x, dz = (rp.z||0) - me.z;
    const dist = Math.sqrt(dx*dx+dz*dz);
    // Check angle
    const toEnemy = Math.atan2(dx, dz);
    let angleDiff = toEnemy - me.yaw;
    while (angleDiff > Math.PI) angleDiff -= Math.PI*2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI*2;
    if (dist < KNIFE_REACH && Math.abs(angleDiff) < 0.7) {
      firebase.database().ref(`fps_bullets`).push({
        id: "knife_" + Date.now(),
        ownerId: me.id,
        x: me.x, y: me.y, z: me.z,
        dx: 0, dy: 0, dz: 0,
        knifeHit: uid,
        createdAt: firebase.database.ServerValue.TIMESTAMP,
      });
      showKillFeed(me.name, rp.name||uid, false);
      me.coins = (me.coins||0) + 5;
    }
  }
}

let hitBullets = new Set();

// ─── PHYSICS / MOVEMENT ───────────────────────────────────────
const MOVE_SPEED = 12;
const GRAVITY = -28;
const JUMP_VEL = 9;

// Joystick state
let joystickActive = false;
let joyX = 0, joyZ = 0;

function movePlayer(dt) {
  if (isDead) return;

  // Horizontal movement
  let moveX = 0, moveZ = 0;
  const cos = Math.cos(me.yaw), sin = Math.sin(me.yaw);

  if (keys["KeyW"] || keys["ArrowUp"])    { moveX -= sin; moveZ -= cos; }
  if (keys["KeyS"] || keys["ArrowDown"])  { moveX += sin; moveZ += cos; }
  if (keys["KeyA"])                        { moveX -= cos; moveZ += sin; }
  if (keys["KeyD"])                        { moveX += cos; moveZ -= sin; }

  // Joystick
  if (joystickActive) {
    moveX += joyX * cos - joyZ * sin;
    moveZ += joyX * sin + joyZ * cos;
  }

  const len = Math.sqrt(moveX*moveX+moveZ*moveZ);
  if (len > 1) { moveX/=len; moveZ/=len; }

  const nx = me.x + moveX * MOVE_SPEED * dt;
  const nz = me.z + moveZ * MOVE_SPEED * dt;
  const margin = 0.4;

  if (mapAt(nx + margin * Math.sign(moveX), me.z) === 0 &&
      mapAt(nx - margin * Math.sign(moveX), me.z) === 0)
    me.x = nx;
  if (mapAt(me.x, nz + margin * Math.sign(moveZ)) === 0 &&
      mapAt(me.x, nz - margin * Math.sign(moveZ)) === 0)
    me.z = nz;

  // Gravity & jump
  me.velY += GRAVITY * dt;
  me.y += me.velY * dt;
  if (me.y <= PLAYER_H) {
    me.y = PLAYER_H;
    me.velY = 0;
    me.onGround = true;
  } else {
    me.onGround = false;
  }

  if ((keys["Space"] || mobileJump) && me.onGround) {
    me.velY = JUMP_VEL;
    me.onGround = false;
    mobileJump = false;
  }

  // Camera rotation (keyboard fallback)
  if (!pointerLocked && !touchLookActive) {
    if (keys["ArrowLeft"]  || keys["KeyQ"]) me.yaw += 1.5 * dt;
    if (keys["ArrowRight"] || keys["KeyE"]) me.yaw -= 1.5 * dt;
  }

  // Clamp pitch
  me.pitch = Math.max(-Math.PI/2.5, Math.min(Math.PI/2.5, me.pitch));

  // Update camera
  camera.position.set(me.x, me.y, me.z);
  camera.rotation.order = "YXZ";
  camera.rotation.y = me.yaw;
  camera.rotation.x = me.pitch;
}

// ─── MINIMAP ──────────────────────────────────────────────────
const mmCanvas = document.createElement("canvas");
mmCanvas.style.cssText = "position:fixed;bottom:16px;right:16px;z-index:15;border:1px solid #00ffe733;opacity:0.8;";
const MM = 140, MC = MM / MAP_W;
mmCanvas.width = MM; mmCanvas.height = MM;
document.body.appendChild(mmCanvas);
const mmCtx = mmCanvas.getContext("2d");

function drawMinimap() {
  mmCtx.clearRect(0, 0, MM, MM);
  mmCtx.fillStyle = "rgba(0,0,0,0.6)";
  mmCtx.fillRect(0, 0, MM, MM);

  for (let z = 0; z < MAP_H; z++) {
    for (let x = 0; x < MAP_W; x++) {
      const t = MAP[z][x];
      mmCtx.fillStyle = t > 0
        ? ["#000","#6b3a1f","#1a3d88","#882211","#144d28"][t]||"#444"
        : "rgba(255,255,255,0.05)";
      mmCtx.fillRect(x*MC, z*MC, MC, MC);
    }
  }

  // Remote players
  Object.values(remotePlayers).forEach(rp => {
    if (!rp || (rp.hp||0) <= 0) return;
    const rx = (rp.x||0)/CELL * MC, rz = (rp.z||0)/CELL * MC;
    const col = playerColors[rp.color] || "#fff";
    mmCtx.fillStyle = col;
    mmCtx.beginPath();
    mmCtx.arc(rx, rz, 3, 0, Math.PI*2);
    mmCtx.fill();
  });

  // Self
  const mx = me.x/CELL * MC, mz = me.z/CELL * MC;
  mmCtx.fillStyle = "#00ffe7";
  mmCtx.beginPath();
  mmCtx.arc(mx, mz, 3.5, 0, Math.PI*2);
  mmCtx.fill();
  mmCtx.strokeStyle = "#00ffe7";
  mmCtx.lineWidth = 1;
  mmCtx.beginPath();
  mmCtx.moveTo(mx, mz);
  mmCtx.lineTo(mx - Math.sin(me.yaw)*8, mz - Math.cos(me.yaw)*8);
  mmCtx.stroke();
}

// ─── HUD ──────────────────────────────────────────────────────
const hudHpBar     = document.getElementById("hud-hp-bar");
const hudHpNum     = document.getElementById("hud-hp-num");
const hudName      = document.getElementById("hud-name");
const killFeed     = document.getElementById("hud-kill-feed");
const deathScreen  = document.getElementById("death-screen");
const killBanner   = document.getElementById("kill-banner");
const dmgFlash     = document.getElementById("damage-flash");
const hudWeaponName= document.getElementById("hud-weapon-name");
const hudWeaponIcon= document.getElementById("hud-weapon-icon");
const crosshair    = document.getElementById("crosshair");

function updateHUD() {
  const hp = Math.max(0, me.hp);
  hudHpBar.style.width = hp + "%";
  hudHpBar.style.background = hp > 50
    ? "linear-gradient(90deg,#59ff5a,#a8ff78)"
    : hp > 25
    ? "linear-gradient(90deg,#ffcc00,#ffe066)"
    : "linear-gradient(90deg,#ff3333,#ff6666)";
  hudHpNum.textContent = hp;
  hudName.textContent  = me.name.toUpperCase();

  if (me.weapon === 1) {
    hudWeaponIcon.textContent = "🗡️";
    hudWeaponName.textContent = "DAO";
    crosshair.classList.add("knife-mode");
  } else {
    hudWeaponIcon.textContent = "🔫";
    hudWeaponName.textContent = "SÚNG";
    crosshair.classList.remove("knife-mode");
  }
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
  if (killer === me.name) showKillBanner(`TIÊU DIỆT ${victim}`);
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
let pointerLocked = false;
const MOUSE_SENS = 0.002;

document.addEventListener("keydown", e => {
  keys[e.code] = true;
  if (e.code === "Digit1") switchWeapon(1);
  if (e.code === "Digit2") switchWeapon(2);
});
document.addEventListener("keyup", e => { keys[e.code] = false; });

canvas.addEventListener("click", () => canvas.requestPointerLock());
document.addEventListener("pointerlockchange", () => {
  pointerLocked = document.pointerLockElement === canvas;
});

document.addEventListener("mousemove", e => {
  if (!pointerLocked) return;
  me.yaw   -= e.movementX * MOUSE_SENS;
  me.pitch -= e.movementY * MOUSE_SENS;
});

let lastShot = 0;
const FIRE_RATE_GUN = 250;
const FIRE_RATE_KNIFE = 500;

document.addEventListener("mousedown", e => {
  if (!pointerLocked || e.button !== 0) return;
  doAttack();
});

function doAttack() {
  const now = Date.now();
  const rate = me.weapon === 1 ? FIRE_RATE_KNIFE : FIRE_RATE_GUN;
  if (now - lastShot < rate) return;
  lastShot = now;
  if (me.weapon === 2) fireBullet();
  else knifeAttack();
}

function switchWeapon(w) {
  me.weapon = w;
}

// ─── MOBILE CONTROLS ──────────────────────────────────────────
const mobileControls = document.getElementById("mobile-controls");
let mobileJump = false;
let touchLookActive = false;
let lookTouchId = null, lookLastX = 0, lookLastY = 0;

function detectTouch() {
  if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
    mobileControls.classList.add("active");
    mmCanvas.style.bottom = "200px";
  }
}
detectTouch();

// Joystick
const joyZone   = document.getElementById("joystick-zone");
const joyBase   = document.getElementById("joystick-base");
const joyKnob   = document.getElementById("joystick-knob");
let joyTouchId  = null;
let joyBaseX = 0, joyBaseY = 0;
const JOY_RADIUS = 50;

joyZone.addEventListener("touchstart", e => {
  e.preventDefault();
  const t = e.changedTouches[0];
  joyTouchId = t.identifier;
  const rect = joyBase.getBoundingClientRect();
  joyBaseX = rect.left + rect.width/2;
  joyBaseY = rect.top  + rect.height/2;
  joystickActive = true;
}, { passive: false });

joyZone.addEventListener("touchmove", e => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier !== joyTouchId) continue;
    const dx = t.clientX - joyBaseX;
    const dy = t.clientY - joyBaseY;
    const dist = Math.sqrt(dx*dx+dy*dy);
    const clamp = Math.min(dist, JOY_RADIUS);
    const angle = Math.atan2(dy, dx);
    const nx = Math.cos(angle)*clamp, ny = Math.sin(angle)*clamp;
    joyKnob.style.transform = `translate(calc(-50% + ${nx}px), calc(-50% + ${ny}px))`;
    joyX = nx / JOY_RADIUS;
    joyZ = ny / JOY_RADIUS;
  }
}, { passive: false });

joyZone.addEventListener("touchend", e => {
  for (const t of e.changedTouches) {
    if (t.identifier === joyTouchId) {
      joyTouchId = null; joystickActive = false;
      joyX = 0; joyZ = 0;
      joyKnob.style.transform = "translate(-50%,-50%)";
    }
  }
});

// Look zone
const lookZone = document.getElementById("look-zone");
lookZone.addEventListener("touchstart", e => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (lookTouchId === null) {
      lookTouchId = t.identifier;
      lookLastX = t.clientX; lookLastY = t.clientY;
      touchLookActive = true;
    }
  }
}, { passive: false });

lookZone.addEventListener("touchmove", e => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier !== lookTouchId) continue;
    const dx = t.clientX - lookLastX;
    const dy = t.clientY - lookLastY;
    me.yaw   -= dx * 0.004;
    me.pitch -= dy * 0.004;
    lookLastX = t.clientX; lookLastY = t.clientY;
  }
}, { passive: false });

lookZone.addEventListener("touchend", e => {
  for (const t of e.changedTouches) {
    if (t.identifier === lookTouchId) {
      lookTouchId = null; touchLookActive = false;
    }
  }
});

// Buttons
document.getElementById("btn-fire").addEventListener("touchstart", e => {
  e.preventDefault(); doAttack();
}, { passive: false });
document.getElementById("btn-jump").addEventListener("touchstart", e => {
  e.preventDefault(); mobileJump = true;
}, { passive: false });
document.getElementById("btn-weapon").addEventListener("touchstart", e => {
  e.preventDefault(); switchWeapon(me.weapon === 1 ? 2 : 1);
}, { passive: false });

// ─── FIREBASE ─────────────────────────────────────────────────
let playerRef = null, playerId = null;

function initFirebase() {
  const allPlayersRef = firebase.database().ref("fps3d_players");
  const allBulletsRef = firebase.database().ref("fps_bullets");

  allPlayersRef.on("child_added",   snap => { if (snap.key !== playerId) remotePlayers[snap.key] = snap.val(); });
  allPlayersRef.on("child_changed", snap => { if (snap.key !== playerId) remotePlayers[snap.key] = snap.val(); });
  allPlayersRef.on("child_removed", snap => {
    delete remotePlayers[snap.key];
    if (remoteMeshes[snap.key]) { scene.remove(remoteMeshes[snap.key].group); delete remoteMeshes[snap.key]; }
  });

  allBulletsRef.on("child_added", snap => {
    const b = snap.val();
    if (!b || b.ownerId === playerId) return;
    // Knife hit on me
    if (b.knifeHit === playerId) {
      const newHp = Math.max(0, me.hp - KNIFE_DAMAGE);
      playerRef.update({ hp: newHp });
      me.hp = newHp;
      showDamageFlash();
      firebase.database().ref(`fps_bullets/${snap.key}`).remove();
      return;
    }
    bullets.push({ ...b, dist: 0 });
  });

  allBulletsRef.on("child_changed", snap => {
    const b = snap.val();
    if (!b) return;
    if (b.hitTarget === playerId && !hitBullets.has(snap.key)) {
      hitBullets.add(snap.key);
      const newHp = Math.max(0, me.hp - BULLET_DAMAGE);
      playerRef.update({ hp: newHp });
      me.hp = newHp;
      showDamageFlash();
    }
  });

  setInterval(() => {
    const now = Date.now();
    firebase.database().ref("fps_bullets").once("value", snap => {
      const all = snap.val() || {};
      Object.entries(all).forEach(([id, b]) => {
        if (b.createdAt && now - b.createdAt > 5000)
          firebase.database().ref(`fps_bullets/${id}`).remove();
      });
    });
  }, 5000);
}

let lastPush = 0;
function pushPosition(now) {
  if (!playerRef || isDead) return;
  if (now - lastPush < 50) return;
  lastPush = now;
  playerRef.update({
    x: parseFloat(me.x.toFixed(2)),
    y: parseFloat(me.y.toFixed(2)),
    z: parseFloat(me.z.toFixed(2)),
    yaw: parseFloat(me.yaw.toFixed(3)),
    hp: me.hp, name: me.name, color: me.color, coins: me.coins,
    weapon: me.weapon,
  });
}

// ─── RESPAWN ──────────────────────────────────────────────────
function handleDeath() {
  isDead = true;
  deathScreen.classList.remove("hidden");
  setTimeout(() => {
    const spot = randomSpawn();
    me.x = spot.x; me.z = spot.z; me.y = PLAYER_H;
    me.yaw = Math.random() * Math.PI * 2;
    me.hp = 100; me.velY = 0;
    isDead = false;
    deathScreen.classList.add("hidden");
    if (playerRef) playerRef.update({ hp: 100, x: me.x, z: me.z });
  }, 3000);
}

// ─── MAIN LOOP ─────────────────────────────────────────────────
let lastTime = 0;
function loop(ts) {
  const dt = Math.min(0.05, (ts - lastTime) / 1000);
  lastTime = ts;

  if (!isDead && me.hp <= 0) handleDeath();

  if (!isDead) {
    movePlayer(dt);
    updateBullets(dt);
    updateSparks(dt);
    pushPosition(ts);
  }

  updateRemoteMeshes();
  renderer.render(scene, camera);
  drawWeapon(dt);
  drawMinimap();
  updateHUD();

  requestAnimationFrame(loop);
}

// ─── LOGIN / START ─────────────────────────────────────────────
const loginOverlay = document.getElementById("login-overlay");
const loginBtn     = document.getElementById("login-btn");
const nameInput    = document.getElementById("player-name-input");

loginBtn.addEventListener("click", startGame);
nameInput.addEventListener("keydown", e => { if (e.key === "Enter") startGame(); });

const PLAYER_COLORS = ["blue","red","orange","yellow","green","purple"];

function startGame() {
  const rawName = nameInput.value.trim().toUpperCase();
  me.name  = rawName || ("LÍNH" + Math.floor(Math.random()*99));
  me.color = PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)];

  loginOverlay.classList.add("hidden");

  firebase.auth().onAuthStateChanged(user => {
    if (!user) return;
    playerId = user.uid;
    me.id    = playerId;

    const spot = randomSpawn();
    me.x = spot.x; me.z = spot.z; me.y = PLAYER_H;
    me.yaw = Math.random() * Math.PI * 2;

    playerRef = firebase.database().ref(`fps3d_players/${playerId}`);
    playerRef.set({
      id: playerId, x: me.x, y: me.y, z: me.z,
      yaw: me.yaw, hp: 100, coins: 0,
      name: me.name, color: me.color, weapon: me.weapon,
    });
    playerRef.onDisconnect().remove();

    initFirebase();
    lastTime = performance.now();
    requestAnimationFrame(loop);
  });

  firebase.auth().signInAnonymously().catch(console.error);
}
