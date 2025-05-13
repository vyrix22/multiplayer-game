const express = require('express');
const socketio = require('socket.io');
const http = require('http');

const app = express();
const server = http.createServer(app);
const io = socketio(server);

app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

const gameState = {
  players: {},
  bullets: [],
  gameStarted: false,
  countdown: null,
  gameTime: 60,
  gameTimer: null,
  wallets: { player1: 0, player2: 0 }
};

function getClientGameState() {
  const clientGameState = {
    players: {},
    bullets: gameState.bullets,
    gameTime: gameState.gameTime,
    wallets: gameState.wallets
  };

  for (const playerId in gameState.players) {
    const player = gameState.players[playerId];
    clientGameState.players[playerId] = {
      x: player.x,
      y: player.y,
      width: player.width,
      height: player.height,
      color: player.color,
      health: player.health
    };
  }

  return clientGameState;
}

io.on('connection', (socket) => {
  console.log('New player connected:', socket.id);

  let playerNumber;
  if (!gameState.players['player1']) {
    playerNumber = 'player1';
    gameState.players[playerNumber] = {
      id: socket.id,
      x: 100,
      y: 300,
      width: 50,
      height: 50,
      color: 'red',
      keys: {},
      health: 100
    };
  } else if (!gameState.players['player2']) {
    playerNumber = 'player2';
    gameState.players[playerNumber] = {
      id: socket.id,
      x: 700,
      y: 300,
      width: 50,
      height: 50,
      color: 'blue',
      keys: {},
      health: 100
    };
  } else {
    socket.emit('gameFull');
    socket.disconnect();
    return;
  }

  socket.emit('init', { playerNumber, gameState: getClientGameState() });
  io.emit('playerCount', Object.keys(gameState.players).length);
  socket.emit('walletUpdate', { amount: gameState.wallets[playerNumber] });

  socket.on('keyUpdate', (keys) => {
    if (gameState.players[playerNumber]) {
      gameState.players[playerNumber].keys = keys;
    }
  });

  socket.on('shoot', (bullet) => {
    if (gameState.gameStarted) {
      gameState.bullets.push(bullet);
      io.emit('bulletFired', bullet);
    }
  });

  socket.on('requestStart', () => {
    if (Object.keys(gameState.players).length === 2 && !gameState.gameStarted) {
      startCountdown();
    }
  });

  socket.on('requestPlayAgain', () => {
    if (Object.keys(gameState.players).length === 2 && !gameState.gameStarted) {
      startCountdown();
    }
  });

  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    if (gameState.players[playerNumber]) {
      delete gameState.players[playerNumber];
      resetGame();
      io.emit('playerDisconnected');
      io.emit('playerCount', Object.keys(gameState.players).length);
    }
  });
});

setInterval(() => {
  if (gameState.gameStarted) {
    updateGameState();
    io.emit('gameUpdate', getClientGameState());
  }
}, 1000 / 60);

function updateGameState() {
  for (const playerId in gameState.players) {
    const player = gameState.players[playerId];
    const speed = 5;

    if (player.keys.ArrowUp || player.keys.w) player.y -= speed;
    if (player.keys.ArrowDown || player.keys.s) player.y += speed;
    if (player.keys.ArrowLeft || player.keys.a) player.x -= speed;
    if (player.keys.ArrowRight || player.keys.d) player.x += speed;

    player.x = Math.max(0, Math.min(750, player.x));
    player.y = Math.max(0, Math.min(550, player.y));
  }

  gameState.bullets = gameState.bullets.filter(bullet => {
    bullet.x += bullet.dx;
    bullet.y += bullet.dy;
    
    if (bullet.x < 0 || bullet.x > 800 || bullet.y < 0 || bullet.y > 600) {
      return false;
    }
    
    for (const playerId in gameState.players) {
      const player = gameState.players[playerId];
      if (playerId !== bullet.playerNumber && // Don't hit yourself
          bullet.x > player.x && 
          bullet.x < player.x + player.width &&
          bullet.y > player.y && 
          bullet.y < player.y + player.height) {
        
        player.health -= 10;
        
        if (player.health <= 0) {
          const killerId = bullet.playerNumber;
          gameState.wallets[killerId] += 5;
          io.to(gameState.players[killerId].id).emit('walletUpdate', { 
            amount: gameState.wallets[killerId] 
          });
          player.health = 100;
        }
        return false;
      }
    }
    return true;
  });
}

function startCountdown() {
  gameState.countdown = 3;
  io.emit('countdown', gameState.countdown);
  
  const countdownInterval = setInterval(() => {
    gameState.countdown--;
    io.emit('countdown', gameState.countdown);
    
    if (gameState.countdown <= 0) {
      clearInterval(countdownInterval);
      gameState.gameStarted = true;
      gameState.gameTime = 60;
      io.emit('gameStart');
      
      gameState.gameTimer = setInterval(() => {
        gameState.gameTime--;
        io.emit('gameTimeUpdate', gameState.gameTime);
        
        if (gameState.gameTime <= 0) {
          clearInterval(gameState.gameTimer);
          gameState.gameStarted = false;
          io.emit('gameOver', gameState.wallets);
        }
      }, 1000);
    }
  }, 1000);
}

function resetGame() {
  gameState.gameStarted = false;
  gameState.countdown = null;
  gameState.bullets = [];
  gameState.wallets = { player1: 0, player2: 0 };
  
  if (gameState.gameTimer) {
    clearInterval(gameState.gameTimer);
    gameState.gameTimer = null;
  }

  if (gameState.players['player1']) {
    gameState.players['player1'].x = 100;
    gameState.players['player1'].y = 300;
    gameState.players['player1'].health = 100;
  }
  if (gameState.players['player2']) {
    gameState.players['player2'].x = 700;
    gameState.players['player2'].y = 300;
    gameState.players['player2'].health = 100;
  }
}

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});