/* global io */
const socket = io();

let S = null;            // latest server state
let myId = null;
let popNextCard = false; // animate the top pile card on next render

const $ = (id) => document.getElementById(id);
const screens = { lobby: $('lobby'), game: $('game'), over: $('over') };

socket.on('connect', () => { myId = socket.id; if (S) render(); });
socket.on('state', (s) => { S = s; render(); });
socket.on('events', (evs) => evs.forEach(handleEvent));
socket.on('err', (msg) => toast(msg, 'bad'));
socket.on('disconnect', () => toast('Disconnected from server', 'bad'));

// ---------- helpers ----------

function me() { return S ? S.players.find((p) => p.id === myId) : null; }

function canFlip() {
  const m = me();
  if (!S || !m || S.phase !== 'playing' || S.collecting || m.count === 0) return false;
  if (S.challenge) return S.challenge.toId === myId;
  return S.turnId === myId;
}

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function log(msg) {
  const box = $('log');
  const el = document.createElement('div');
  el.textContent = msg;
  box.appendChild(el);
  while (box.children.length > 7) box.firstChild.remove();
}

function pileFlash(text, ms = 700) {
  const el = $('pileFlash');
  el.textContent = text;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.textContent = ''; }, ms);
}

function shake() {
  const g = $('game');
  g.classList.remove('shake');
  void g.offsetWidth; // restart animation
  g.classList.add('shake');
}

// ---------- rendering ----------

function render() {
  if (!S) return;
  for (const k in screens) screens[k].style.display = 'none';
  if (S.phase === 'lobby') { screens.lobby.style.display = 'flex'; renderLobby(); }
  else if (S.phase === 'playing') { screens.game.style.display = 'block'; renderGame(); }
  else { screens.over.style.display = 'flex'; renderOver(); }
}

function renderLobby() {
  const list = $('playerList');
  list.innerHTML = '';
  for (const p of S.players) {
    const li = document.createElement('li');
    const tags =
      (p.id === S.hostId ? '<span class="tag">HOST</span>' : '') +
      (p.id === myId ? '<span class="tag you">YOU</span>' : '');
    li.innerHTML = `<span class="dot"></span><span>${esc(p.name)}</span>${tags}`;
    list.appendChild(li);
  }
  if (S.players.length === 0) {
    list.innerHTML = '<li style="opacity:.6">Nobody here yet&hellip;</li>';
  }

  const joined = !!me();
  $('joinRow').style.display = joined || S.players.length >= 6 ? 'none' : 'flex';
  $('nameInput').placeholder = `enter your name here (default: ${S.nextDefaultName})`;

  const isHost = joined && myId === S.hostId;
  $('renameRow').style.display = isHost ? 'flex' : 'none';
  $('renameInput').placeholder = me() ? me().name : 'new name';
  const startBtn = $('startBtn');
  startBtn.style.display = isHost ? '' : 'none';
  startBtn.disabled = S.players.length < 2;

  const hint = $('lobbyHint');
  if (!joined) hint.textContent = 'Press + to join the table';
  else if (isHost) hint.textContent = S.players.length < 2
    ? 'Waiting for more players (open another browser window)…'
    : 'You are the host — start when ready!';
  else hint.textContent = `Joined as ${me().name} — waiting for the host to start…`;
}

