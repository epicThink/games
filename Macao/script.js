// script.js
// Depends on: card.js (Card, buildDeck, shuffle) and render.js (render)

// ─────────────────────────────────────────────────────────────────
//  GAME STATE INITIALISATION
// ─────────────────────────────────────────────────────────────────

/**
 * Builds a fresh, valid GameState.
 * Deals 5 cards to each player, flips one non-Ace card to start the pile.
 * @returns {GameState}
 */
function initGame() {
  const deck = shuffle(buildDeck());

  // First pile card must not be an Ace (would require immediate suit choice)
  let topCard;
  do { topCard = deck.splice(0, 1)[0]; } while (topCard.isWild);

  // Hands start EMPTY — animateDeal() moves cards in one by one
  return {
    deck,
    pile:              [topCard],
    activeSuit:        topCard.suit,
    players: [
      { name: "You",      hand: [],  isHuman: true  },
      { name: "Opponent", hand: [],  isHuman: false },
    ],
    currentPlayer:     0,
    pendingPunishment: 0,
    pendingSkips:      0,
    pendingEffect:     null,
    phase:             "playing",
    winner:            null,
    selectedCards:     [],
    animating:         false,
    aiSkipsRemaining:  0,     // skips the AI still needs to serve (separate from human-facing pendingSkips)
  };
}

// ─────────────────────────────────────────────────────────────────
//  CORE LOGIC
// ─────────────────────────────────────────────────────────────────

/**
 * Draw `count` cards from the deck into a player's hand.
 * If the deck runs out, the pile (minus the top card) is reshuffled into it.
 * @param {GameState} state
 * @param {number}    playerIndex
 * @param {number}    count
 */
function drawCards(state, playerIndex, count) {
  for (let i = 0; i < count; i++) {
    if (state.deck.length === 0) {
      if (state.pile.length <= 1) break; // truly nothing left — very rare edge case
      const top  = state.pile.pop();
      state.deck = shuffle(state.pile);
      state.pile = [top];
    }
    state.players[playerIndex].hand.push(state.deck.shift());
  }
}

/**
 * Validate a multi-card play attempt.
 * All cards must share the same value and at least one must directly satisfy canPlayOn().
 * @param {Card[]}    cards
 * @param {GameState} state
 * @returns {boolean}
 */
function validateMultiPlay(cards, state) {
  if (cards.length === 0) return false;

  const value = cards[0].value;
  if (!cards.every(c => c.value === value)) return false;

  const topCard = state.pile[state.pile.length - 1];
  return cards.some(c =>
    c.canPlayOn(topCard, state.activeSuit, state.pendingPunishment, state.pendingSkips)
  );
}

/**
 * Commit one or more same-value cards to the pile.
 * Caller must pass cards in order: anchor first, rest in chosen order.
 * Mutates and returns state.
 * @param {Card[]}    cards  - ordered, pre-validated
 * @param {GameState} state
 * @returns {GameState}
 */
function playCards(cards, state) {
  const playerIndex = state.currentPlayer;
  const player      = state.players[playerIndex];

  // Remove played cards from hand
  cards.forEach(card => {
    const idx = player.hand.findIndex(c => c.equals(card));
    if (idx !== -1) player.hand.splice(idx, 1);
  });

  // Push onto pile
  cards.forEach(card => state.pile.push(card));

  // The LAST played card sets the new active suit
  const lastCard   = cards[cards.length - 1];
  state.activeSuit = lastCard.suit;

  // Sum effects across ALL played cards (multi-play stacking rule)
  const totalDraw  = cards.reduce((sum, c) => sum + c.drawAmount, 0);
  const totalSkips = cards.filter(c => c.isSkip).length;
  const hasWild    = cards.some(c => c.isWild);

  // Reset before applying new effects
  state.pendingEffect = null;

  if (totalDraw > 0) {
    state.pendingPunishment += totalDraw;
    state.pendingEffect      = "draw";
  } else if (totalSkips > 0) {
    state.pendingSkips += totalSkips;
  } else if (hasWild) {
    state.phase = "chooseSuit";
  }

  // Win check
  if (player.hand.length === 0) {
    state.phase  = "gameOver";
    state.winner = playerIndex;
    return state;
  }

  // Advance turn only when not waiting for suit choice
  if (state.phase === "playing") {
    advanceTurn(state);
  }

  return state;
}

