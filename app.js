const mapData = {
  minX: 1,
  maxX: 14,
  minY: 4,
  maxY: 12,
  blockedSpaces: {
    "7x4": true,
    "1x11": true,
    "12x10": true,
    "4x7": true,
    "5x7": true,
    "6x7": true,
    "8x6": true,
    "9x6": true,
    "10x6": true,
    "7x9": true,
    "8x9": true,
    "9x9": true,
  },
};

const playerColors = ["blue", "red", "orange", "yellow", "green", "purple"];

function randomFromArray(array) {
  return array[Math.floor(Math.random() * array.length)];
}
function getKeyString(x, y) {
  return `${x}x${y}`;
}

function createName() {
  const prefix = randomFromArray([
    "COOL","SUPER","HIP","SMUG","COOL","SILKY","GOOD","SAFE","DEAR",
    "DAMP","WARM","RICH","LONG","DARK","SOFT","BUFF","DOPE",
  ]);
  const animal = randomFromArray([
    "BEAR","DOG","CAT","FOX","LAMB","LION","BOAR","GOAT","VOLE",
    "SEAL","PUMA","MULE","BULL","BIRD","BUG",
  ]);
  return `${prefix} ${animal}`;
}

function isSolid(x, y) {
  const blockedNextSpace = mapData.blockedSpaces[getKeyString(x, y)];
  return (
    blockedNextSpace ||
    x >= mapData.maxX ||
    x < mapData.minX ||
    y >= mapData.maxY ||
    y < mapData.minY
  );
}

function getRandomSafeSpot() {
  return randomFromArray([
    { x: 1, y: 4 },{ x: 2, y: 4 },{ x: 1, y: 5 },{ x: 2, y: 6 },
    { x: 2, y: 8 },{ x: 2, y: 9 },{ x: 4, y: 8 },{ x: 5, y: 5 },
    { x: 5, y: 8 },{ x: 5, y: 10 },{ x: 5, y: 11 },{ x: 11, y: 7 },
    { x: 12, y: 7 },{ x: 13, y: 7 },{ x: 13, y: 6 },{ x: 13, y: 8 },
    { x: 7, y: 6 },{ x: 7, y: 7 },{ x: 7, y: 8 },{ x: 8, y: 8 },
    { x: 10, y: 8 },{ x: 8, y: 8 },{ x: 11, y: 4 },
  ]);
}

