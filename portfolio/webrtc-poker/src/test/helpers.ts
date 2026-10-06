import { GameEngine, GameEvent } from '../game/game-engine';
import { createDeck } from '../game/deck';
import { Card, Rank, Suit } from '../game/types';

const SUIT_CODES: Record<string, Suit> = { h: 'hearts', d: 'diamonds', c: 'clubs', s: 'spades' };

/** "As" → ace of spades, "Td" → ten of diamonds. */
export function card(code: string): Card {
  const rank = (code[0] === 'T' ? '10' : code[0]) as Rank;
  return { rank, suit: SUIT_CODES[code[1]] };
}

export const cards = (codes: string): Card[] => codes.split(' ').map(card);

const sameCard = (a: Card, b: Card) => a.rank === b.rank && a.suit === b.suit;

/**
 * A deck in the exact order the engine deals: two hole cards per player in seat order,
 * then burn + flop, burn + turn, burn + river. The rest of the deck follows.
 */
export function stackedDeck(holes: string[], board: string): () => Card[] {
  const ordered = holes.flatMap(cards);
  const [f1, f2, f3, turn, river] = cards(board);
  const fixed = [...ordered, f1, f2, f3, turn, river];
  const spare = createDeck().filter(c => !fixed.some(f => sameCard(c, f)));
  const burn = () => spare.shift()!;
  const deck = [...ordered, burn(), f1, f2, f3, burn(), turn, burn(), river, ...spare];
  return () => deck.map(c => ({ ...c }));
}

/** Engine with players p0…p(n-1) in seats 0…n-1. The first button goes to seat 0. */
export function table(stacks: number[], deck?: () => Card[]) {
  const events: GameEvent[] = [];
  const engine = new GameEngine('ROOM', 'p0', e => events.push(e), { random: () => 0, deck });
  stacks.forEach((chips, i) => {
    engine.addPlayer(`p${i}`, `Player ${i}`, i);
    engine.getPlayerById(`p${i}`)!.chips = chips;
  });
  const chips = () => Object.fromEntries(engine.gameState.players.map(p => [p.id, p.chips]));
  const active = () => engine.getActivePlayer()?.id ?? null;
  const act = (action: Parameters<GameEngine['handleAction']>[1], amount?: number) =>
    engine.handleAction(active()!, action, amount);
  const last = <T extends GameEvent['type']>(type: T) =>
    events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type).at(-1);
  return { engine, events, chips, active, act, last };
}

/** Deterministic PRNG (mulberry32) for fuzz tests. */
export function seeded(seed: number): (maxExclusive: number) => number {
  let a = seed >>> 0;
  return (maxExclusive) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 2 ** 32 * maxExclusive) | 0;
  };
}