/**
 * Current player draws instead of playing.
 * If a punishment is pending, absorbs the full stacked amount.
 * Otherwise draws 1 card.
 * @param {GameState} state
 * @returns {GameState}
 */
function drawCard(state) {
  const playerIndex = state.currentPlayer;

  if (state.pendingEffect === "draw") {
    drawCards(state, playerIndex, state.pendingPunishment);
    state.pendingPunishment = 0;
    state.pendingEffect     = null;
  } else if (state.pendingSkips > 0) {
    // Human is accepting the skip — consume one skip and pass to opponent.
    state.pendingSkips--;
    state.currentPlayer = state.currentPlayer === 0 ? 1 : 0;
    return state;
  } else {
    drawCards(state, playerIndex, 1);
  }

  advanceTurn(state);
  return state;
}

/**
 * Resolve the Ace suit choice. Sets activeSuit, exits chooseSuit phase,
 * and advances the turn.
 * @param {string}    suit
 * @param {GameState} state
 * @returns {GameState}
 */
function chooseSuit(suit, state) {
  state.activeSuit = suit;
  state.phase      = "playing";
  advanceTurn(state);
  return state;
}

/**
 * Advance to the next player.
 * Always toggles currentPlayer. pendingSkips are left intact for the
 * incoming player to either counter (play a 4) or accept (draw / timer).
 * @param {GameState} state
 */
function advanceTurn(state) {
  state.currentPlayer = state.currentPlayer === 0 ? 1 : 0;
}

// ─────────────────────────────────────────────────────────────────
//  AI OPPONENT
// ─────────────────────────────────────────────────────────────────

/**
 * Execute the AI's turn (player index 1).
 *
 * Strategy (greedy):
 *   1. If a punishment chain is active, try to chain-block (same value).
 *   2. Otherwise prefer: punishment cards > skip cards > wilds > plain cards.
 *   3. Always collect all same-value cards for a multi-play.
 *   4. If no playable card exists, draw.
 *   5. After playing an Ace, pick the suit most common in remaining hand.
 *
 * @param {GameState} state
 */
async function aiTurn(state) {
  if (state.phase !== "playing" || state.currentPlayer !== 1) return;
  if (state.animating) return;

  const hand    = state.players[1].hand;
  const topCard = state.pile[state.pile.length - 1];

  // 1. Find all individually playable cards
  const playable = hand.filter(c =>
    c.canPlayOn(topCard, state.activeSuit, state.pendingPunishment, state.pendingSkips)
  );

  // If the AI has pending skips, it can only escape by counter-playing a 4.
  // If no counter available: consume one skip, stash remaining in aiSkipsRemaining
  // (invisible to the human — no countdown), and give human their free turn.
  // When the human plays, maybeScheduleAI restores aiSkipsRemaining back into
  // pendingSkips so the AI serves the next skip on its next visit.
  if (state.pendingSkips > 0 && playable.length === 0) {
    state.pendingSkips--;                      // consume one skip this visit
    state.aiSkipsRemaining = state.pendingSkips; // stash the rest for later
    state.pendingSkips = 0;                    // zero so human sees no countdown
    advanceTurn(state);                        // toggle to human for their free turn
    render(state);
    maybeScheduleAI(state);
    return;
  }

  if (playable.length === 0) {
    // AI has no playable card and no pending skips — draw one normally
    const drawCount = state.pendingEffect === "draw" ? state.pendingPunishment : 1;
    state.animating = true;
    render(state);
    await animateAIDraw(drawCount);
    state.animating = false;
    drawCard(state);
    render(state);
    maybeScheduleAI(state);
    return;
  }

  // 2. Choose anchor card according to priority
  let anchor;
  if (state.pendingEffect === "draw") {
    anchor = playable[0];
  } else {
    const punishments = playable.filter(c => c.isPunishment);
    const skips       = playable.filter(c => c.isSkip);
    const wilds       = playable.filter(c => c.isWild);
    const plains      = playable.filter(c => !c.effect);
    anchor = punishments[0] ?? skips[0] ?? wilds[0] ?? plains[0];
  }

  // 3. Bundle all same-value cards into a multi-play (anchor goes first)
  const sameValue  = hand.filter(c => c.value === anchor.value);
  const trueAnchor = sameValue.find(c =>
    c.canPlayOn(topCard, state.activeSuit, state.pendingPunishment, state.pendingSkips)
  );
  const rest   = sameValue.filter(c => !c.equals(trueAnchor));
  const toPlay = [trueAnchor, ...rest];

  // AI plays — animate (face-down ghosts) then mutate
  state.animating = true;
  render(state);
  await animateAIPlay(toPlay.length);
  state.animating = false;
  playCards(toPlay, state);

  // 4. If Ace was played, pick the most common suit remaining in hand
  if (state.phase === "chooseSuit") {
    const remaining = state.players[1].hand;
    const counts    = { hearts: 0, diamonds: 0, clubs: 0, spades: 0 };
    remaining.forEach(c => counts[c.suit]++);
    const bestSuit  = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    chooseSuit(bestSuit, state);
  }

  render(state);
  maybeScheduleAI(state);
}