(function () {
  let playerId;
  let playerRef;
  let players = {};
  let playerElements = {};
  let coins = {};
  let coinElements = {};
  let bullets = {};
  let bulletElements = {};

  // WASD key state
  const keysDown = {};

  const gameContainer = document.querySelector(".game-container");
  const playerNameInput = document.querySelector("#player-name");
  const playerColorButton = document.querySelector("#player-color");

  // ─── Coins ───────────────────────────────────────────────────────────────────

  function placeCoin() {
    const { x, y } = getRandomSafeSpot();
    const coinRef = firebase.database().ref(`coins/${getKeyString(x, y)}`);
    coinRef.set({ x, y });
    const coinTimeouts = [2000, 3000, 4000, 5000];
    setTimeout(() => { placeCoin(); }, randomFromArray(coinTimeouts));
  }

  function attemptGrabCoin(x, y) {
    const key = getKeyString(x, y);
    if (coins[key]) {
      firebase.database().ref(`coins/${key}`).remove();
      playerRef.update({ coins: players[playerId].coins + 1 });
    }
  }

  // ─── Movement ─────────────────────────────────────────────────────────────────

  function handleMove(xChange = 0, yChange = 0) {
    if (!players[playerId] || players[playerId].hp <= 0) return;
    const newX = players[playerId].x + xChange;
    const newY = players[playerId].y + yChange;
    if (!isSolid(newX, newY)) {
      players[playerId].x = newX;
      players[playerId].y = newY;
      if (xChange === 1)  players[playerId].direction = "right";
      if (xChange === -1) players[playerId].direction = "left";
      playerRef.set(players[playerId]);
      attemptGrabCoin(newX, newY);
    }
  }

  // WASD continuous movement loop
  let lastMoveTime = 0;
  const MOVE_INTERVAL = 200; // ms between steps

  function wasdLoop(timestamp) {
    if (timestamp - lastMoveTime >= MOVE_INTERVAL) {
      if (keysDown["KeyW"] || keysDown["ArrowUp"])    handleMove(0, -1);
      if (keysDown["KeyS"] || keysDown["ArrowDown"])  handleMove(0, 1);
      if (keysDown["KeyA"] || keysDown["ArrowLeft"])  handleMove(-1, 0);
      if (keysDown["KeyD"] || keysDown["ArrowRight"]) handleMove(1, 0);
      if (Object.values(keysDown).some(Boolean)) lastMoveTime = timestamp;
    }
    requestAnimationFrame(wasdLoop);
  }

  // ─── Bullets ──────────────────────────────────────────────────────────────────

  const BULLET_DAMAGE = 10;
  const BULLET_SPEED  = 80; // px per step in game-world (16px = 1 tile)
  // Bullet travels in real-px coords but we translate to tile for hit detection
  const CELL_SIZE = 16;

  /**
   * Convert game container mouse position → game tile coords
   */
  function getMouseTile(e) {
    const rect = gameContainer.getBoundingClientRect();
    const scale = rect.width / 240; // game-container is 240px wide, scaled 3×
    const px = (e.clientX - rect.left) / scale;
    const py = (e.clientY - rect.top)  / scale;
    return { px, py };
  }

  function shootBullet(e) {
    if (!players[playerId] || players[playerId].hp <= 0) return;

    const me = players[playerId];
    // Origin: center of player tile
    const originPx = me.x * CELL_SIZE + CELL_SIZE / 2;
    const originPy = me.y * CELL_SIZE + CELL_SIZE / 2;

    const { px: targetPx, py: targetPy } = getMouseTile(e);

    const dx = targetPx - originPx;
    const dy = targetPy - originPy;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const vx = dx / len; // normalised direction
    const vy = dy / len;

    const bulletId = firebase.database().ref("bullets").push().key;
    firebase.database().ref(`bullets/${bulletId}`).set({
      id: bulletId,
      ownerId: playerId,
      x: originPx,
      y: originPy,
      vx,
      vy,
      createdAt: firebase.database.ServerValue.TIMESTAMP,
    });
  }

  // Local bullet animation loop
  function animateBullets() {
    const SPEED = 2.5; // px per frame (game-coords, before scale)
    const MAX_DIST = 300;

    Object.entries(bulletElements).forEach(([id, { el, startX, startY, vx, vy, traveledRef }]) => {
      traveledRef.v += SPEED;
      const cx = startX + vx * traveledRef.v;
      const cy = startY + vy * traveledRef.v;

      el.style.transform = `translate3d(${cx}px, ${cy}px, 0)`;

      // Check wall collision
      const tileX = Math.floor(cx / CELL_SIZE);
      const tileY = Math.floor(cy / CELL_SIZE);
      if (isSolid(tileX, tileY) || traveledRef.v > MAX_DIST) {
        // Remove bullet
        firebase.database().ref(`bullets/${id}`).remove();
        return;
      }

      // Check player collision
      Object.entries(players).forEach(([pid, p]) => {
        if (pid === bulletElements[id]?.ownerId) return;
        if (p.hp <= 0) return;
        const px = p.x * CELL_SIZE + CELL_SIZE / 2;
        const py = p.y * CELL_SIZE + CELL_SIZE / 2;
        const dist = Math.sqrt((cx - px) ** 2 + (cy - py) ** 2);
        if (dist < 8) {
          firebase.database().ref(`bullets/${id}`).remove();
          // Only the bullet owner deals damage to avoid duplicate writes
          if (bulletElements[id]?.ownerId === playerId) {
            const newHp = Math.max(0, (p.hp ?? 100) - BULLET_DAMAGE);
            firebase.database().ref(`players/${pid}`).update({ hp: newHp });
          }
        }
      });
    });

    requestAnimationFrame(animateBullets);
  }

  // ─── HP & Respawn ─────────────────────────────────────────────────────────────

  function handleDeath(pid) {
    if (pid !== playerId) return; // only handle our own death locally
    setTimeout(() => {
      const { x, y } = getRandomSafeSpot();
      playerRef.update({ hp: 100, x, y });
    }, 3000); // 3 second respawn
  }

  // ─── DOM helpers ──────────────────────────────────────────────────────────────

  function updateHpBar(el, hp) {
    const bar = el.querySelector(".Character_hp-bar-fill");
    if (bar) {
      const pct = Math.max(0, Math.min(100, hp ?? 100));
      bar.style.width = pct + "%";
      bar.style.background = pct > 50 ? "#59ff5a" : pct > 25 ? "#ffcc00" : "#ff3333";
    }
    // Grey out dead players
    const sprite = el.querySelector(".Character_sprite");
    if (sprite) sprite.style.opacity = (hp <= 0) ? "0.3" : "1";
  }

  // ─── Game Init ────────────────────────────────────────────────────────────────

  function initGame() {

    // Arrow keys (legacy)
    new KeyPressListener("ArrowUp",    () => handleMove(0, -1));
    new KeyPressListener("ArrowDown",  () => handleMove(0, 1));
    new KeyPressListener("ArrowLeft",  () => handleMove(-1, 0));
    new KeyPressListener("ArrowRight", () => handleMove(1, 0));

    // WASD — track held state
    document.addEventListener("keydown", (e) => {
      if (["KeyW","KeyA","KeyS","KeyD"].includes(e.code)) {
        keysDown[e.code] = true;
      }
    });
    document.addEventListener("keyup", (e) => {
      keysDown[e.code] = false;
    });
    requestAnimationFrame(wasdLoop);

    // Shooting
    gameContainer.addEventListener("click", shootBullet);

    // Firebase refs
    const allPlayersRef = firebase.database().ref("players");
    const allCoinsRef   = firebase.database().ref("coins");
    const allBulletsRef = firebase.database().ref("bullets");

    // ── Players ──
    allPlayersRef.on("value", (snapshot) => {
      players = snapshot.val() || {};
      Object.keys(players).forEach((key) => {
        const s = players[key];
        const el = playerElements[key];
        if (!el) return;
        el.querySelector(".Character_name").innerText  = s.name;
        el.querySelector(".Character_coins").innerText = s.coins;
        el.setAttribute("data-color",     s.color);
        el.setAttribute("data-direction", s.direction);
        el.style.transform = `translate3d(${16 * s.x}px, ${16 * s.y - 4}px, 0)`;
        updateHpBar(el, s.hp ?? 100);

        // Death event
        if (s.hp <= 0 && key === playerId) {
          if (!el.dataset.dead) {
            el.dataset.dead = "true";
            handleDeath(key);
          }
        } else {
          delete el.dataset.dead;
        }
      });
    });

    allPlayersRef.on("child_added", (snapshot) => {
      const p = snapshot.val();
      const el = document.createElement("div");
      el.classList.add("Character", "grid-cell");
      if (p.id === playerId) el.classList.add("you");
      el.innerHTML = `
        <div class="Character_shadow grid-cell"></div>
        <div class="Character_sprite grid-cell"></div>
        <div class="Character_name-container">
          <span class="Character_name"></span>
          <span class="Character_coins">0</span>
        </div>
        <div class="Character_you-arrow"></div>
        <div class="Character_hp-bar">
          <div class="Character_hp-bar-fill"></div>
        </div>
      `;
      playerElements[p.id] = el;
      el.querySelector(".Character_name").innerText  = p.name;
      el.querySelector(".Character_coins").innerText = p.coins;
      el.setAttribute("data-color",     p.color);
      el.setAttribute("data-direction", p.direction);
      el.style.transform = `translate3d(${16 * p.x}px, ${16 * p.y - 4}px, 0)`;
      updateHpBar(el, p.hp ?? 100);
      gameContainer.appendChild(el);
    });

    allPlayersRef.on("child_removed", (snapshot) => {
      const removedKey = snapshot.val().id;
      if (playerElements[removedKey]) {
        gameContainer.removeChild(playerElements[removedKey]);
        delete playerElements[removedKey];
      }
    });

    // ── Coins ──
    allCoinsRef.on("value", (snapshot) => { coins = snapshot.val() || {}; });
    allCoinsRef.on("child_added", (snapshot) => {
      const coin = snapshot.val();
      const key = getKeyString(coin.x, coin.y);
      coins[key] = true;
      const el = document.createElement("div");
      el.classList.add("Coin", "grid-cell");
      el.innerHTML = `<div class="Coin_shadow grid-cell"></div><div class="Coin_sprite grid-cell"></div>`;
      el.style.transform = `translate3d(${16 * coin.x}px, ${16 * coin.y - 4}px, 0)`;
      coinElements[key] = el;
      gameContainer.appendChild(el);
    });
    allCoinsRef.on("child_removed", (snapshot) => {
      const { x, y } = snapshot.val();
      const key = getKeyString(x, y);
      if (coinElements[key]) {
        gameContainer.removeChild(coinElements[key]);
        delete coinElements[key];
      }
    });

    // ── Bullets ──
    allBulletsRef.on("child_added", (snapshot) => {
      const b = snapshot.val();
      const el = document.createElement("div");
      el.classList.add("Bullet", "grid-cell");
      el.style.transform = `translate3d(${b.x}px, ${b.y}px, 0)`;
      gameContainer.appendChild(el);
      bulletElements[b.id] = {
        el,
        startX: b.x,
        startY: b.y,
        vx: b.vx,
        vy: b.vy,
        ownerId: b.ownerId,
        traveledRef: { v: 0 },
      };
    });
    allBulletsRef.on("child_removed", (snapshot) => {
      const id = snapshot.val()?.id || snapshot.key;
      if (bulletElements[id]) {
        if (bulletElements[id].el.parentNode) {
          gameContainer.removeChild(bulletElements[id].el);
        }
        delete bulletElements[id];
      }
    });

    // Clean up stale bullets (older than 5s) — run every 5s
    setInterval(() => {
      const now = Date.now();
      firebase.database().ref("bullets").once("value", (snap) => {
        const all = snap.val() || {};
        Object.entries(all).forEach(([id, b]) => {
          if (now - b.createdAt > 5000) {
            firebase.database().ref(`bullets/${id}`).remove();
          }
        });
      });
    }, 5000);

    requestAnimationFrame(animateBullets);

    // ── UI controls ──
    playerNameInput.addEventListener("change", (e) => {
      const newName = e.target.value || createName();
      playerNameInput.value = newName;
      playerRef.update({ name: newName });
    });
    playerColorButton.addEventListener("click", () => {
      const mySkinIndex = playerColors.indexOf(players[playerId].color);
      const nextColor = playerColors[mySkinIndex + 1] || playerColors[0];
      playerRef.update({ color: nextColor });
    });

    placeCoin();
  }

  // ─── Auth ─────────────────────────────────────────────────────────────────────

  firebase.auth().onAuthStateChanged((user) => {
    if (user) {
      playerId = user.uid;
      playerRef = firebase.database().ref(`players/${playerId}`);

      const name = createName();
      playerNameInput.value = name;
      const { x, y } = getRandomSafeSpot();

      playerRef.set({
        id: playerId,
        name,
        direction: "right",
        color: randomFromArray(playerColors),
        x,
        y,
        coins: 0,
        hp: 100,
      });

      playerRef.onDisconnect().remove();
      initGame();
    }
  });

  firebase.auth().signInAnonymously().catch((error) => {
    console.log(error.code, error.message);
  });

})();
