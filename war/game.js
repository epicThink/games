// Egyptian War game engine — pure logic, no networking.
// Server is authoritative; slap ties are resolved by the order in which
// the server processes slap events (first valid slap wins).

const SUITS = ['♠', '♥', '♦', '♣']; // spade heart diamond club
const FACE_LABELS = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

// Grace window after a pile is collected: invalid slaps inside it count as
// "too slow" (no penalty) instead of a false slap.
const TOO_SLOW_GRACE_MS = 700;
// House rule (deviates from the GDD): a 0-card player who false-slaps is
// locked out for this many rounds (a round = one pile collection), not
// permanently. Dead players are never locked just because a pile was won.
const LOCKOUT_ROUNDS = 3;
// How long a challenge winner waits before collecting — the slap window
// during which anyone can still steal the pile if a slap condition is live.
const COLLECT_DELAY_MS = 1500;

function label(v) {
  return v <= 10 ? String(v) : FACE_LABELS[v];
}

function makeDeck() {
  const deck = [];
  for (const s of SUITS) {
    for (let v = 2; v <= 14; v++) deck.push({ v, s });
  }
  return deck;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function cleanName(raw) {
  return String(raw == null ? '' : raw)
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 16);
}

class Game {
  constructor() {
    this.players = []; // { id, num, name, cards: [], lockedUntilRound }  cards: [0]=bottom, last=top
    this.resetMatch();
  }

  resetMatch() {
    this.phase = 'lobby'; // lobby | playing | gameover
    this.pile = []; // [0]=bottom, last=top (face up)
    this.turnId = null;
    this.challenge = null; // { byId, toId, remaining, count, label }
    this.collectPending = null; // { winnerId }
    this.lastResolve = 0;
    this.winnerName = null;
    this.round = 0; // counts pile collections; drives slap lockout expiry
    for (const p of this.players) {
      p.cards = [];
      p.lockedUntilRound = 0;
    }
  }

  idx(id) { return this.players.findIndex((p) => p.id === id); }
  byId(id) { return this.players.find((p) => p.id === id) || null; }
  get hostId() { return this.players[0] ? this.players[0].id : null; }

  lockedFor(p) { return Math.max(0, p.lockedUntilRound - this.round); }

  smallestUnusedNum() {
    let n = 1;
    const used = new Set(this.players.map((p) => p.num));
    while (used.has(n)) n++;
    return n;
  }

  nameTaken(name, exceptId) {
    return this.players.some((p) => p.id !== exceptId && p.name.toLowerCase() === name.toLowerCase());
  }

  // Next player (clockwise = array order) after `id` who still has cards.
  nextActiveAfterId(id) {
    const i = this.idx(id);
    const n = this.players.length;
    for (let k = 1; k < n; k++) {
      const q = this.players[(i + k) % n];
      if (q.cards.length > 0) return q.id;
    }
    return null;
  }

  nextActiveStartingAt(idx) {
    const n = this.players.length;
    for (let k = 0; k < n; k++) {
      const q = this.players[(idx + k) % n];
      if (q.cards.length > 0) return q.id;
    }
    return null;
  }

  slapValid() {
    const n = this.pile.length;
    if (n >= 2 && this.pile[n - 1].v === this.pile[n - 2].v) return true; // pair
    if (n >= 3 && this.pile[n - 1].v === this.pile[n - 3].v) return true; // sandwich
    return false;
  }

  // ---- lobby ----

  addPlayer(id, rawName) {
    if (this.phase !== 'lobby') return { error: 'Game already in progress — wait for the next round.' };
    if (this.players.length >= 6) return { error: 'Lobby is full (max 6 players).' };
    if (this.idx(id) !== -1) return { error: 'You already joined.' };
    const n = this.smallestUnusedNum();
    let name = cleanName(rawName) || `Player ${n}`;
    if (this.nameTaken(name, id)) name = `${name} (${n})`;
    this.players.push({ id, num: n, name, cards: [], lockedUntilRound: 0 });
    return { events: [{ type: 'joined', name }] };
  }