/**
 * After any action resolves, check whether the AI needs to fire again.
 * Also handles the edge case where the human's turn is immediately skipped
 * (the AI plays a 4) — the human sees the skip message briefly, then the
 * AI goes again automatically.
 * @param {GameState} state
 */
// Holds the timeout ID for the skip countdown so it can be cancelled when
// the human acts (plays a 4 or clicks draw) before time runs out.
let skipCountdownId = null;

function clearSkipCountdown() {
  if (skipCountdownId !== null) {
    clearTimeout(skipCountdownId);
    skipCountdownId = null;
  }
}

function maybeScheduleAI(state) {
  if (state.phase !== "playing") return;

  if (state.currentPlayer === 1) {
    // Restore any stashed AI skips back into pendingSkips before aiTurn runs
    if (state.aiSkipsRemaining > 0) {
      state.pendingSkips = state.aiSkipsRemaining;
      state.aiSkipsRemaining = 0;
      render(state);
    }
    setTimeout(() => aiTurn(state), 900);
  } else if (state.pendingSkips > 0 && state.currentPlayer === 0) {
    // Human has pendingSkips — give them 3 seconds to counter with a 4.
    // If the timer fires first, auto-accept the skip on their behalf.
    clearSkipCountdown();
    skipCountdownId = setTimeout(() => {
      skipCountdownId = null;
      if (state.pendingSkips > 0 && state.currentPlayer === 0 && state.phase === "playing" && !state.animating) {
        // Auto-accept: same logic as clicking draw while a skip is pending
        state.pendingSkips--;
        state.currentPlayer = 1;
        render(state);
        setTimeout(() => aiTurn(state), 900);
      }
    }, 3000);
  }
}

// ─────────────────────────────────────────────────────────────────
//  EVENT HANDLERS
// ─────────────────────────────────────────────────────────────────

let gameState;

/**
 * Toggle card selection in the human's hand.
 * Rules:
 *  - Only playable cards can be selected.
 *  - All selected cards must share the same value (multi-play rule).
 *  - Clicking a selected card deselects it.
 * @param {Card} card
 */
function onCardClick(card) {
  const state   = gameState;
  if (state.animating) return;
  const topCard = state.pile[state.pile.length - 1];
  const idx     = state.selectedCards.findIndex(c => c.equals(card));

  if (idx !== -1) {
    // Deselect
    state.selectedCards.splice(idx, 1);
  } else {
    const alreadySelected = state.selectedCards;

    if (alreadySelected.length === 0) {
      // First card selected: must directly satisfy canPlayOn (it will be the anchor)
      if (!card.canPlayOn(topCard, state.activeSuit, state.pendingPunishment, state.pendingSkips)) return;
    } else {
      // Subsequent cards: must share the same value as the already-selected anchor.
      // They don't need to satisfy canPlayOn individually — the anchor covers that.
      if (card.value !== alreadySelected[0].value) return;
    }

    state.selectedCards.push(card);
  }

  render(state);
}

/**
 * Human clicks the draw pile.
 */
async function onDrawPileClick() {
  const state = gameState;
  if (state.currentPlayer !== 0 || state.phase !== "playing") return;
  if (state.animating) return;
  clearSkipCountdown();

  // Peek at how many cards will be drawn before mutating state
  const drawCount = state.pendingEffect === "draw" ? state.pendingPunishment : 1;

  state.animating = true;
  render(state);

  await animateDraw(drawCount, true);

  state.animating = false;
  drawCard(state);
  state.selectedCards = [];
  render(state);

  if (state.phase === "playing" && state.currentPlayer === 1) {
    setTimeout(() => aiTurn(state), 900);
  } else {
    maybeScheduleAI(state);
  }
}

