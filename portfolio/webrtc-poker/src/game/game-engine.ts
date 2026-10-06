import {
  Card, Player, GameState, BettingRound, PlayerAction,
  ValidAction, SidePot, HandResult, ShowdownResult, PotResult,
  PlayerPublicInfo, EvaluatedHand,
} from './types';
import { HandDeck, RandomInt, createDeck, randomInt, shuffleDeck } from './deck';
import { evaluateBestHand, compareHands } from './hand-evaluator';

export const ACTION_TIMEOUT = 30_000; // 30 seconds

export type GameEvent =
  | { type: 'hand_start'; dealerSeat: number; handNumber: number; players: PlayerPublicInfo[] }
  | { type: 'hole_cards'; playerId: string; cards: Card[] }
  | { type: 'community'; cards: Card[]; round: BettingRound }
  | { type: 'action_on'; playerId: string; validActions: ValidAction[]; pot: number; currentBet: number; timeDeadline: number }
  | { type: 'player_acted'; playerId: string; action: PlayerAction; amount: number; pot: number; playerChips: number }
  | { type: 'pot_update'; pot: number }
  | { type: 'showdown'; results: ShowdownResult[]; pots: PotResult[] }
  | { type: 'hand_end'; players: PlayerPublicInfo[] };

export interface EngineOptions {
  /** Picks the first button. Defaults to a crypto-backed uniform draw. */
  random?: RandomInt;
  /** Supplies the ordered deck for each hand. Tests pass stacked decks; defaults to a fresh shuffle. */
  deck?: () => Card[];
}

export class GameEngine {
  private state: GameState;
  private deck: HandDeck | null = null;
  private onEvent: (event: GameEvent) => void;
  private actionTimer: ReturnType<typeof setTimeout> | null = null;
  private random: RandomInt;
  private nextDeck: () => Card[];
  private bigBlindSeat = -1;

  constructor(roomCode: string, hostId: string, onEvent: (event: GameEvent) => void, options: EngineOptions = {}) {
    this.onEvent = onEvent;
    this.random = options.random ?? randomInt;
    this.nextDeck = options.deck ?? (() => shuffleDeck(createDeck()));
    this.state = {
      roomCode,
      hostId,
      players: [],
      dealerSeatIndex: -1,
      smallBlind: 1,
      bigBlind: 2,
      buyIn: 200,
      handInProgress: false,
      bettingRound: 'preflop',
      communityCards: [],
      pot: 0,
      currentBet: 0,
      minRaise: 2,
      lastRaiseAmount: 2,
      activePlayerId: null,
      actionTimerDeadline: null,
      winners: null,
      handNumber: 0,
    };
  }

  get gameState(): GameState {
    return this.state;
  }

  // ── Player Management ──

  addPlayer(id: string, name: string, seatIndex: number): boolean {
    if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex > 5) return false;
    if (this.state.players.some(p => p.seatIndex === seatIndex)) return false;
    if (this.state.players.some(p => p.id === id)) return false;
    if (this.state.players.length >= 6) return false;

    this.state.players.push({
      id,
      name,
      seatIndex,
      chips: this.state.buyIn,
      holeCards: [],
      currentBet: 0,
      totalBetThisHand: 0,
      hasActedThisRound: false,
      // Someone who sits down mid-hand waits for the next deal
      hasFolded: this.state.handInProgress,
      isAllIn: false,
      isSittingOut: false,
      isConnected: true,
    });