  rename(id, rawName) {
    if (this.phase !== 'lobby') return { error: 'Names can only be changed in the lobby.' };
    if (id !== this.hostId) return { error: 'Only the host can change their name here.' };
    const p = this.byId(id);
    let name = cleanName(rawName);
    if (!name) return { error: 'Name cannot be empty.' };
    if (this.nameTaken(name, id)) return { error: 'That name is taken.' };
    const from = p.name;
    p.name = name;
    return { events: [{ type: 'renamed', from, to: name }] };
  }

  start(id, riggedDeck) {
    if (this.phase !== 'lobby') return { error: 'Game already started.' };
    if (id !== this.hostId) return { error: 'Only the host can start the game.' };
    if (this.players.length < 2) return { error: 'Need at least 2 players.' };
    const deck = riggedDeck ? riggedDeck.slice() : shuffle(makeDeck());
    for (const p of this.players) { p.cards = []; p.lockedUntilRound = 0; }
    this.round = 0;
    // Deal round-robin; extras naturally go to the earliest seats.
    let i = 0;
    while (deck.length) {
      this.players[i % this.players.length].cards.push(deck.pop());
      i++;
    }
    this.phase = 'playing';
    this.pile = [];
    this.challenge = null;
    this.collectPending = null;
    this.winnerName = null;
    this.turnId = this.players[Math.floor(Math.random() * this.players.length)].id;
    this.lastResolve = Date.now();
    return { events: [{ type: 'start', first: this.byId(this.turnId).name }] };
  }

  // ---- playing ----

  flip(id) {
    if (this.phase !== 'playing') return { error: 'Game is not running.' };
    if (this.collectPending) return { error: 'The pile is being collected.' };
    const p = this.byId(id);
    if (!p) return { error: 'You are not in this game.' };
    const expected = this.challenge ? this.challenge.toId : this.turnId;
    if (id !== expected) return { error: 'Not your turn.' };
    if (p.cards.length === 0) return { error: 'You have no cards — you can only slap.' };

    const card = p.cards.pop();
    this.pile.push(card);
    const events = [{ type: 'flip', name: p.name, card: { v: card.v, s: card.s, label: label(card.v) } }];

    if (card.v >= 11) {
      // Face card: any existing challenge is neutralized, a new one begins.
      const respId = this.nextActiveAfterId(id);
      if (respId === null) {
        // Nobody else holds cards — flipper wins the pile (after the slap window).
        this.pendCollect(id, events);
      } else {
        this.challenge = { byId: id, toId: respId, remaining: card.v - 10, count: card.v - 10, label: label(card.v) };
        this.turnId = respId;
        events.push({ type: 'challenge', by: p.name, to: this.byId(respId).name, count: card.v - 10, label: label(card.v) });
      }
    } else if (this.challenge) {
      this.challenge.remaining--;
      if (this.challenge.remaining <= 0 || p.cards.length === 0) {
        // Responder failed (or ran out of cards mid-challenge).
        this.pendCollect(this.challenge.byId, events);
      }
      // Otherwise the same responder keeps flipping.
    } else {
      const nxt = this.nextActiveAfterId(id);
      this.turnId = nxt !== null ? nxt : id;
    }
    return { events };
  }

  pendCollect(winnerId, events) {
    this.collectPending = { winnerId };
    this.challenge = null;
    events.push({ type: 'pendingCollect', name: this.byId(winnerId).name, delayMs: COLLECT_DELAY_MS });
  }

  finishCollect() {
    if (!this.collectPending) return { events: [] };
    const w = this.byId(this.collectPending.winnerId);
    return this.collect(w, 'challenge');
  }

  collect(winner, via) {
    const events = [{ type: 'collect', name: winner.name, via, count: this.pile.length }];
    winner.cards = this.pile.slice().concat(winner.cards); // pile goes under their stack
    this.pile = [];
    this.challenge = null;
    this.collectPending = null;
    this.lastResolve = Date.now();
    this.round++; // a collection ends a round — slap lockouts tick down
    this.turnId = winner.id;
    const withCards = this.players.filter((p) => p.cards.length > 0);
    if (withCards.length === 1) {
      this.endGame(withCards[0]);
      events.push({ type: 'gameOver', name: this.winnerName });
    }
    return { events };
  }