/**
 * Human clicks Confirm Play.
 * Enforces anchor-first ordering before committing.
 */
async function onConfirmPlay() {
  const state = gameState;
  if (state.selectedCards.length === 0) return;
  if (!validateMultiPlay(state.selectedCards, state)) return;
  if (state.animating) return;
  clearSkipCountdown();

  // Order: anchor (directly playable) first, rest in selection order
  const topCard  = state.pile[state.pile.length - 1];
  const cards    = [...state.selectedCards];
  const anchor   = cards.find(c =>
    c.canPlayOn(topCard, state.activeSuit, state.pendingPunishment, state.pendingSkips)
  );
  const rest     = cards.filter(c => !c.equals(anchor));
  const ordered  = [anchor, ...rest];

  // Capture bounding rects of each card div BEFORE any render call.
  // After render() the hand is rebuilt (innerHTML = ""), so live elements
  // become detached and getBoundingClientRect() returns all zeros.
  const playerHandEl = document.getElementById("player-hand");
  const cardDivs     = Array.from(playerHandEl.querySelectorAll(".card"));
  const cardRects = ordered.map(card => {
    const el = cardDivs.find(div =>
      div.dataset.suit === card.suit && div.dataset.value === card.value
    );
    // Store the rect as a plain object — survives DOM teardown
    return { card, rect: el ? el.getBoundingClientRect() : null };
  }).filter(({ rect }) => rect && rect.width > 0); // guard: skip detached / zero rects

  state.animating = true;
  state.selectedCards = [];
  render(state);  // safe to render now — rects are already captured

  await animatePlay(cardRects);

  state.animating = false;
  playCards(ordered, state);
  render(state);

  // If Ace was played, wait for human suit choice before handing off to AI
  if (state.phase === "chooseSuit") return;

  if (state.phase === "playing" && state.currentPlayer === 1) {
    setTimeout(() => aiTurn(state), 900);
  } else {
    maybeScheduleAI(state);
  }
}

/**
 * Human picks a suit after playing an Ace.
 * @param {string} suit
 */
function onSuitChosen(suit) {
  const state = gameState;
  if (state.phase !== "chooseSuit") return;

  chooseSuit(suit, state);
  render(state);

  if (state.phase === "playing" && state.currentPlayer === 1) {
    setTimeout(() => aiTurn(state), 900);
  } else {
    maybeScheduleAI(state);
  }
}

/**
 * Restart — new fresh game with deal animation.
 */
async function onRestartClick() {
  gameState = initGame();
  // Render with empty hands first (animating flag suppresses interaction)
  gameState.animating = true;
  render(gameState);
  await animateDeal(gameState, 5);
  gameState.animating = false;
  render(gameState);
  if (gameState.currentPlayer === 1) setTimeout(() => aiTurn(gameState), 900);
}

// ─────────────────────────────────────────────────────────────────
//  STATIC EVENT LISTENERS
// ─────────────────────────────────────────────────────────────────

document.getElementById("draw-pile-card").addEventListener("click", onDrawPileClick);
document.getElementById("confirm-play").addEventListener("click", onConfirmPlay);
document.getElementById("restart-btn").addEventListener("click", onRestartClick);

document.querySelectorAll("#suit-picker button[data-suit]").forEach(btn => {
  btn.addEventListener("click", () => onSuitChosen(btn.dataset.suit));
});

// ─────────────────────────────────────────────────────────────────
//  GAME START (called from main menu)
// ─────────────────────────────────────────────────────────────────

/**
 * Transition from the main menu into the game:
 * fade out menu → fade in board → deal animation → first render.
 */
async function startGame() {
  await transitionMenuToGame();

  gameState = initGame();

  // Render board in "animating" state so cards appear but interaction is locked
  gameState.animating = true;
  render(gameState);

  await animateDeal(gameState, 5);

  gameState.animating = false;
  render(gameState);

  if (gameState.currentPlayer === 1) setTimeout(() => aiTurn(gameState), 900);
}

document.getElementById("start-btn").addEventListener("click", startGame);