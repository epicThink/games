const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Game, COLLECT_DELAY_MS } = require('./game');

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server);

const game = new Game();
let collectTimer = null;

function broadcast() {
  io.emit('state', game.publicState());
}

function emitEvents(events) {
  if (events && events.length) io.emit('events', events);
}

function syncCollectTimer() {
  if (!game.collectPending && collectTimer) {
    clearTimeout(collectTimer);
    collectTimer = null;
  }
  if (game.collectPending && !collectTimer) {
    collectTimer = setTimeout(() => {
      collectTimer = null;
      const r = game.finishCollect();
      emitEvents(r.events);
      broadcast();
    }, COLLECT_DELAY_MS);
  }
}

function handle(result, socket) {
  if (result.error) {
    socket.emit('err', result.error);
    return;
  }
  if (result.cancelTimer && collectTimer) {
    clearTimeout(collectTimer);
    collectTimer = null;
  }
  emitEvents(result.events);
  syncCollectTimer();
  broadcast();
}

io.on('connection', (socket) => {
  socket.emit('state', game.publicState());

  socket.on('join', (name) => handle(game.addPlayer(socket.id, name), socket));
  socket.on('rename', (name) => handle(game.rename(socket.id, name), socket));
  socket.on('start', () => handle(game.start(socket.id), socket));
  socket.on('flip', () => handle(game.flip(socket.id), socket));
  // Slaps are resolved in the order the server processes them — the GDD's
  // "server-received timestamp" tiebreak.
  socket.on('slap', () => handle(game.slap(socket.id), socket));
  socket.on('again', () => handle(game.playAgain(socket.id), socket));

  socket.on('disconnect', () => {
    const r = game.removePlayer(socket.id);
    if (r.cancelTimer && collectTimer) {
      clearTimeout(collectTimer);
      collectTimer = null;
    }
    emitEvents(r.events);
    syncCollectTimer();
    broadcast();
  });
});

server.listen(PORT, () => {
  console.log(`Egyptian War running — open http://localhost:${PORT} in multiple browser windows to play.`);
});