  slap(id) {
    if (this.phase !== 'playing') return { events: [] };
    const p = this.byId(id);
    if (!p) return { events: [] };
    if (this.lockedFor(p) > 0) {
      return { events: [{ type: 'slapIgnoredLocked', name: p.name, onlyFor: id, rounds: this.lockedFor(p) }] };
    }

    if (this.slapValid()) {
      const wasOut = p.cards.length === 0;
      const res = this.collect(p, 'slap');
      res.events.unshift({ type: 'slapWin', name: p.name, wasOut });
      res.cancelTimer = true; // steal beats a pending challenge collection
      return res;
    }

    // Invalid slap.
    if (Date.now() - this.lastResolve < TOO_SLOW_GRACE_MS) {
      return { events: [{ type: 'tooSlow', name: p.name, onlyFor: id }] };
    }
    if (p.cards.length > 0) {
      const donated = p.cards.pop();
      this.pile.unshift(donated); // bottom of pile; never triggers a slap check
      return { events: [{ type: 'falseSlap', name: p.name }] };
    }
    // False slap with no cards: locked out of slapping for a few rounds.
    p.lockedUntilRound = this.round + LOCKOUT_ROUNDS;
    return {
      events: [
        { type: 'falseSlap', name: p.name },
        { type: 'lockedOut', name: p.name, rounds: LOCKOUT_ROUNDS },
      ],
    };
  }

  endGame(p) {
    this.phase = 'gameover';
    this.winnerName = p.name;
    this.turnId = null;
    this.challenge = null;
    this.collectPending = null;
  }

  playAgain(id) {
    if (this.phase !== 'gameover') return { error: 'Game is still running.' };
    if (id !== this.hostId) return { error: 'Only the host can restart.' };
    this.resetMatch();
    return { events: [{ type: 'backToLobby' }] };
  }

  removePlayer(id) {
    const i = this.idx(id);
    if (i === -1) return { events: [] };
    const p = this.players.splice(i, 1)[0];
    const events = [{ type: 'left', name: p.name }];
    let cancelTimer = false;

    if (this.players.length === 0) {
      // Everyone left — never leave an empty table stuck mid-game/gameover.
      this.resetMatch();
      return { events, cancelTimer: true };
    }
    if (this.phase === 'playing') {
      // Their cards slide under the pile so no cards leave the game.
      this.pile = p.cards.concat(this.pile);
      if (this.players.length < 2) {
        if (this.players.length === 1) {
          const last = this.players[0];
          last.cards = this.pile.slice().concat(last.cards);
          this.pile = [];
          this.endGame(last);
          events.push({ type: 'gameOver', name: this.winnerName });
        } else {
          this.resetMatch();
        }
        return { events, cancelTimer: true };
      }
      if (this.challenge && (this.challenge.byId === id || this.challenge.toId === id)) {
        this.challenge = null;
        this.turnId = this.nextActiveStartingAt(i % this.players.length);
      }
      if (this.collectPending && this.collectPending.winnerId === id) {
        this.collectPending = null;
        cancelTimer = true;
        this.turnId = this.nextActiveStartingAt(i % this.players.length);
      }
      if (this.turnId === id) {
        this.turnId = this.nextActiveStartingAt(i % this.players.length);
      }
    }
    return { events, cancelTimer };
  }

  publicState() {
    return {
      phase: this.phase,
      hostId: this.hostId,
      turnId: this.turnId,
      winnerName: this.winnerName,
      nextDefaultName: `Player ${this.smallestUnusedNum()}`,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        count: p.cards.length,
        slapLocked: this.lockedFor(p) > 0,
        lockedFor: this.lockedFor(p),
      })),
      pileCount: this.pile.length,
      pileTop: this.pile.slice(-3).map((c) => ({ v: c.v, s: c.s, label: label(c.v) })),
      challenge: this.challenge
        ? {
            byId: this.challenge.byId,
            toId: this.challenge.toId,
            by: this.byId(this.challenge.byId).name,
            to: this.byId(this.challenge.toId).name,
            remaining: this.challenge.remaining,
            count: this.challenge.count,
            label: this.challenge.label,
          }
        : null,
      collecting: this.collectPending
        ? { winnerId: this.collectPending.winnerId, name: this.byId(this.collectPending.winnerId).name }
        : null,
    };
  }
}

module.exports = { Game, COLLECT_DELAY_MS, label };