    // Sort by seat index for consistent ordering
    this.state.players.sort((a, b) => a.seatIndex - b.seatIndex);
    return true;
  }

  removePlayer(id: string): void {
    const player = this.getPlayerById(id);
    if (!player) return;

    if (!this.state.handInProgress) {
      this.state.players = this.state.players.filter(p => p.id !== id);
      return;
    }

    // Mid-hand: the seat stays until the hand ends, but the player is out of it
    player.isConnected = false;
    if (this.getActivePlayer()?.id === id) {
      this.handleAction(id, 'fold');
      return;
    }
    player.hasFolded = true;
    const live = this.state.players.filter(p => !p.hasFolded);
    if (live.length <= 1) {
      this.clearActionTimer();
      this.endHandFold(live[0]);
    }
  }

  setPlayerConnected(id: string, connected: boolean): void {
    const player = this.getPlayerById(id);
    if (player) player.isConnected = connected;
  }

  // ── Hand Flow ──

  canStartHand(): boolean {
    const activePlayers = this.state.players.filter(
      p => p.isConnected && p.chips > 0 && !p.isSittingOut
    );
    return activePlayers.length >= 2 && !this.state.handInProgress;
  }

  startHand(): void {
    if (!this.canStartHand()) return;

    // Remove busted players (0 chips) and disconnected players between hands
    this.state.players = this.state.players.filter(p => p.chips > 0 && p.isConnected);

    this.state.handInProgress = true;
    this.state.handNumber++;
    this.state.communityCards = [];
    this.state.pot = 0;
    this.state.currentBet = 0;
    this.state.minRaise = this.state.bigBlind;
    this.state.lastRaiseAmount = this.state.bigBlind;
    this.state.winners = null;
    this.state.bettingRound = 'preflop';

    // Reset player states
    for (const p of this.state.players) {
      p.holeCards = [];
      p.currentBet = 0;
      p.totalBetThisHand = 0;
      p.hasActedThisRound = false;
      p.hasFolded = p.isSittingOut;
      p.isAllIn = false;
      p.lastAction = undefined;
    }

    this.advanceDealer();
    this.deck = new HandDeck(this.nextDeck());
    this.postBlinds();

    this.onEvent({
      type: 'hand_start',
      dealerSeat: this.state.dealerSeatIndex,
      handNumber: this.state.handNumber,
      players: this.getPublicPlayers(),
    });

    this.dealHoleCards();
    this.startBettingRound();
  }

  private advanceDealer(): void {
    const dealt = this.getDealtPlayers();
    if (dealt.length === 0) return;

    if (this.state.dealerSeatIndex === -1) {
      // First hand: draw for the button
      this.state.dealerSeatIndex = dealt[this.random(dealt.length)].seatIndex;
      return;
    }

    // The button moves to the next occupied seat, even if the previous dealer busted out
    this.state.dealerSeatIndex = this.seatOrderAfter(this.state.dealerSeatIndex, dealt)[0].seatIndex;
  }

  private postBlinds(): void {
    const dealt = this.getDealtPlayers();
    if (dealt.length < 2) return;

    const order = this.seatOrderAfter(this.state.dealerSeatIndex, dealt);
    // Heads-up the dealer posts the small blind; otherwise the two seats after the button do
    const [sbPlayer, bbPlayer] = dealt.length === 2 ? [order[1], order[0]] : [order[0], order[1]];

    this.commitChips(sbPlayer, Math.min(this.state.smallBlind, sbPlayer.chips));
    this.commitChips(bbPlayer, Math.min(this.state.bigBlind, bbPlayer.chips));
    this.bigBlindSeat = bbPlayer.seatIndex;
    this.state.currentBet = this.state.bigBlind;
  }

  private dealHoleCards(): void {
    for (const player of this.getDealtPlayers()) {
      player.holeCards = this.deck!.dealMultiple(2);
      this.onEvent({
        type: 'hole_cards',
        playerId: player.id,
        cards: player.holeCards,
      });
    }
  }

  // ── Betting ──

  private startBettingRound(): void {
    for (const p of this.state.players) {
      p.hasActedThisRound = false;
    }

    // Reset bets for new round (except preflop where blinds are already posted)
    if (this.state.bettingRound !== 'preflop') {
      for (const p of this.state.players) {
        p.currentBet = 0;
        p.lastAction = undefined;
      }
      this.state.currentBet = 0;
      this.state.minRaise = this.state.bigBlind;
      this.state.lastRaiseAmount = this.state.bigBlind;

      // Notify UI that bets are collected into pot
      this.onEvent({ type: 'pot_update', pot: this.state.pot });
    }

    // A lone player with chips only has a decision if they still face a bet
    // (e.g. an opponent went all-in posting a blind)
    const canBet = this.getPlayersWhoCanAct();
    if (canBet.length <= 1 && !canBet.some(p => p.currentBet < this.state.currentBet)) {
      this.advanceToNextRound();
      return;
    }

    // Preflop the action starts left of the big blind; after that, left of the button
    const startAfter = this.state.bettingRound === 'preflop' ? this.bigBlindSeat : this.state.dealerSeatIndex;
    const first = this.seatOrderAfter(startAfter).find(p => this.canAct(p));
    if (!first) {
      this.advanceToNextRound();
      return;
    }
    this.state.activePlayerId = first.id;
    this.promptAction();
  }

  private promptAction(): void {
    const player = this.getActivePlayer();
    if (!player) {
      this.advanceToNextRound();
      return;
    }

    const validActions = this.getValidActions(player);
    const deadline = Date.now() + ACTION_TIMEOUT;
    this.state.actionTimerDeadline = deadline;

    this.onEvent({
      type: 'action_on',
      playerId: player.id,
      validActions,
      pot: this.state.pot,
      currentBet: this.state.currentBet,
      timeDeadline: deadline,
    });

    // On timeout, check if that's free; otherwise fold
    this.clearActionTimer();
    this.actionTimer = setTimeout(() => {
      if (this.state.handInProgress && this.getActivePlayer()?.id === player.id) {
        const canCheck = this.getValidActions(player).some(a => a.action === 'check');
        this.handleAction(player.id, canCheck ? 'check' : 'fold');
      }
    }, ACTION_TIMEOUT);
  }

  getValidActions(player: Player): ValidAction[] {
    const actions: ValidAction[] = [];
    const toCall = this.state.currentBet - player.currentBet;

    // Can always fold
    actions.push({ action: 'fold' });

    if (toCall <= 0) {
      actions.push({ action: 'check' });
    } else {
      // Calling for less than the full amount puts the player all-in
      const callAmount = Math.min(toCall, player.chips);
      actions.push({ action: 'call', minAmount: callAmount, maxAmount: callAmount });
    }

    // A raise needs chips beyond the call and someone left who could respond to it
    const someoneCanRespond = this.state.players.some(
      p => p.id !== player.id && !p.hasFolded && !p.isAllIn
    );
    if (player.chips > toCall && someoneCanRespond) {
      const minRaiseTotal = this.state.currentBet + this.state.minRaise;
      // An all-in for less than a full raise is still allowed
      const minRaiseAmount = Math.min(minRaiseTotal - player.currentBet, player.chips);
      actions.push({ action: 'raise', minAmount: minRaiseAmount, maxAmount: player.chips });
    }

    return actions;
  }

  /**
   * Applies an action from the player whose turn it is. `amount` is the number of chips
   * to put in now (not the new bet total). Invalid actions are rejected without
   * touching any state, so the turn and its timer carry on.
   */
  handleAction(playerId: string, action: PlayerAction, amount?: number): boolean {
    const player = this.getActivePlayer();
    if (!this.state.handInProgress || !player || player.id !== playerId) return false;

    const valid = this.getValidActions(player);
    const toCall = this.state.currentBet - player.currentBet;

    switch (action) {
      case 'fold':
        player.hasFolded = true;
        player.lastAction = 'fold';
        break;

      case 'check':
        if (!valid.some(a => a.action === 'check')) return false;
        player.lastAction = 'check';
        break;

      case 'call':
        if (!valid.some(a => a.action === 'call')) return false;
        this.commitChips(player, Math.min(toCall, player.chips));
        player.lastAction = player.isAllIn ? 'all-in' : 'call';
        break;

      case 'raise':
      case 'all-in': {
        const chips = action === 'all-in' ? player.chips : amount;
        if (chips === undefined || !Number.isSafeInteger(chips) || chips <= 0) return false;

        // Shoving a stack that doesn't cover the bet is a call for less
        if (chips === player.chips && chips <= toCall) {
          this.commitChips(player, chips);
          player.lastAction = 'all-in';
          break;
        }

        const raise = valid.find(a => a.action === 'raise');
        if (!raise || chips < raise.minAmount! || chips > raise.maxAmount!) return false;

        const newBet = player.currentBet + chips;
        const raiseOver = newBet - this.state.currentBet;
        // Only a full raise changes the minimum for the next one
        if (raiseOver >= this.state.minRaise) {
          this.state.lastRaiseAmount = raiseOver;
          this.state.minRaise = raiseOver;
        }
        this.state.currentBet = Math.max(this.state.currentBet, newBet);
        this.commitChips(player, chips);
        player.lastAction = player.isAllIn ? 'all-in' : 'raise';
        break;
      }

      default:
        return false;
    }

    this.clearActionTimer();
    player.hasActedThisRound = true;

    this.onEvent({
      type: 'player_acted',
      playerId: player.id,
      action: player.lastAction!,
      amount: player.currentBet,
      pot: this.state.pot,
      playerChips: player.chips,
    });

    // Check if hand is over (only 1 player remaining)
    const notFolded = this.state.players.filter(p => !p.hasFolded);
    if (notFolded.length <= 1) {
      this.endHandFold(notFolded[0]);
      return true;
    }

    this.advanceAction();
    return true;
  }

  private advanceAction(): void {
    const current = this.getActivePlayer();
    const next = current ? this.seatOrderAfter(current.seatIndex).find(p => this.canAct(p)) : undefined;

    if (!next) {
      this.advanceToNextRound();
    } else {
      this.state.activePlayerId = next.id;
      this.promptAction();
    }
  }

  /**
   * A player still has a decision this round if they haven't acted yet or someone has
   * bet more since they did. Checking around and calling a bet both close the round.
   */
  private canAct(player: Player): boolean {
    if (player.hasFolded || player.isAllIn || !player.isConnected) return false;
    return !player.hasActedThisRound || player.currentBet < this.state.currentBet;
  }

  private advanceToNextRound(): void {
    this.state.activePlayerId = null;
    const notFolded = this.state.players.filter(p => !p.hasFolded);

    if (notFolded.length <= 1) {
      this.endHandFold(notFolded[0]);
      return;
    }

    const nextRound = this.getNextBettingRound();
    if (!nextRound) {
      this.showdown();
      return;
    }

    this.state.bettingRound = nextRound;
    this.dealCommunityCards(nextRound);

    if (notFolded.filter(p => !p.isAllIn).length <= 1) {
      // Nobody left to bet against: run out the board
      this.advanceToNextRound();
    } else {
      this.startBettingRound();
    }
  }

  private getNextBettingRound(): BettingRound | null {
    switch (this.state.bettingRound) {
      case 'preflop': return 'flop';
      case 'flop': return 'turn';
      case 'turn': return 'river';
      case 'river': return null;
    }
  }

  private dealCommunityCards(round: BettingRound): void {
    if (!this.deck) return;

    // Burn a card before each community deal
    this.deck.burn();

    const count = round === 'flop' ? 3 : 1;
    this.state.communityCards.push(...this.deck.dealMultiple(count));

    this.onEvent({
      type: 'community',
      cards: [...this.state.communityCards],
      round,
    });
  }

  // ── Showdown ──

  private showdown(): void {
    this.returnUncalledBet();
    const live = this.state.players.filter(p => !p.hasFolded);
    const hands = new Map<string, EvaluatedHand>(
      live.map(p => [p.id, evaluateBestHand([...p.holeCards, ...this.state.communityCards])])
    );

    const handResults: HandResult[] = [];
    const potResults: PotResult[] = [];
    const winnings = new Map<string, number>();

    this.calculatePots().forEach((pot, potIndex) => {
      const contenders = live.filter(p => pot.eligiblePlayerIds.includes(p.id));
      const best = contenders
        .map(p => hands.get(p.id)!)
        .reduce((a, b) => (compareHands(a, b) >= 0 ? a : b));

      // Ties split the pot; odd chips go to the winners closest to the button's left
      const winners = this.seatOrderAfter(this.state.dealerSeatIndex, contenders)
        .filter(p => compareHands(hands.get(p.id)!, best) === 0);
      const share = Math.floor(pot.amount / winners.length);
      let oddChips = pot.amount - share * winners.length;

      for (const winner of winners) {
        const amount = share + (oddChips-- > 0 ? 1 : 0);
        winner.chips += amount;
        winnings.set(winner.id, (winnings.get(winner.id) ?? 0) + amount);
        handResults.push({ playerId: winner.id, amount, hand: hands.get(winner.id), potIndex });
      }
      potResults.push({ amount: pot.amount, winnerIds: winners.map(w => w.id), handName: best.name });
    });

    this.state.winners = handResults;

    // Everyone still in shows their hand
    const results: ShowdownResult[] = live.map(p => ({
      playerId: p.id,
      cards: p.holeCards,
      hand: hands.get(p.id)!,
      winAmount: winnings.get(p.id) ?? 0,
    }));

    this.onEvent({ type: 'showdown', results, pots: potResults });
    this.endHand();
  }

  /**
   * Gives back the part of the biggest bet that nobody matched, before pots are built.
   * Without this, a bettor would "win" their own uncalled chips as a side pot.
   */
  private returnUncalledBet(): void {
    const [top, next] = [...this.state.players].sort((a, b) => b.totalBetThisHand - a.totalBetThisHand);
    if (!top) return;
    const uncalled = top.totalBetThisHand - (next?.totalBetThisHand ?? 0);
    if (uncalled <= 0) return;

    top.chips += uncalled;
    top.currentBet -= uncalled;
    top.totalBetThisHand -= uncalled;
    this.state.pot -= uncalled;
    if (top.chips > 0) top.isAllIn = false;
  }

  /**
   * Splits the pot into a main pot and side pots. Each distinct amount a live player put in
   * marks a layer; a layer can be won by every live player who covered it. Folded players'
   * chips stay in the layers they reached, and anything above the top live amount joins the
   * last pot so no chips go missing.
   */
  private calculatePots(): SidePot[] {
    const contributors = this.state.players.filter(p => p.totalBetThisHand > 0);
    const live = contributors.filter(p => !p.hasFolded);
    const levels = [...new Set(live.map(p => p.totalBetThisHand))].sort((a, b) => a - b);

    const pots: SidePot[] = [];
    let floor = 0;
    for (const level of levels) {
      const amount = contributors.reduce(
        (sum, p) => sum + Math.max(0, Math.min(p.totalBetThisHand, level) - floor), 0
      );
      const eligiblePlayerIds = live.filter(p => p.totalBetThisHand >= level).map(p => p.id);
      const last = pots[pots.length - 1];
      // Adjacent layers with the same contenders are a single pot
      if (last && last.eligiblePlayerIds.join() === eligiblePlayerIds.join()) {
        last.amount += amount;
      } else if (amount > 0) {
        pots.push({ amount, eligiblePlayerIds });
      }
      floor = level;
    }

    const dead = contributors.reduce((sum, p) => sum + Math.max(0, p.totalBetThisHand - floor), 0);
    if (dead > 0 && pots.length > 0) pots[pots.length - 1].amount += dead;

    return pots;
  }

  private endHandFold(winner?: Player): void {
    if (winner) {
      this.returnUncalledBet();
      const amount = this.state.pot;
      winner.chips += amount;
      this.state.winners = [{ playerId: winner.id, amount, potIndex: 0 }];

      this.onEvent({
        type: 'showdown',
        results: [{ playerId: winner.id, cards: [], hand: null, winAmount: amount }],
        pots: [{ amount, winnerIds: [winner.id] }],
      });
    }

    this.endHand();
  }

  private endHand(): void {
    this.clearActionTimer();
    this.state.handInProgress = false;
    this.state.activePlayerId = null;

    // Remove disconnected players with no chips (they're gone)
    this.state.players = this.state.players.filter(
      p => p.isConnected || p.chips > 0
    );

    this.onEvent({
      type: 'hand_end',
      players: this.getPublicPlayers(),
    });
  }

  // ── Helpers ──

  /** Moves chips from a player's stack into the pot. */
  private commitChips(player: Player, chips: number): void {
    player.chips -= chips;
    player.currentBet += chips;
    player.totalBetThisHand += chips;
    this.state.pot += chips;
    if (player.chips === 0) player.isAllIn = true;
  }

  /** Players dealt into the current hand (or about to be), in seat order. */
  private getDealtPlayers(): Player[] {
    return this.state.players.filter(p => !p.hasFolded || p.holeCards.length > 0);
  }

  /** Players in seat order, starting from the first seat clockwise after `seat`. */
  private seatOrderAfter(seat: number, players: Player[] = this.state.players): Player[] {
    const sorted = [...players].sort((a, b) => a.seatIndex - b.seatIndex);
    const start = sorted.findIndex(p => p.seatIndex > seat);
    return start <= 0 ? sorted : [...sorted.slice(start), ...sorted.slice(0, start)];
  }

  private getPlayersWhoCanAct(): Player[] {
    return this.state.players.filter(
      p => !p.hasFolded && !p.isAllIn && p.isConnected
    );
  }

  getActivePlayer(): Player | null {
    return this.state.players.find(p => p.id === this.state.activePlayerId) ?? null;
  }

  getPublicPlayers(): PlayerPublicInfo[] {
    return this.state.players.map(p => ({
      id: p.id,
      name: p.name,
      seatIndex: p.seatIndex,
      chips: p.chips,
      currentBet: p.currentBet,
      hasFolded: p.hasFolded,
      isAllIn: p.isAllIn,
      lastAction: p.lastAction,
    }));
  }

  getPlayerById(id: string): Player | undefined {
    return this.state.players.find(p => p.id === id);
  }

  private clearActionTimer(): void {
    if (this.actionTimer) {
      clearTimeout(this.actionTimer);
      this.actionTimer = null;
    }
  }

  destroy(): void {
    this.clearActionTimer();
  }
}
