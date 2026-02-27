// animate.js
// Card flight animations using fixed ghost divs + CSS translate.
// All public functions return Promises that resolves when animation finishes.
// Depends on: card.js (Card class) — no game logic, no state mutation.

const CARD_DURATION_MS = 500;

/** Read the live rendered card size from the CSS variable so animations
 *  match whatever size the responsive layout has computed. */
function getCardSize() {
  const w = parseFloat(getComputedStyle(document.documentElement)
              .getPropertyValue("--card-w")) || 65;
  return { w, h: w * 2 };
}

// ─────────────────────────────────────────────────────────────────
//  CORE HELPERS
// ─────────────────────────────────────────────────────────────────

/**
 * Creates a ghost card div positioned exactly over a source position.
 * All styles are applied before the element is appended to avoid
 * mid-paint reflows that cause the top-left teleport bug.
 *
 * @param {Card|null}              card      - null → face-down grey
 * @param {HTMLElement|DOMRect}    fromElOrRect  - live element OR pre-captured rect
 * @returns {HTMLDivElement}
 */
function createGhost(card, fromElOrRect) {
  const rect = (fromElOrRect instanceof Element)
    ? fromElOrRect.getBoundingClientRect()
    : fromElOrRect;  // already a plain rect object

  const ghost = document.createElement("div");
  ghost.classList.add("card");

  if (!card) {
    ghost.classList.add("hidden");
  } else {
    ghost.classList.add(card.color);
    ghost.textContent = card.label;
  }

  // Set ALL geometry in one shot before appending — prevents reflow artifacts
  const { w: CARD_W, h: CARD_H } = getCardSize();
  Object.assign(ghost.style, {
    position:      "fixed",
    left:          `${rect.left}px`,
    top:           `${rect.top}px`,
    width:         `${CARD_W}px`,
    height:        `${CARD_H}px`,
    margin:        "0",
    zIndex:        "1000",
    pointerEvents: "none",
    // No transition yet — we add it after the first paint
    transition:    "none",
  });

  document.body.appendChild(ghost);
  return ghost;
}

/**
 * Flies `ghost` to the centre of `toEl`, then removes it.
 * Uses two rAF frames to guarantee the browser has painted the ghost
 * at its start position before the transition begins.
 *
 * @param {HTMLDivElement} ghost
 * @param {HTMLElement}    toEl
 * @returns {Promise<void>}
 */
function flyGhost(ghost, toEl) {
  return new Promise(resolve => {
    // Compute destination: align ghost top-left to toEl's top-left
    // (both ghost and toEl are the same card size, so this centres them)
    const fromRect = ghost.getBoundingClientRect();
    const toRect   = toEl.getBoundingClientRect();
    const { w: CARD_W, h: CARD_H } = getCardSize();

    // Target the centre of toEl so the card lands in the middle of the container
    const destLeft = toRect.left + (toRect.width  - CARD_W) / 2;
    const destTop  = toRect.top  + (toRect.height - CARD_H) / 2;

    const dx = destLeft - fromRect.left;
    const dy = destTop  - fromRect.top;

    // Double rAF: first frame registers the element at rest,
    // second frame applies the transform so CSS transition fires correctly
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        ghost.style.transition = `transform ${CARD_DURATION_MS}ms cubic-bezier(0.25, 0.46, 0.45, 0.94)`;
        ghost.style.transform  = `translate(${dx}px, ${dy}px)`;

        ghost.addEventListener("transitionend", () => {
          ghost.remove();
          resolve();
        }, { once: true });
      });
    });
  });
}

// ─────────────────────────────────────────────────────────────────
//  PUBLIC ANIMATION FUNCTIONS
// ─────────────────────────────────────────────────────────────────

/**
 * Animate drawing `count` cards one-by-one from the draw pile to the
 * player's or opponent's hand area. Sequential — each card waits for
 * the previous to land.
 *
 * @param {number}  count
 * @param {boolean} isHuman  - true → #player-hand, false → #opponent-hand
 * @returns {Promise<void>}
 */
async function animateDraw(count, isHuman) {
  const sourceEl = document.getElementById("draw-pile-card");
  const targetEl = document.getElementById(isHuman ? "player-hand" : "opponent-hand");

  for (let i = 0; i < count; i++) {
    const ghost = createGhost(null, sourceEl);   // face-down ghost
    await flyGhost(ghost, targetEl);
  }
}

/**
 * Animate playing one or more cards from the human's hand to the pile.
 * Each entry carries the Card object and its pre-captured DOMRect
 * (captured before the hand re-renders, so the element is still in the DOM).
 *
 * @param {Array<{card: Card, rect: DOMRect}>} cardRects
 * @returns {Promise<void>}
 */
async function animatePlay(cardRects) {
  const targetEl = document.getElementById("pile-display");

  for (const { card, rect } of cardRects) {
    const ghost = createGhost(card, rect);
    await flyGhost(ghost, targetEl);
  }
}

/**
 * Animate the AI drawing cards (face-down, from draw pile to opponent hand).
 * @param {number} count
 * @returns {Promise<void>}
 */
async function animateAIDraw(count) {
  return animateDraw(count, false);
}

/**
 * Animate the AI playing cards (face-down ghosts from opponent hand to pile).
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
