const express = require('express');
const http = require('http');
const socketio = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketio(server, {
  pingInterval: 10000,
  pingTimeout: 5000,
  transports: ['websocket']
});

// Game constants
const TICK_RATE = 30;
const BULLET_SPEED = 18; // Increased for smoother movement
const PLAYER_SPEED = 7;
const PLAYER_RADIUS = 15;
const BULLET_RADIUS = 5;

// Game state
let gameState = {
  players: {},
  bullets: [],
  gameTime: 60,
  lastUpdate: Date.now(),
  tick: 0,
  gameActive: false
};

app.use(express.static(path.join(__dirname, 'public')));

// Efficient collision detection
function checkCollision(x1, y1, r1, x2, y2, r2) {
  const dx = x1 - x2;
  const dy = y1 - y2;
  return dx * dx + dy * dy <= (r1 + r2) * (r1 + r2);
}

// Game loop
const gameLoop = setInterval(() => {
  if (!gameState.gameActive) return;
  
  const now = Date.now();
  gameState.lastUpdate = now;
  gameState.tick++;

  // Update players
  Object.values(gameState.players).forEach(player => {
    if (player.keys.up) player.y -= PLAYER_SPEED;
    if (player.keys.down) player.y += PLAYER_SPEED;
    if (player.keys.left) player.x -= PLAYER_SPEED;
    if (player.keys.right) player.x += PLAYER_SPEED;
    
    player.x = Math.max(PLAYER_RADIUS, Math.min(800 - PLAYER_RADIUS, player.x));
    player.y = Math.max(PLAYER_RADIUS, Math.min(600 - PLAYER_RADIUS, player.y));
  });
  
  // Update bullets
  gameState.bullets = gameState.bullets.filter(bullet => {
    bullet.x += Math.cos(bullet.angle) * BULLET_SPEED;
    bullet.y += Math.sin(bullet.angle) * BULLET_SPEED;
    
    if (bullet.x < -50 || bullet.x > 850 || bullet.y < -50 || bullet.y > 650) {
      return false;
    }
    
    for (const player of Object.values(gameState.players)) {
      if (player.id !== bullet.playerId && player.health > 0) {
        if (checkCollision(bullet.x, bullet.y, BULLET_RADIUS, player.x, player.y, PLAYER_RADIUS)) {
          player.health -= bullet.damage;
          if (player.health <= 0) {
            player.health = 0;
            const shooter = gameState.players[bullet.playerId];
            if (shooter) {
              shooter.wallet += 5;
              shooter.kills = (shooter.kills || 0) + 1;
              io.to(bullet.playerId).emit('kill', { 
                wallet: shooter.wallet, 
                kills: shooter.kills 
              });
            }
            setTimeout(() => {
              player.health = 100;
              player.x = player.id === Object.keys(gameState.players)[0] ? 100 : 700;
              player.y = 300;
              io.to(player.id).emit('respawn', { x: player.x, y: player.y });
            }, 2000);
          }
          return false;
        }
      }
    }
    return true;
  });
  
  // Send optimized game state
  if (gameState.tick % 2 === 0) {
    const snapshot = {
      players: {},
      bullets: gameState.bullets.map(b => ({
        id: b.id, // Added bullet ID for tracking
        x: b.x, 
        y: b.y, 
        angle: b.angle 
      })),
      gameTime: gameState.gameTime,
      tick: gameState.tick
    };
    
    for (const [id, player] of Object.entries(gameState.players)) {
      snapshot.players[id] = {
        x: player.x,
        y: player.y,
        health: player.health
      };
    }
    
    io.emit('gameUpdate', snapshot);
  }
}, 1000 / TICK_RATE);

// Socket.IO
io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);
  
  const isPlayer1 = Object.keys(gameState.players).length === 0;
  gameState.players[socket.id] = {
    id: socket.id,
    name: isPlayer1 ? 'Player 1' : 'Player 2',
    x: isPlayer1 ? 100 : 700,
    y: 300,
    health: 100,
    wallet: 0,
    kills: 0,
    keys: { up: false, down: false, left: false, right: false },
    lastShot: 0,
    color: isPlayer1 ? '#FFD700' : '#FFD700'
  };
  
  socket.emit('init', { 
    playerId: socket.id,
    tick: gameState.tick,
    players: gameState.players,
    gameTime: gameState.gameTime,
    wallet: 0,
    kills: 0
  });
  
  socket.broadcast.emit('playerJoined', gameState.players[socket.id]);
  
  if (Object.keys(gameState.players).length === 2 && !gameState.gameActive) {
    startGame();
  }
  
  socket.on('keyUpdate', (keys) => {
    const player = gameState.players[socket.id];
    if (player) player.keys = keys;
  });
  
  socket.on('shoot', (data) => {
    const now = Date.now();
    const player = gameState.players[socket.id];
    if (player && now - player.lastShot > 300) {
      player.lastShot = now;
      gameState.bullets.push({
        id: `${socket.id}-${now}`, // Unique bullet ID
        x: data.x,
        y: data.y,
        angle: data.angle,
        speed: BULLET_SPEED,
        playerId: socket.id,
        damage: 10
      });
    }
  });
  
  socket.on('requestRestart', () => {
    if (Object.keys(gameState.players).length === 2) {
      startGame();
    }
  });
  
  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    delete gameState.players[socket.id];
    socket.broadcast.emit('playerLeft', socket.id);
    
    if (Object.keys(gameState.players).length < 2) {
      endGame();
    }
  });
});

function startGame() {
  gameState.gameActive = true;
  gameState.gameTime = 60;
  gameState.bullets = [];
  
  // Reset player stats but keep connections
  Object.values(gameState.players).forEach(player => {
    player.health = 100;
    player.x = player.id === Object.keys(gameState.players)[0] ? 100 : 700;
    player.y = 300;
    player.wallet = 0;
    player.kills = 0;
  });
  
  io.emit('gameStart');
  
  // Game timer
  const timer = setInterval(() => {
    gameState.gameTime--;
    if (gameState.gameTime <= 0) {
      clearInterval(timer);
      endGame();
    }
  }, 1000);
}

function endGame() {
  gameState.gameActive = false;
  const players = Object.values(gameState.players);
  let winner = null;
  
  if (players.length === 2) {
    if (players[0].wallet > players[1].wallet) winner = players[0].id;
    else if (players[1].wallet > players[0].wallet) winner = players[1].id;
  }
  
  io.emit('gameEnd', { 
    winner, 
    players: players.map(p => ({ 
      id: p.id, 
      wallet: p.wallet, 
      kills: p.kills 
    }))
  });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});