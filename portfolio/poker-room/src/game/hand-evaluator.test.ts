import { describe, expect, it } from 'vitest';
import { compareHands, evaluateBestHand } from './hand-evaluator';
import { HandRank } from './types';
import { cards } from '../test/helpers';

const best = (codes: string) => evaluateBestHand(cards(codes));
const beats = (a: string, b: string) => compareHands(best(a), best(b));

describe('evaluateBestHand', () => {
  it.each([
    ['Ah Kh Qh Jh Th 2c 3d', HandRank.RoyalFlush],
    ['9s 8s 7s 6s 5s Ah Ad', HandRank.StraightFlush],
    ['Ac 2c 3c 4c 5c Kd Kh', HandRank.StraightFlush], // steel wheel
    ['Qs Qh Qd Qc 2s 3h 4d', HandRank.FourOfAKind],
    ['Js Jh Jd 4c 4s 9h 2d', HandRank.FullHouse],
    ['Ah 9h 7h 4h 2h Kd Qc', HandRank.Flush],
    ['Ts 9h 8d 7c 6s 2h 2d', HandRank.Straight],
    ['As 2h 3d 4c 5s Kh Qd', HandRank.Straight], // wheel
    ['7s 7h 7d Kc 2s 9h 4d', HandRank.ThreeOfAKind],
    ['Ks Kh 5d 5c 9s 2h 3d', HandRank.TwoPair],
    ['Ts Th 8d 4c 2s Kh Qd', HandRank.OnePair],
    ['As Jh 8d 6c 3s 2h 9d', HandRank.HighCard],
  ])('ranks %s', (hand, rank) => {
    expect(best(hand).rank).toBe(rank);
  });

  it('picks the best five of seven cards', () => {
    const hand = best('Ah Ad Ac Kh Kd 2s 3s');
    expect(hand.rank).toBe(HandRank.FullHouse);
    expect(hand.values).toEqual([14, 13]);
    expect(hand.cards).toHaveLength(5);
  });

  it('keeps the two highest pairs and the best kicker out of three pairs', () => {
    expect(best('Ks Kh 9d 9c 4s 4h Ad').values).toEqual([13, 9, 14]);
  });
});

describe('compareHands', () => {
  it('orders categories', () => {
    expect(beats('Ah 9h 7h 4h 2h Kd Qc', 'Ts 9h 8d 7c 6s 2h 2d')).toBeGreaterThan(0); // flush > straight
    expect(beats('Js Jh Jd 4c 4s 9h 2d', 'Ah 9h 7h 4h 2h Kd Qc')).toBeGreaterThan(0); // boat > flush
  });

  it('ranks the wheel as the lowest straight', () => {
    expect(beats('2s 3h 4d 5c 6s Kh Qd', 'As 2h 3d 4c 5s Kh Qd')).toBeGreaterThan(0);
  });

  it('settles equal pairs by kicker', () => {
    expect(beats('As Ah Kd 7c 3s 2h 9d', 'Ac Ad Qd 7h 3c 2s 9c')).toBeGreaterThan(0);
  });

  it('compares full houses on the trips first', () => {
    expect(beats('3s 3h 3d 2c 2s 9h 8d', '2h 2d 2c As Ah 9c 8c')).toBeGreaterThan(0);
  });

  it('ties when the board plays for both players', () => {
    expect(beats('2c 3d Ah Kh Qh Jh Th', '4c 5d Ah Kh Qh Jh Th')).toBe(0);
  });
});
