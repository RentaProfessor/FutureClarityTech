import { describe, expect, it } from 'vitest';
import { HandDeck, createDeck, randomInt, shuffleDeck } from './deck';

const key = (c: { rank: string; suit: string }) => `${c.rank}${c.suit}`;

describe('deck', () => {
  it('has 52 distinct cards', () => {
    expect(new Set(createDeck().map(key)).size).toBe(52);
  });

  it('shuffles into a permutation using one draw per position', () => {
    const draws: number[] = [];
    const deck = shuffleDeck(createDeck(), n => {
      draws.push(n);
      return n - 1;
    });
    expect(new Set(deck.map(key)).size).toBe(52);
    expect(draws).toEqual(Array.from({ length: 51 }, (_, i) => 52 - i));
  });

  it('deals without repeats and refuses to run past the end', () => {
    const deck = new HandDeck();
    const dealt = deck.dealMultiple(52).map(key);
    expect(new Set(dealt).size).toBe(52);
    expect(() => deck.deal()).toThrow();
  });
});

describe('randomInt', () => {
  it('stays in range', () => {
    for (const n of [1, 2, 3, 7, 52]) {
      for (let i = 0; i < 500; i++) {
        const v = randomInt(n);
        expect(Number.isInteger(v) && v >= 0 && v < n).toBe(true);
      }
    }
  });

  it('is roughly uniform', () => {
    const counts = new Array(6).fill(0);
    for (let i = 0; i < 60_000; i++) counts[randomInt(6)]++;
    for (const c of counts) expect(Math.abs(c - 10_000)).toBeLessThan(500); // ~5 standard deviations
  });

  it('rejects ranges it cannot draw from', () => {
    expect(() => randomInt(0)).toThrow(RangeError);
    expect(() => randomInt(2.5)).toThrow(RangeError);
  });
});