function renderGame() {
  const m = me();
  $('spectator').style.display = m ? 'none' : 'block';

  // --- status line ---
  const status = $('status');
  if (S.collecting) {
    status.innerHTML = `<span class="hot">${esc(S.collecting.name)}</span> wins the pile… SLAP to steal it!`;
  } else if (S.challenge) {
    const c = S.challenge;
    status.innerHTML =
      `<span class="hot">${esc(c.by)}</span> played ${c.label}! ` +
      `<span class="hot">${esc(c.to)}</span> must flip a face card — ${c.remaining} ${c.remaining === 1 ? 'try' : 'tries'} left`;
  } else if (S.turnId) {
    const t = S.players.find((p) => p.id === S.turnId);
    status.innerHTML = t
      ? (t.id === myId ? '<span class="hot">YOUR TURN</span> — drag your deck onto the pile'
                       : `Waiting for <span class="hot">${esc(t.name)}</span> to flip…`)
      : 'Pile up for grabs — SLAP it!';
  } else {
    status.textContent = '';
  }

  // --- opponents around the table ---
  const box = $('opponents');
  box.innerHTML = '';
  const others = [];
  if (S.players.length) {
    const myIdx = m ? S.players.findIndex((p) => p.id === myId) : -1;
    for (let k = 1; k <= S.players.length; k++) {
      const p = S.players[(myIdx + k) % S.players.length];
      if (p.id !== myId) others.push(p);
    }
  }
  // Slots sweep an arc over the top of the table, clockwise from my left.
  const n = others.length;
  others.forEach((p, i) => {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const ang = Math.PI * (1 - t) * 0.8 + Math.PI * 0.1; // 162deg -> 18deg
    const x = 50 - Math.cos(ang) * 38;
    const y = 42 - Math.sin(ang) * 24;
    const el = document.createElement('div');
    el.className = 'opp';
    if (p.id === S.turnId && S.phase === 'playing') el.classList.add('turn');
    if (p.count === 0) el.classList.add('out');
    if (p.slapLocked) el.classList.add('locked');
    el.style.left = x + '%';
    el.style.top = y + '%';
    const sub = p.slapLocked
      ? `locked (${p.lockedFor} round${p.lockedFor === 1 ? '' : 's'})`
      : p.count === 0 ? 'slap to return!' : 'cards';
    el.innerHTML =
      `<div class="oval">${p.count}</div>` +
      `<div class="oname">${esc(p.name)}</div>` +
      `<div class="osub">${sub}</div>`;
    box.appendChild(el);
  });

  // --- pile ---
  const pile = $('pile');
  pile.innerHTML = '';
  pile.classList.toggle('empty', S.pileCount === 0);
  pile.classList.toggle('challenge', !!S.challenge);
  S.pileTop.forEach((c, i) => {
    const top = i === S.pileTop.length - 1;
    const el = document.createElement('div');
    el.className = 'pcard ' + (c.s === '♥' || c.s === '♦' ? 'red' : 'black');
    const off = (S.pileTop.length - 1 - i);
    el.style.transform = `translate(${-off * 14}px, ${-off * 5}px) rotate(${-off * 5}deg)`;
    el.innerHTML =
      `<div class="corner">${c.label}<br>${c.s}</div>` +
      `<div class="big">${c.s}</div>` +
      `<div class="corner br">${c.label}<br>${c.s}</div>`;
    if (top && popNextCard) el.classList.add('pop');
    pile.appendChild(el);
  });
  popNextCard = false;
  $('pileCount').textContent = S.pileCount === 0 ? 'pile is empty' : `${S.pileCount} card${S.pileCount === 1 ? '' : 's'} in the pile`;

  // --- challenge pips ---
  const pips = $('challengePips');
  pips.innerHTML = '';
  if (S.challenge) {
    for (let i = 0; i < S.challenge.count; i++) {
      const pip = document.createElement('div');
      pip.className = 'pip' + (i < S.challenge.count - S.challenge.remaining ? ' used' : '');
      pips.appendChild(pip);
    }
  }

  // --- my deck ---
  const deck = $('myDeck');
  const flippable = canFlip();
  deck.classList.toggle('myturn', flippable);
  deck.classList.toggle('empty', !m || m.count === 0);
  $('dragHint').style.display = flippable ? 'block' : 'none';
  $('deckCount').textContent = m ? m.count : 0;
  $('myStatus').textContent = !m ? ''
    : m.slapLocked ? `LOCKED OUT — no slapping for ${m.lockedFor} more round${m.lockedFor === 1 ? '' : 's'}`
    : m.count === 0 ? 'OUT OF CARDS — slap a pair/sandwich to return!'
    : '';
}

