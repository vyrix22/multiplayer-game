const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const timerElement = document.getElementById('timer');
const gameOverScreen = document.getElementById('game-over');
const resultMessage = document.getElementById('result-message');
const playAgainButton = document.getElementById('play-again');
const waitingScreen = document.getElementById('waiting-screen');
const walletDisplay = document.getElementById('wallet-display');
const killsDisplay = document.getElementById('kills-display');
const earningsDisplay = document.getElementById('earnings-display');

// Game state
const state = {
  players: {},
  bullets: new Map(), // Using Map for bullet tracking
  gameTime: 60,
  tick: 0,
  playerId: null,
  wallet: 0,
  kills: 0,
  lastRender: 0,
  bulletIds: new Set()
};

// Canvas setup
canvas.width = 800;
canvas.height = 600;

function resizeCanvas() {
  const container = document.getElementById('game-container');
  const scale = Math.min(container.clientWidth / 800, container.clientHeight / 600);
  canvas.style.width = `${800 * scale}px`;
  canvas.style.height = `${600 * scale}px`;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Socket.IO
const socket = io({
  transports: ['websocket'],
  upgrade: false
});

// Input handling
const keys = {
  up: false,
  down: false,
  left: false,
  right: false
};

window.addEventListener('keydown', (e) => {
  switch (e.key) {
    case 'w': case 'ArrowUp': keys.up = true; break;
    case 's': case 'ArrowDown': keys.down = true; break;
    case 'a': case 'ArrowLeft': keys.left = true; break;
    case 'd': case 'ArrowRight': keys.right = true; break;
  }
  socket.emit('keyUpdate', keys);
});

window.addEventListener('keyup', (e) => {
  switch (e.key) {
    case 'w': case 'ArrowUp': keys.up = false; break;
    case 's': case 'ArrowDown': keys.down = false; break;
    case 'a': case 'ArrowLeft': keys.left = false; break;
    case 'd': case 'ArrowRight': keys.right = false; break;
  }
  socket.emit('keyUpdate', keys);
});

// Shooting
canvas.addEventListener('click', (e) => {
  if (!state.playerId) return;
  
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  
  const mouseX = (e.clientX - rect.left) * scaleX;
  const mouseY = (e.clientY - rect.top) * scaleY;
  
  const player = state.players[state.playerId];
  if (!player) return;
  
  const angle = Math.atan2(mouseY - player.y, mouseX - player.x);
  
  socket.emit('shoot', {
    x: player.x,
    y: player.y,
    angle: angle
  });
});

// Socket events
socket.on('init', (data) => {
  state.playerId = data.playerId;
  state.players = data.players;
  state.tick = data.tick;
  state.gameTime = data.gameTime;
  state.wallet = data.wallet;
  state.kills = data.kills;
  updateWalletDisplay();
  waitingScreen.style.display = 'flex';
});

socket.on('playerJoined', (player) => {
  state.players[player.id] = player;
});

socket.on('gameStart', () => {
  // Reset client state
  state.bullets.clear();
  state.bulletIds.clear();
  state.wallet = 0;
  state.kills = 0;
  updateWalletDisplay();
  
  waitingScreen.style.display = 'none';
  gameOverScreen.style.display = 'none';
  startGameLoop();
});

socket.on('gameUpdate', (snapshot) => {
  state.gameTime = snapshot.gameTime;
  timerElement.textContent = state.gameTime;
  
  // Update players
  for (const [id, player] of Object.entries(snapshot.players)) {
    if (!state.players[id]) state.players[id] = player;
    state.players[id].x = player.x;
    state.players[id].y = player.y;
    state.players[id].health = player.health;
  }
  
  // Update bullets with interpolation
  const now = performance.now();
  const renderDelta = now - state.lastRender;
  state.lastRender = now;
  
  snapshot.bullets.forEach(serverBullet => {
    if (!state.bulletIds.has(serverBullet.id)) {
      // New bullet - add to tracking
      state.bulletIds.add(serverBullet.id);
      state.bullets.set(serverBullet.id, {
        x: serverBullet.x,
        y: serverBullet.y,
        angle: serverBullet.angle,
        speed: 18,
        lastUpdate: now
      });
    } else {
      // Existing bullet - update with interpolation
      const clientBullet = state.bullets.get(serverBullet.id);
      if (clientBullet) {
        // Predict position based on server update
        const serverPos = {
          x: serverBullet.x,
          y: serverBullet.y
        };
        
        // Smooth transition
        const dist = Math.sqrt(
          Math.pow(serverPos.x - clientBullet.x, 2) + 
          Math.pow(serverPos.y - clientBullet.y, 2)
        );
        
        if (dist > 50) {
          // Large discrepancy - snap to server position
          clientBullet.x = serverPos.x;
          clientBullet.y = serverPos.y;
        } else {
          // Small discrepancy - smooth interpolation
          clientBullet.x += (serverPos.x - clientBullet.x) * 0.3;
          clientBullet.y += (serverPos.y - clientBullet.y) * 0.3;
        }
        
        clientBullet.angle = serverBullet.angle;
        clientBullet.lastUpdate = now;
      }
    }
  });
  
  // Remove bullets that disappeared on server
  const serverBulletIds = new Set(snapshot.bullets.map(b => b.id));
  state.bullets.forEach((bullet, id) => {
    if (!serverBulletIds.has(id) && now - bullet.lastUpdate > 100) {
      state.bullets.delete(id);
      state.bulletIds.delete(id);
    }
  });
});

socket.on('kill', (data) => {
  state.wallet = data.wallet;
  state.kills = data.kills;
  updateWalletDisplay();
});

socket.on('gameEnd', (data) => {
  gameOverScreen.style.display = 'flex';
  
  // Find player data
  const playerData = data.players.find(p => p.id === state.playerId);
  if (playerData) {
    state.wallet = playerData.wallet;
    state.kills = playerData.kills;
    updateWalletDisplay();
    
    earningsDisplay.textContent = `Total Earnings: ₹${state.wallet}`;
  }
  
  if (data.winner === state.playerId) {
    resultMessage.textContent = "🏆";
  } else if (data.winner) {
    resultMessage.textContent = "🏆";
  } else {
    resultMessage.textContent = "It's a tie!";
  }
});

socket.on('playerLeft', (id) => {
  delete state.players[id];
});

socket.on('respawn', (data) => {
  if (state.players[state.playerId]) {
    state.players[state.playerId].x = data.x;
    state.players[state.playerId].y = data.y;
    state.players[state.playerId].health = 100;
  }
});

// Game loop
function startGameLoop() {
  let lastTime = performance.now();
  
  function gameLoop(currentTime) {
    const delta = (currentTime - lastTime) / 1000;
    lastTime = currentTime;
    
    // Update bullet positions smoothly
    state.bullets.forEach(bullet => {
      bullet.x += Math.cos(bullet.angle) * bullet.speed * delta * 60;
      bullet.y += Math.sin(bullet.angle) * bullet.speed * delta * 60;
    });
    
    render();
    requestAnimationFrame(gameLoop);
  }
  
  requestAnimationFrame(gameLoop);
}

// Rendering
function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  // Draw players
  Object.values(state.players).forEach(player => {
    // Player circle
    ctx.fillStyle = player.color;
    ctx.beginPath();
    ctx.arc(player.x, player.y, 15, 0, Math.PI * 2);
    ctx.fill();
    
    // Health ring
    const healthAngle = (player.health / 100) * Math.PI * 2;
    ctx.strokeStyle = player.health > 50 ? 'green' : player.health > 25 ? 'orange' : 'red';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(player.x, player.y, 20, -Math.PI/2, -Math.PI/2 + healthAngle);
    ctx.stroke();
    
    // Player name
    ctx.fillStyle = 'yellow';
    ctx.font = '12px "Press Start 2P"';
    ctx.textAlign = 'center';
    ctx.fillText(player.name, player.x, player.y - 30);
  });
  
  // Draw bullets
  ctx.fillStyle = 'white';
  state.bullets.forEach(bullet => {
    ctx.beginPath();
    ctx.arc(bullet.x, bullet.y, 5, 0, Math.PI * 2);
    ctx.fill();
  });
}

// Update wallet display
function updateWalletDisplay() {
  walletDisplay.textContent = `🪙 ₹${state.wallet}`;
  killsDisplay.textContent = `Kills: ${state.kills} (₹${state.kills * 5})`;
}

// Play again
playAgainButton.addEventListener('click', () => {
  socket.emit('requestRestart');
});