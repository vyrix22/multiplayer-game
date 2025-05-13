const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const playerCountElement = document.getElementById('playerCount');
const startButton = document.getElementById('startButton');
const countdownElement = document.getElementById('countdown');
const walletDisplay = document.getElementById('walletDisplay');
const timerDisplay = document.getElementById('timerDisplay');
const gameOverModal = document.getElementById('gameOverModal');
const gameResult = document.getElementById('gameResult');
const playAgainButton = document.getElementById('playAgainButton');

function resizeCanvas() {
  const minDimension = Math.min(window.innerWidth - 40, window.innerHeight - 40, 800);
  canvas.width = minDimension;
  canvas.height = minDimension * 0.75;
}

resizeCanvas();
window.addEventListener('resize', resizeCanvas);

let gameState = {
  players: {},
  bullets: [],
  gameStarted: false,
  countdown: null
};

let playerNumber = null;
let keys = {};

window.addEventListener('keydown', (e) => {
  keys[e.key] = true;
  socket.emit('keyUpdate', keys);
});

window.addEventListener('keyup', (e) => {
  keys[e.key] = false;
  socket.emit('keyUpdate', keys);
});

canvas.addEventListener('click', (e) => {
  if (!gameState.gameStarted) return;
  
  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  
  const player = gameState.players[playerNumber];
  if (!player) return;
  
  const angle = Math.atan2(
    mouseY - (player.y + player.height / 2),
    mouseX - (player.x + player.width / 2)
  );
  
  const speed = 10;
  const bullet = {
    x: player.x + player.width / 2,
    y: player.y + player.height / 2,
    dx: Math.cos(angle) * speed,
    dy: Math.sin(angle) * speed,
    radius: 5,
    color: player.color,
    playerNumber
  };
  
  socket.emit('shoot', bullet);
});

startButton.addEventListener('click', () => {
  socket.emit('requestStart');
});

playAgainButton.addEventListener('click', () => {
  gameOverModal.style.display = 'none';
  socket.emit('requestPlayAgain');
});

socket.on('init', ({ playerNumber: pNum, gameState: state }) => {
  playerNumber = pNum;
  gameState = state;
  updatePlayerCount();
  walletDisplay.textContent = `RS: ${gameState.wallets[playerNumber]}`;
});

socket.on('gameUpdate', (state) => {
  gameState = state;
});

socket.on('playerCount', (count) => {
  updatePlayerCount(count);
  startButton.disabled = count < 2;
});

socket.on('countdown', (count) => {
  countdownElement.style.display = 'block';
  countdownElement.textContent = count;
  
  if (count <= 0) {
    setTimeout(() => {
      countdownElement.style.display = 'none';
    }, 1000);
  }
});

socket.on('gameStart', () => {
  gameState.gameStarted = true;
});

socket.on('playerDisconnected', () => {
  alert('Other player disconnected. Game reset.');
});

socket.on('bulletFired', (bullet) => {
  gameState.bullets.push(bullet);
});

socket.on('gameFull', () => {
  alert('Game is full. Please try again later.');
  window.location.reload();
});

socket.on('gameTimeUpdate', (time) => {
  timerDisplay.textContent = `Time: ${time}s`;
});

socket.on('gameOver', (wallets) => {
  gameOverModal.style.display = 'flex';
  const playerWallet = wallets[playerNumber];
  const opponentNumber = playerNumber === 'player1' ? 'player2' : 'player1';
  const opponentWallet = wallets[opponentNumber];
  
  gameResult.innerHTML = `
    <p>Your winnings: RS ${playerWallet}</p>
    <p>Opponent's winnings: RS ${opponentWallet}</p>
    <p>${playerWallet > opponentWallet ? 'You won!' : 
       playerWallet < opponentWallet ? 'You lost!' : 'It\'s a tie!'}</p>
  `;
});

socket.on('walletUpdate', (data) => {
  walletDisplay.textContent = `RS: ${data.amount}`;
});

function updatePlayerCount(count) {
  const currentCount = count || Object.keys(gameState.players).length;
  playerCountElement.textContent = `Players: ${currentCount}/2`;
}

function gameLoop() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  for (const id in gameState.players) {
    const player = gameState.players[id];
    
    ctx.fillStyle = player.color;
    ctx.fillRect(
      player.x * (canvas.width / 800), 
      player.y * (canvas.height / 600), 
      player.width * (canvas.width / 800), 
      player.height * (canvas.height / 600)
    );
    
    // Player name in yellow
    ctx.fillStyle = 'yellow';
    ctx.font = `${12 * (canvas.width / 800)}px Arial`;
    ctx.textAlign = 'center';
    ctx.fillText(
      id === 'player1' ? 'Player 1' : 'Player 2',
      (player.x + player.width / 2) * (canvas.width / 800),
      (player.y + player.height + 20) * (canvas.height / 600)
    );
    
    ctx.fillStyle = 'red';
    ctx.fillRect(
      player.x * (canvas.width / 800),
      (player.y - 15) * (canvas.height / 600),
      player.width * (canvas.width / 800),
      5 * (canvas.height / 600)
    );
    
    ctx.fillStyle = 'green';
    ctx.fillRect(
      player.x * (canvas.width / 800),
      (player.y - 15) * (canvas.height / 600),
      (player.width * (player.health / 100)) * (canvas.width / 800),
      5 * (canvas.height / 600)
    );
  }
  
  ctx.fillStyle = 'black';
  gameState.bullets.forEach(bullet => {
    ctx.beginPath();
    ctx.arc(
      bullet.x * (canvas.width / 800),
      bullet.y * (canvas.height / 600),
      bullet.radius * (canvas.width / 800),
      0,
      Math.PI * 2
    );
    ctx.fill();
    ctx.fillStyle = bullet.color;
    ctx.fill();
    ctx.fillStyle = 'black';
  });
  
  requestAnimationFrame(gameLoop);
}

gameLoop();