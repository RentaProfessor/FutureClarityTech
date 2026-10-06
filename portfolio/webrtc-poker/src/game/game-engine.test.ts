import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACTION_TIMEOUT, GameEngine } from './game-engine';
import { createDeck, shuffleDeck } from './deck';
import { seeded, stackedDeck, table } from '../test/helpers';

// A board that gives nobody a straight or flush, so pairs decide the hand
const DRY_BOARD = '2h 7s 9h Js 3d';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('betting rounds', () => {
  it('lets every player act after the flop, not just the first to check', () => {
    const t = table([200, 200]);
    t.engine.startHand();

    // Heads-up: the button posts the small blind and acts first preflop
    expect(t.active()).toBe('p0');
    t.act('call');
    expect(t.active()).toBe('p1'); // big blind keeps the option
    t.act('check');
    expect(t.engine.gameState.communityCards).toHaveLength(3);

    // After the flop the big blind acts first, and a check passes the action on
    expect(t.active()).toBe('p1');
    t.act('check');
    expect(t.active()).toBe('p0');
    expect(t.engine.gameState.communityCards).toHaveLength(3);
    t.act('check');
    expect(t.engine.gameState.communityCards).toHaveLength(4);
  });

  it('reopens the action for players who already called when someone raises', () => {
    const t = table([200, 200, 200]);
    t.engine.startHand();

    expect(t.active()).toBe('p0'); // three-handed, the button is under the gun
    t.act('call');
    expect(t.active()).toBe('p1');
    t.act('raise', 5); // small blind raises to 6
    expect(t.engine.gameState.currentBet).toBe(6);
    t.act('call');
    expect(t.active()).toBe('p0'); // the early caller has to respond
    t.act('call');

    expect(t.engine.gameState.bettingRound).toBe('flop');
    expect(t.engine.gameState.pot).toBe(18);
    expect(t.active()).toBe('p1'); // first seat left of the button
  });

  it('rejects malformed and out-of-range bets without changing anything', () => {
    const t = table([200, 200]);
    t.engine.startHand();
    const before = JSON.stringify(t.engine.gameState);

    expect(t.act('check')).toBe(false); // facing the big blind
    expect(t.act('raise', '10' as unknown as number)).toBe(false);
    expect(t.act('raise', 4.5)).toBe(false);
    expect(t.act('raise', -5)).toBe(false);
    expect(t.act('raise', 2)).toBe(false); // below the minimum raise of 3
    expect(t.act('raise', 500)).toBe(false); // more than the stack
    expect(t.engine.handleAction('p1', 'check')).toBe(false); // not their turn

    expect(JSON.stringify(t.engine.gameState)).toBe(before);
    expect(t.act('raise', 3)).toBe(true);
  });

  it('keeps the turn timer running after an invalid action', () => {
    const t = table([200, 200]);
    t.engine.startHand();

    expect(t.act('check')).toBe(false);
    vi.advanceTimersByTime(ACTION_TIMEOUT);

    // Facing a bet, the timeout folds
    expect(t.engine.getPlayerById('p0')!.hasFolded).toBe(true);
    expect(t.engine.gameState.handInProgress).toBe(false);
  });

  it('checks instead of folding when a player times out with nothing to call', () => {
    const t = table([200, 200]);
    t.engine.startHand();
    t.act('call');

    vi.advanceTimersByTime(ACTION_TIMEOUT); // big blind's option
    expect(t.engine.getPlayerById('p1')!.hasFolded).toBe(false);
    expect(t.engine.gameState.bettingRound).toBe('flop');
  });

  it('does not offer a raise when nobody is left to call it', () => {
    const t = table([50, 200]);
    t.engine.startHand();
    t.act('all-in');

    const actions = t.engine.getValidActions(t.engine.getActivePlayer()!).map(a => a.action);
    expect(actions).toEqual(['fold', 'call']);
  });
});

