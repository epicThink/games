// Headless test client: joins the lobby and auto-flips when it's its turn.
// Usage: node bot.js [port]   — for manual multiplayer testing only.
const { io } = require('socket.io-client');

const port = process.argv[2] || 3000;
const socket = io(`http://localhost:${port}`);
let myId = null;
let flipTimer = null;

socket.on('connect', () => {
  myId = socket.id;
  console.log('bot connected as', myId);
  socket.emit('join');
});

socket.on('state', (s) => {
  clearTimeout(flipTimer);
  if (s.phase === 'lobby' && s.hostId === myId && s.players.length >= 2) {
    setTimeout(() => socket.emit('start'), 1000);
    return;
  }
  if (s.phase !== 'playing') return;
  const m = s.players.find((p) => p.id === myId);
  if (!m || m.count === 0 || s.collecting) return;
  const myTurn = s.challenge ? s.challenge.toId === myId : s.turnId === myId;
  if (myTurn) flipTimer = setTimeout(() => socket.emit('flip'), 700);
});

socket.on('events', (evs) => evs.forEach((e) => console.log('event:', JSON.stringify(e))));
socket.on('err', (m) => console.log('err:', m));
