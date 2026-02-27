// ─────────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────────

const SUITS  = ["hearts", "diamonds", "clubs", "spades"];
const VALUES = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];

const EFFECTS = {
  "2": "draw2",
  "3": "draw3",
  "4": "skip",
  "A": "wild",
};

// How many cards each effect forces the next player to draw (0 if not a draw effect)
const DRAW_AMOUNT = {
  "draw2": 2,
  "draw3": 3,
  "wild":  0,
  "skip":  0,
  null:    0,
};

// ─────────────────────────────────────────────
//  CARD CLASS
// ─────────────────────────────────────────────

class Card {
  /**
   * @param {string} suit  - "hearts" | "diamonds" | "clubs" | "spades"
   * @param {string} value - "2".."10" | "J" | "Q" | "K" | "A"
   */
  constructor(suit, value) {
    if (!SUITS.includes(suit)) {
      throw new Error(`Invalid suit: "${suit}". Must be one of: ${SUITS.join(", ")}`);
    }
    if (!VALUES.includes(value)) {
      throw new Error(`Invalid value: "${value}". Must be one of: ${VALUES.join(", ")}`);
    }

    this.suit   = suit;
    this.value  = value;
    this.effect = EFFECTS[value] ?? null; // "draw2" | "draw3" | "skip" | "wild" | null
  }

  // ── Derived properties ──────────────────────

  /** How many cards this card forces the next player to draw (0 if none) */
  get drawAmount() {
    return DRAW_AMOUNT[this.effect] ?? 0;
  }

  /** True if this card can start or extend a draw-punishment chain */
  get isPunishment() {
    return this.drawAmount > 0;
  }

  /** True if this card skips the next player's turn */
  get isSkip() {
    return this.effect === "skip";
  }

  /** True if this card can be played on top of any card (Ace) */
  get isWild() {
    return this.effect === "wild";
  }

  /** Color bucket used for rendering ("red" for hearts/diamonds, "black" for clubs/spades) */
  get color() {
    return this.suit === "hearts" || this.suit === "diamonds" ? "red" : "black";
  }

  /** Unicode suit symbol */
  get suitSymbol() {
    const symbols = {
      hearts:   "♥",
      diamonds: "♦",
      clubs:    "♣",
      spades:   "♠",
    };
    return symbols[this.suit];
  }

  /** Short display label e.g. "A♠", "10♥", "K♦" */
  get label() {
    return `${this.value}${this.suitSymbol}`;
  }

  // ── Comparison helpers ──────────────────────

  /**
   * Can this card be played on top of `topCard` given the active suit?
   *
   * Rules:
   *  1. Ace (wild) can always be played
   *  2. Same suit as activeSuit
   *  3. Same value as topCard
   *
   * When a draw punishment or skip chain is active, only a card of the same
   * value can be played (to block/stack). Otherwise normal suit/value rules apply.
   *
   * @param {Card}   topCard              - The current top card of the play pile
   * @param {string} activeSuit           - Current active suit (may differ from topCard.suit after an Ace)
   * @param {number} [pendingPunishment=0] - Accumulated draw punishment; if > 0 only chain-blocks are allowed
   * @param {number} [pendingSkips=0]      - Accumulated skips; if > 0 only a 4 can be played to counter
   */
  canPlayOn(topCard, activeSuit, pendingPunishment = 0, pendingSkips = 0) {
    if (pendingPunishment > 0 || pendingSkips > 0) {
      // During an active chain, only the same value can block/stack
      return this.value === topCard.value;
    }

    return (
      this.isWild                    ||  // Ace plays on anything
      this.suit  === activeSuit      ||  // same suit
      this.value === topCard.value       // same value
    );
  }

  /**
   * Returns true if this card is the same suit AND value (i.e. identical).
   * Useful for testing; a real 52-card deck has no duplicates.
   * @param {Card} other
   */
  equals(other) {
    return this.suit === other.suit && this.value === other.value;
  }

  // ── Serialisation ───────────────────────────

  /** Plain object snapshot — safe to store in JSON game state */
  toJSON() {
    return { suit: this.suit, value: this.value, effect: this.effect };
  }

  /** Reconstruct a Card from a toJSON() snapshot */
  static fromJSON({ suit, value }) {
    return new Card(suit, value);
  }

  toString() {
    return this.label;
  }
}

// ─────────────────────────────────────────────
//  DECK HELPERS  (buildDeck + shuffle live here
//  because they are tightly coupled to Card)
// ─────────────────────────────────────────────

/**
 * Returns an ordered array of all 52 Card objects.
 * @returns {Card[]}
 */
function buildDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const value of VALUES) {
      deck.push(new Card(suit, value));
    }
  }
  return deck; // 52 cards
}

/**
 * Fisher-Yates in-place shuffle.
 * @param {Card[]} deck
 * @returns {Card[]} the same array, shuffled
 */
function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// ─────────────────────────────────────────────
//  EXPORTS  (works as an ES module or in a
//  plain <script> tag where these become globals)
// ─────────────────────────────────────────────

if (typeof module !== "undefined") {
  module.exports = { Card, buildDeck, shuffle, SUITS, VALUES, EFFECTS, DRAW_AMOUNT };
}
