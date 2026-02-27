// animate.js
// Card animations powered by GSAP.
// Public API is identical to the previous version — script.js needs no changes.
// Depends on: card.js (Card class), GSAP loaded globally.

const CARD_DURATION = 0.45; // seconds for a single card flight

// ─────────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────────

/** Read the live rendered card size from the CSS variable. */
function getCardSize() {
  const w = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--card-w")
  ) || 65;
  return { w, h: w * 2 };
}

/**
 * Creates a ghost card div stamped at the given position.
 * Uses GSAP's `set` so position is applied in one synchronous pass —
 * no reflow artifacts, no double-rAF needed.
 *
 * @param {Card|null}           card         - null → face-down grey
 * @param {HTMLElement|DOMRect} fromElOrRect - live element OR pre-captured rect
 * @returns {HTMLDivElement}
 */
function createGhost(card, fromElOrRect) {
  const rect = (fromElOrRect instanceof Element)
    ? fromElOrRect.getBoundingClientRect()
    : fromElOrRect;

  const { w, h } = getCardSize();

  const ghost = document.createElement("div");
  ghost.classList.add("card");

  if (!card) {
    ghost.classList.add("hidden");
  } else {
    ghost.classList.add(card.color);
    ghost.textContent = card.label;
  }

  document.body.appendChild(ghost);

  // GSAP set: applies all styles atomically before first paint
  gsap.set(ghost, {
    position:      "fixed",
    left:          rect.left,
    top:           rect.top,
    width:         w,
    height:        h,
    margin:        0,
    zIndex:        1000,
    pointerEvents: "none",
    x:             0,
    y:             0,
  });

  return ghost;
}

/**
 * Wraps a GSAP tween in a Promise so it can be awaited.
 * IMPORTANT: uses .then() instead of eventCallback() so it does NOT
 * overwrite any onComplete already set on the tween (e.g. ghost.remove()).
 * @param {gsap.core.Tween | gsap.core.Timeline} tween
 * @returns {Promise<void>}
 */
function tweenPromise(tween) {
  return new Promise(resolve => {
    const existing = tween.eventCallback("onComplete");
    tween.eventCallback("onComplete", () => {
      if (existing) existing();
      resolve();
    });
  });
}

/**
 * Compute the pixel delta from a ghost's current position to the
 * centre of a target element.
 */
function getDelta(ghost, toEl) {
  const { w, h } = getCardSize();
  const fromRect = ghost.getBoundingClientRect();
  const toRect   = toEl.getBoundingClientRect();
  return {
    dx: (toRect.left + (toRect.width  - w) / 2) - fromRect.left,
    dy: (toRect.top  + (toRect.height - h) / 2) - fromRect.top,
  };
}

// ─────────────────────────────────────────────────────────────────
//  CORE FLIGHT — face-down card slides from A to B
// ─────────────────────────────────────────────────────────────────

/**
 * Slides a ghost from its current position to the centre of `toEl`.
 * Removes the ghost on completion. Returns a Promise.
 *
 * @param {HTMLDivElement} ghost
 * @param {HTMLElement}    toEl
 * @returns {Promise<void>}
 */
function flyGhost(ghost, toEl) {
  const { dx, dy } = getDelta(ghost, toEl);
  const tween = gsap.to(ghost, {
    x:        dx,
    y:        dy,
    duration: CARD_DURATION,
    ease:     "power2.out",
    onComplete() { ghost.remove(); },
  });
  return tweenPromise(tween);
}

// ─────────────────────────────────────────────────────────────────
//  PLAY ANIMATION — card flies then flips face-up on the pile
// ─────────────────────────────────────────────────────────────────

/**
 * Flies a face-up card ghost to the pile with a mid-flight Y-axis flip.
 * First half: slides to midpoint + rotates to 90° (edge-on).
 * Second half: swaps label (already visible since card is face-up), rotates back, slides to destination.
 *
 * @param {HTMLDivElement} ghost  - face-up card ghost
 * @param {HTMLElement}    toEl   - #pile-display
 * @returns {Promise<void>}
 */
function flyAndFlip(ghost, toEl) {
  const { dx, dy } = getDelta(ghost, toEl);

  return tweenPromise(
    gsap.timeline({ onComplete() { ghost.remove(); } })
      // First half: arc toward the pile and start rotating edge-on
      .to(ghost, {
        x:          dx * 0.5,
        y:          dy * 0.5,
        rotationY:  90,
        duration:   CARD_DURATION * 0.45,
        ease:       "power1.in",
      })
      // Second half: finish the flip and land
      .to(ghost, {
        x:          dx,
        y:          dy,
        rotationY:  0,
        duration:   CARD_DURATION * 0.55,
        ease:       "power1.out",
      })
  );
}