describe('pots and payouts', () => {
  it('builds a main pot and a side pot and pays each to its best eligible hand', () => {
    const t = table([50, 100, 200], stackedDeck(['Ac Ad', 'Kc Kd', 'Qc Qd'], DRY_BOARD));
    t.engine.startHand();

    t.act('all-in'); // p0: 50
    t.act('all-in'); // p1: 100
    t.act('call'); // p2 covers

    expect(t.engine.gameState.handInProgress).toBe(false);
    expect(t.chips()).toEqual({ p0: 150, p1: 100, p2: 100 });

    const showdown = t.last('showdown')!;
    expect(showdown.pots).toEqual([
      { amount: 150, winnerIds: ['p0'], handName: 'One Pair' },
      { amount: 100, winnerIds: ['p1'], handName: 'One Pair' },
    ]);
    // Each player's total covers every pot they won, including side pots
    const won = Object.fromEntries(showdown.results.map(r => [r.playerId, r.winAmount]));
    expect(won).toEqual({ p0: 150, p1: 100, p2: 0 });
  });

  it('returns the part of a bet nobody called instead of paying it out as a pot', () => {
    const t = table([200, 50], stackedDeck(['Kc Kd', 'Ac Ad'], DRY_BOARD));
    t.engine.startHand();

    t.act('raise', 99); // button raises to 100
    t.act('call'); // big blind calls all-in for 50 total

    expect(t.chips()).toEqual({ p0: 150, p1: 100 });
    const showdown = t.last('showdown')!;
    expect(showdown.pots).toEqual([{ amount: 100, winnerIds: ['p1'], handName: 'One Pair' }]);
  });

  it('gives the odd chip of a split pot to the first winner left of the button', () => {
    const t = table([200, 200, 200], stackedDeck(['2c 3d', '4c 5d', '6c 7d'], 'Ah Kh Qh Jh Th'));
    t.engine.startHand();

    t.act('call'); // p0
    t.act('fold'); // p1 leaves its small blind behind: the pot is 5
    t.act('check'); // p2
    for (let street = 0; street < 3; street++) {
      t.act('check'); // p2
      t.act('check'); // p0
    }

    // The board plays for both; seat 2 sits closer to the button's left than seat 0
    expect(t.chips()).toEqual({ p0: 200, p1: 199, p2: 201 });
    expect(t.last('showdown')!.pots).toEqual([
      { amount: 5, winnerIds: ['p2', 'p0'], handName: 'Royal Flush' },
    ]);
  });

  it('awards the pot when everyone else folds, minus the uncalled big blind', () => {
    const t = table([200, 200]);
    t.engine.startHand();
    t.act('fold');

    expect(t.chips()).toEqual({ p0: 199, p1: 201 });
    expect(t.last('showdown')!.results).toEqual([
      { playerId: 'p1', cards: [], hand: null, winAmount: 2 },
    ]);
  });
});

describe('seating', () => {
  it('moves the button to the next occupied seat when the dealer busts', () => {
    const engine = new GameEngine('ROOM', 'a', () => {}, { random: () => 1 });
    engine.addPlayer('a', 'A', 0);
    engine.addPlayer('b', 'B', 2);
    engine.addPlayer('c', 'C', 4);

    engine.startHand();
    expect(engine.gameState.dealerSeatIndex).toBe(2);
    engine.handleAction('b', 'fold'); // button, under the gun three-handed
    engine.handleAction('c', 'fold'); // small blind

    engine.getPlayerById('b')!.chips = 0;
    engine.startHand();
    expect(engine.gameState.dealerSeatIndex).toBe(4); // not back to the lowest seat
  });

  it('sits a player who joins mid-hand out until the next deal without moving the turn', () => {
    const t = table([200, 200, 200]);
    t.engine.startHand();
    expect(t.active()).toBe('p0');

    expect(t.engine.addPlayer('late', 'Late', 5)).toBe(true);
    expect(t.active()).toBe('p0');
    const late = t.engine.getPlayerById('late')!;
    expect(late.hasFolded).toBe(true);
    expect(late.holeCards).toHaveLength(0);

    t.act('fold');
    t.act('fold');
    expect(t.engine.gameState.handInProgress).toBe(false);

    t.engine.startHand();
    expect(t.engine.getPlayerById('late')!.holeCards).toHaveLength(2);
  });

  it('ends the hand at once when a disconnect leaves one player', () => {
    const t = table([200, 200]);
    t.engine.startHand();
    expect(t.active()).toBe('p0');

    t.engine.removePlayer('p1');

    expect(t.engine.gameState.handInProgress).toBe(false);
    expect(t.last('showdown')!.results[0]).toMatchObject({ playerId: 'p0', winAmount: 2 });
    expect(t.engine.canStartHand()).toBe(false);
  });
});

describe('random play', () => {
  it('never creates or destroys chips and always finishes the hand', () => {
    const random = seeded(2026);
    let hands = 0;

    for (let tableNo = 0; tableNo < 40; tableNo++) {
      const seats = 2 + random(5);
      const stacks = Array.from({ length: seats }, () => 1 + random(300));
      const t = table(stacks, () => shuffleDeck(createDeck(), random));
      const total = stacks.reduce((a, b) => a + b, 0);

      while (t.engine.canStartHand() && hands < 600) {
        t.engine.startHand();
        hands++;
        let guard = 0;
        while (t.engine.gameState.handInProgress) {
          expect(++guard).toBeLessThan(200);
          const player = t.engine.getActivePlayer()!;
          const options = t.engine.getValidActions(player);
          const choice = options[random(options.length)];
          const amount = choice.action === 'raise'
            ? choice.minAmount! + random(choice.maxAmount! - choice.minAmount! + 1)
            : choice.minAmount;
          expect(t.engine.handleAction(player.id, choice.action, amount)).toBe(true);
        }

        const stacksNow = Object.values(t.chips());
        expect(stacksNow.reduce((a, b) => a + b, 0)).toBe(total);
        expect(stacksNow.every(c => Number.isInteger(c) && c >= 0)).toBe(true);
        expect(t.engine.gameState.activePlayerId).toBeNull();
      }
    }
    expect(hands).toBe(600);
  });
});
