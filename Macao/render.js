// render.js
// Pure rendering — no game logic here.
// Depends on: card.js (Card class, label/color getters)
// Called by: script.js after every state mutation

// ─────────────────────────────────────────────────────────────────
//  DOM HELPERS
// ─────────────────────────────────────────────────────────────────

/**
 * Build a single card <div>.
 * @param {Card|null} card
 * @param {object}    opts
 * @param {boolean}   opts.hidden   - face-down grey card
 * @param {boolean}   opts.playable - gold outline + hover lift
 * @param {boolean}   opts.selected - blue outline + lifted
 * @returns {HTMLDivElement}
 */
function createCardEl(card, { hidden = false, playable = false, selected = false } = {}) {
  const el = document.createElement("div");
  el.classList.add("card");

  if (hidden) {
    el.classList.add("hidden");
  } else {
    el.classList.add(card.color);   // "red" | "black"
    el.textContent = card.label;    // e.g. "7♦"
    el.dataset.suit  = card.suit;
    el.dataset.value = card.value;
  }

  if (playable) el.classList.add("playable");
  if (selected) el.classList.add("selected");

  return el;
}

// ─────────────────────────────────────────────────────────────────
//  MASTER RENDER
// ─────────────────────────────────────────────────────────────────

/**
 * Fully re-renders the UI from the given state.
 * Called after every state change. Single source of UI truth.
 * @param {GameState} state
 */
function render(state) {
  renderOpponentHand(state);
  renderPlayArea(state);
  renderPlayerHand(state);
  renderStatusBar(state);
  renderSuitPicker(state);
  renderGameOver(state);
  renderConfirmButton(state);
}

// ─────────────────────────────────────────────────────────────────
//  SUB-RENDERERS
// ─────────────────────────────────────────────────────────────────

// ── Opponent hand ────────────────────────────────────────────────

function renderOpponentHand(state) {
  const container = document.getElementById("opponent-hand");
  container.innerHTML = "";

  const opponent = state.players[1];

  opponent.hand.forEach(() => {
    container.appendChild(createCardEl(null, { hidden: true }));
  });

  document.getElementById("opponent-count").textContent =
    `${opponent.name}: ${opponent.hand.length} card${opponent.hand.length !== 1 ? "s" : ""}`;
}

// ── Play area (draw pile, pile queue, suit indicator, punishment banner) ──

function renderPlayArea(state) {
  // Draw pile (always face-down)
  document.getElementById("draw-pile-card").className = "card hidden";
  document.getElementById("draw-pile-count").textContent =
    `Draw pile (${state.deck.length})`;

  // ── Pile display: up to 5 cards, oldest on the left, newest on the right ──
  // state.pile is ordered oldest→newest; we take the last 5 entries.
  // Opacity steps (oldest→newest): 60%, 70%, 80%, 90%, 100%
  const pileDisplay  = document.getElementById("pile-display");
  pileDisplay.innerHTML = "";

  const opacities    = [0.6, 0.7, 0.8, 0.9, 1.0];
  const displayed    = state.pile.slice(-5);           // up to 5, oldest first
  const offset       = 5 - displayed.length;           // align opacities to the right end

  displayed.forEach((card, i) => {
    const el       = document.createElement("div");
    el.classList.add("card", card.color);
    el.textContent = card.label;
    el.style.opacity = opacities[offset + i];
    pileDisplay.appendChild(el);
  });

  // Active suit indicator — visible only when activeSuit differs from top card suit (after Ace)
  const topCard     = state.pile[state.pile.length - 1];
  const suitSymbols = { hearts: "♥", diamonds: "♦", clubs: "♣", spades: "♠" };
  const suitColors  = { hearts: "#e74c3c", diamonds: "#e74c3c", clubs: "#ecf0f1", spades: "#ecf0f1" };
  const indicator   = document.getElementById("active-suit-indicator");

  if (state.activeSuit !== topCard.suit) {
    indicator.textContent   = `Active suit: ${suitSymbols[state.activeSuit]}`;
    indicator.style.color   = suitColors[state.activeSuit];
    indicator.style.display = "block";
  } else {
    indicator.style.display = "none";
  }

  // Punishment banner
  const banner = document.getElementById("punishment-banner");
  if (state.pendingPunishment > 0) {
    banner.textContent   = `⚠ Draw ${state.pendingPunishment} stacked!`;
    banner.style.display = "block";
  } else {
    banner.style.display = "none";
  }
}

