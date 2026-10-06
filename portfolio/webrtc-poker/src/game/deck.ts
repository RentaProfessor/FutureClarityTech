import { Card, SUITS, RANKS } from './types';

/**
 * Creates a standard 52-card deck.
 * 4 suits × 13 ranks = 52 unique cards.
 * No duplicates by construction.
 */
export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

/** Returns a uniformly random integer in [0, maxExclusive). */
export type RandomInt = (maxExclusive: number) => number;

const UINT32_RANGE = 2 ** 32;

/**
 * Cryptographically secure random integer in [0, maxExclusive).
 * A plain `value % n` favors small results whenever 2^32 isn't a multiple of n,
 * so values from the incomplete top bucket are rejected and redrawn.
 */
export const randomInt: RandomInt = (maxExclusive) => {
  if (!Number.isInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > UINT32_RANGE) {
    throw new RangeError(`randomInt needs an integer in [1, 2^32], got ${maxExclusive}`);
  }
  const limit = UINT32_RANGE - (UINT32_RANGE % maxExclusive);
  const buffer = new Uint32Array(1);
  do {
    crypto.getRandomValues(buffer);
  } while (buffer[0] >= limit);
  return buffer[0] % maxExclusive;
};

/**
 * Fisher-Yates shuffle. Every permutation is equally likely as long as `random` is uniform.
 * Shuffles in-place and returns the deck.
 */
export function shuffleDeck(deck: Card[], random: RandomInt = randomInt): Card[] {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/**
 * Manages a deck for a single hand of poker.
 * Cards are popped from the shuffled array, making it impossible to deal duplicates.
 */
export class HandDeck {
  private cards: Card[];
  private position: number;

  constructor(cards: Card[] = shuffleDeck(createDeck())) {
    this.cards = cards;
    this.position = 0;
  }

  /**
   * Deal one card from the deck.
   * @throws Error if deck is exhausted (should never happen in standard play)
   */
  deal(): Card {
    if (this.position >= this.cards.length) {
      throw new Error('Deck exhausted - this should never happen in a standard hand');
    }
    return this.cards[this.position++];
  }

  /**
   * Deal multiple cards.
   */
  dealMultiple(count: number): Card[] {
    const cards: Card[] = [];
    for (let i = 0; i < count; i++) {
      cards.push(this.deal());
    }
    return cards;
  }

  /**
   * Burn one card (standard casino procedure before community cards).
   */
  burn(): void {
    this.deal(); // Just advance position, discard the card
  }

  /**
   * Number of cards remaining in the deck.
   */
  get remaining(): number {
    return this.cards.length - this.position;
  }
}