// ─────────────────────────────────────────────────────────────────
//  PUBLIC ANIMATION FUNCTIONS
// ─────────────────────────────────────────────────────────────────

/**
 * Draw `count` cards from the draw pile to a hand area, one by one.
 *
 * @param {number}  count
 * @param {boolean} isHuman - true → #player-hand, false → #opponent-hand
 * @returns {Promise<void>}
 */
async function animateDraw(count, isHuman) {
  const sourceEl = document.getElementById("draw-pile-card");
  const targetEl = document.getElementById(isHuman ? "player-hand" : "opponent-hand");

  for (let i = 0; i < count; i++) {
    const ghost = createGhost(null, sourceEl);
    await flyGhost(ghost, targetEl);
  }
}

/**
 * Play one or more cards from the human's hand to the pile, sequentially.
 * Each card does the flip animation.
 *
 * @param {Array<{card: Card, rect: DOMRect}>} cardRects
 * @returns {Promise<void>}
 */
async function animatePlay(cardRects) {
  const targetEl = document.getElementById("pile-display");

  for (const { card, rect } of cardRects) {
    const ghost = createGhost(card, rect);
    await flyAndFlip(ghost, targetEl);
  }
}

/**
 * AI draws `count` cards (face-down) from the draw pile to the opponent hand.
 * @param {number} count
 * @returns {Promise<void>}
 */
async function animateAIDraw(count) {
  return animateDraw(count, false);
}

/**
 * AI plays `count` cards (face-down ghosts) from the opponent hand to the pile.
 * @param {number} count
 * @returns {Promise<void>}
 */
async function animateAIPlay(count) {
  const sourceEl = document.getElementById("opponent-hand");
  const targetEl = document.getElementById("pile-display");

  for (let i = 0; i < count; i++) {
    const ghost = createGhost(null, sourceEl);
    await flyGhost(ghost, targetEl);
  }
}

/**
 * Opening deal animation: alternately deals cards to opponent then player,
 * 5 each, from the draw pile.
 *
 * After each ghost lands, the corresponding card is moved from state.deck
 * into the correct hand and render() is called — so the hand grows one
 * card at a time in sync with the animation.
 *
 * @param {GameState} state      - mutated in place
 * @param {number}    cardsEach  - cards per player (default 5)
 * @returns {Promise<void>}
 */
async function animateDeal(state, cardsEach = 5) {
  const sourceEl   = document.getElementById("draw-pile-card");
  const playerEl   = document.getElementById("player-hand");
  const opponentEl = document.getElementById("opponent-hand");

  for (let i = 0; i < cardsEach * 2; i++) {
    const isHuman    = i % 2 !== 0; // opponent first (i=0), player second (i=1), alternating
    const playerIdx  = isHuman ? 0 : 1;
    const targetEl   = isHuman ? playerEl : opponentEl;

    const ghost = createGhost(null, sourceEl);
    await flyGhost(ghost, targetEl);

    // Move the top card from the deck into this player's hand, then re-render
    state.players[playerIdx].hand.push(state.deck.shift());
    render(state);
  }
}

// ─────────────────────────────────────────────────────────────────
//  SCENE TRANSITIONS
// ─────────────────────────────────────────────────────────────────

/**
 * Fade the main menu out, fade the game board in.
 * @returns {Promise<void>}
 */
function transitionMenuToGame() {
  return tweenPromise(
    gsap.timeline()
      .to("#main-menu", {
        opacity:  0,
        duration: 0.4,
        ease:     "power1.in",
        onComplete() {
          document.getElementById("main-menu").style.display = "none";
          document.getElementById("game-board").style.display = "flex";
          gsap.set("#game-board", { opacity: 0 });
        },
      })
      .to("#game-board", {
        opacity:  1,
        duration: 0.4,
        ease:     "power1.out",
      })
  );
}

/**
 * Animate the game-over overlay fading/scaling in.
 */
function animateGameOver() {
  const el = document.getElementById("game-over");
  el.style.display = "flex";
  gsap.fromTo(el,
    { opacity: 0, scale: 0.85 },
    { opacity: 1, scale: 1, duration: 0.4, ease: "back.out(1.4)" }
  );
}