function renderOver() {
  $('winnerText').textContent = `🏆 ${S.winnerName} WINS!`;
  const isHost = myId === S.hostId;
  $('againBtn').style.display = isHost ? '' : 'none';
  $('overHint').textContent = isHost ? '' : 'Waiting for the host to restart…';
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ---------- server events (animations / log) ----------

function handleEvent(ev) {
  switch (ev.type) {
    case 'joined': log(`${ev.name} joined the lobby`); break;
    case 'left': log(`${ev.name} left`); toast(`${ev.name} left the game`); break;
    case 'start': log(`Game on! ${ev.first} flips first`); toast(`Game started — ${ev.first} goes first!`, 'good'); break;
    case 'flip':
      popNextCard = true;
      log(`${ev.name} flipped ${ev.card.label}${ev.card.s}`);
      break;
    case 'challenge':
      log(`${ev.by} played ${ev.label} — ${ev.to} must answer (${ev.count})`);
      break;
    case 'pendingCollect':
      log(`${ev.name} is reaching for the pile…`);
      break;
    case 'collect':
      log(`${ev.name} collected ${ev.count} cards`);
      if (ev.via === 'challenge') toast(`${ev.name} wins the pile (+${ev.count} cards)`, 'good');
      break;
    case 'slapWin':
      pileFlash('🖐️');
      shake();
      toast(ev.name === (me() || {}).name ? 'YOU slapped the pile!' : `${ev.name} slapped the pile!`, 'good');
      if (ev.wasOut) toast(`${ev.name} is BACK IN the game!`, 'good');
      log(`${ev.name} SLAPPED the pile${ev.wasOut ? ' and re-entered!' : '!'}`);
      break;
    case 'falseSlap':
      pileFlash('❌');
      toast(`${ev.name} false-slapped — donates a card to the pile bottom`, 'bad');
      log(`${ev.name} false slap`);
      break;
    case 'tooSlow':
      if (ev.onlyFor === myId) { pileFlash('🐢', 600); toast('Too slow!', 'bad'); }
      break;
    case 'slapIgnoredLocked':
      if (ev.onlyFor === myId) toast(`You are locked out of slapping for ${ev.rounds} more round${ev.rounds === 1 ? '' : 's'}.`, 'bad');
      break;
    case 'lockedOut':
      toast(`${ev.name} is locked out of slapping for ${ev.rounds} rounds`, 'bad');
      log(`${ev.name} locked out (${ev.rounds} rounds)`);
      break;
    case 'renamed':
      log(`${ev.from} is now ${ev.to}`);
      break;
    case 'gameOver':
      log(`${ev.name} wins the game!`);
      break;
    case 'backToLobby':
      toast('Back to the lobby for a rematch', 'good');
      break;
  }
}

// ---------- input ----------

$('joinBtn').addEventListener('click', () => socket.emit('join', $('nameInput').value));
$('nameInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') socket.emit('join', $('nameInput').value);
  e.stopPropagation(); // typing a space in the input must not slap
});
function rename() {
  const v = $('renameInput').value.trim();
  if (v) { socket.emit('rename', v); $('renameInput').value = ''; }
}
$('renameBtn').addEventListener('click', rename);
$('renameInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') rename();
  e.stopPropagation();
});
$('startBtn').addEventListener('click', () => socket.emit('start'));
$('againBtn').addEventListener('click', () => socket.emit('again'));

function slap() {
  if (!S || S.phase !== 'playing' || !me()) return;
  pileFlash('👋', 250); // optimistic local feedback
  socket.emit('slap');
}

document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !e.repeat) {
    e.preventDefault();
    slap();
  }
});
$('pile').addEventListener('click', (e) => {
  if (!dragging) slap();
});

// --- drag deck -> pile to flip ---
let dragging = false;
const ghost = $('dragGhost');

$('myDeck').addEventListener('pointerdown', (e) => {
  if (!canFlip()) return;
  dragging = true;
  e.preventDefault();
  ghost.style.display = 'block';
  moveGhost(e);
  document.addEventListener('pointermove', moveGhost);
  document.addEventListener('pointerup', endDrag, { once: true });
});

function moveGhost(e) {
  ghost.style.left = e.clientX + 'px';
  ghost.style.top = e.clientY + 'px';
  $('pile').classList.toggle('droptarget', overPile(e));
}

function overPile(e) {
  const r = $('pileArea').getBoundingClientRect();
  const pad = 30;
  return e.clientX > r.left - pad && e.clientX < r.right + pad &&
         e.clientY > r.top - pad && e.clientY < r.bottom + pad;
}

function endDrag(e) {
  document.removeEventListener('pointermove', moveGhost);
  ghost.style.display = 'none';
  $('pile').classList.remove('droptarget');
  if (overPile(e) && canFlip()) socket.emit('flip');
  // small delay so the pile's click handler doesn't also fire a slap
  setTimeout(() => { dragging = false; }, 50);
}