// ── Player hand ──────────────────────────────────────────────────

function renderPlayerHand(state) {
  const container = document.getElementById("player-hand");
  container.innerHTML = "";

  const isMyTurn = (
    state.currentPlayer === 0 &&
    state.phase === "playing" &&
    state.pendingSkips === 0 &&
    !state.animating
  );

  const topCard      = state.pile[state.pile.length - 1];
  const player       = state.players[0];
  const anchorValue  = state.selectedCards.length > 0 ? state.selectedCards[0].value : null;

  player.hand.forEach(card => {
    // A card is playable (gold outline) if:
    //   - it directly satisfies canPlayOn (can be an anchor), OR
    //   - an anchor is already selected and this card shares its value (companion)
    const directlyPlayable = card.canPlayOn(topCard, state.activeSuit, state.pendingPunishment, state.pendingSkips);
    const isCompanion      = anchorValue !== null && card.value === anchorValue;
    const playable         = isMyTurn && (directlyPlayable || isCompanion);
    const selected         = state.selectedCards.some(c => c.equals(card));

    const el = createCardEl(card, { playable, selected });

    if (isMyTurn) {
      el.addEventListener("click", () => onCardClick(card));
    }

    container.appendChild(el);
  });
}

// ── Status bar ───────────────────────────────────────────────────

function renderStatusBar(state) {
  const bar = document.getElementById("status-bar");

  if (state.phase === "gameOver") {
    bar.textContent = "";
    return;
  }

  if (state.phase === "chooseSuit") {
    bar.textContent = "Choose a suit for the Ace ↓";
    return;
  }

  const isMyTurn = state.currentPlayer === 0;

  if (state.pendingPunishment > 0 && isMyTurn) {
    bar.textContent =
      `Your turn — block with a matching card or draw ${state.pendingPunishment}!`;
  } else if (state.pendingSkips > 0 && state.currentPlayer === 0) {
    bar.textContent = state.pendingSkips > 1
      ? `Skipped x${state.pendingSkips} — play a 4 to counter or lose your turns!`
      : "Skipped — play a 4 to counter or lose your turn!";
  } else if (!isMyTurn) {
    bar.textContent = "Opponent is thinking…";
  } else {
    bar.textContent = "Your turn";
  }
}

// ── Suit picker overlay ──────────────────────────────────────────

function renderSuitPicker(state) {
  document.getElementById("suit-picker").style.display =
    state.phase === "chooseSuit" ? "flex" : "none";
}

// ── Game over screen ─────────────────────────────────────────────

function renderGameOver(state) {
  const screen = document.getElementById("game-over");

  if (state.phase === "gameOver") {
    const winner = state.players[state.winner];
    screen.style.display = "flex";
    document.getElementById("game-over-message").textContent =
      winner.isHuman ? "You win! 🎉" : "Opponent wins!";
  } else {
    screen.style.display = "none";
  }
}

// ── Confirm play button ──────────────────────────────────────────

function renderConfirmButton(state) {
  const btn          = document.getElementById("confirm-play");
  const hasSelection = state.selectedCards.length > 0;
  const visible      = hasSelection && state.currentPlayer === 0;

  btn.style.display = visible ? "block" : "none";

  if (hasSelection) {
    btn.textContent = `Play ${state.selectedCards.map(c => c.label).join(" + ")}`;
  }
}