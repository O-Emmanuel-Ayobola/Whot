import {
  Action, BountyId, Card, CardValue, ClientView, EmoteId, GameEvent, GameState, PerkId, PlayerState,
  PublicCard, Shape
} from "./types";

const ACTIONS = new Set([1, 2, 5, 8, 14, 20]);
const shapes: Shape[] = ["circle", "triangle", "cross", "square", "star"];

export function isActionCard(card: Card): boolean {
  return ACTIONS.has(card.value);
}

export function canPlay(
  card: Card,
  top: Card | null,
  activeShape: Shape,
  pendingDraw: number,
  pendingSource: "PICK_TWO" | "PICK_THREE" | null = null,
  pickThreeEnabled = false,
): boolean {
  if (!top) return true;
  if (pendingDraw > 0) {
    if (pendingSource === "PICK_TWO") return card.value === 2;
    if (pendingSource === "PICK_THREE") return pickThreeEnabled && card.value === 5;
    return false;
  }
  return card.value === 20 || card.shape === activeShape || card.value === top.value;
}

function nextIndex(state: GameState, from = state.currentPlayerIndex): number {
  for (let step = 1; step <= state.players.length; step += 1) {
    const index = (from + step) % state.players.length;
    if (state.players[index].connected) return index;
  }
  return from;
}

function cloneState(state: GameState): GameState {
  return structuredClone(state);
}

function player(state: GameState, token: string): PlayerState {
  const p = state.players.find(x => x.token === token);
  if (!p) throw new Error("Unknown player");
  return p;
}

function currentPlayer(state: GameState): PlayerState {
  return state.players[state.currentPlayerIndex];
}

function topCard(state: GameState): Card | null {
  return state.discardPile[state.discardPile.length - 1] ?? null;
}

function publicCard(card: Card): PublicCard {
  return { id: card.id, value: card.value, shape: card.shape };
}

function event(
  state: GameState,
  events: GameEvent[],
  e: GameEvent
): void {
  events.push(e);
}

function drawOne(state: GameState, token: string): Card {
  if (state.drawPile.length === 0) {
    // Keep the top discard card face-up and recycle every other discard.
    const top = state.discardPile.pop();
    const recycled = state.discardPile.splice(0);
    // Fisher-Yates shuffle so recycled cards do not repeat predictably.
    for (let i = recycled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [recycled[i], recycled[j]] = [recycled[j], recycled[i]];
    }
    state.drawPile = recycled;
    if (top) state.discardPile.push(top);
  }
  const card = state.drawPile.shift();
  if (!card) throw new Error("No cards available");
  player(state, token).hand.push(card);
  return card;
}

function drawMany(state: GameState, token: string, count: number): number {
  let drawn = 0;
  for (let i = 0; i < count; i += 1) {
    try {
      drawOne(state, token);
      drawn += 1;
    } catch {
      break;
    }
  }
  return drawn;
}

function advance(state: GameState, timestamp: number, events: GameEvent[], skip = 0): void {
  let next = state.currentPlayerIndex;
  for (let step = 0; step <= skip; step += 1) next = nextIndex(state, next);
  state.currentPlayerIndex = next;
  state.turnSequence += 1;
  state.turnStartedAt = timestamp;
  event(state, events, {
    type: "TURN_STARTED",
    playerToken: currentPlayer(state).token,
    turnSequence: state.turnSequence,
    timestamp
  });
}

function completeBounty(state: GameState, token: string, id: BountyId, events: GameEvent[]): void {
  if (!state.settings.perksEnabled) return;
  const b = state.private[token]?.bounties.find(x => x.id === id);
  if (!b || b.completed) return;
  b.completed = true;
  b.progress = Math.max(b.progress, 1);
  const perkIds: PerkId[] = ["SHIELD", "PEEK", "SWAP"];
  const reward = perkIds[Math.floor(Math.random() * perkIds.length)];
  const privateState = state.private[token];
  if (privateState) privateState.perks[reward] = (privateState.perks[reward] ?? 0) + 1;
  event(state, events, { type: "BOUNTY_COMPLETED", playerToken: token, bountyId: id });
  event(state, events, { type: "SECRET_BOUNTY_COMPLETED" });
}

function checkWin(state: GameState, token: string, events: GameEvent[]): boolean {
  const p = player(state, token);
  if (p.hand.length !== 0) return false;
  state.winnerToken = token;
  event(state, events, { type: "PLAYER_WON", playerToken: token });
  return true;
}

function bountyAfterPlay(state: GameState, token: string, card: Card, events: GameEvent[]): void {
  const p = player(state, token);
  const whotBounty = state.private[token]?.bounties.find(x => x.id === "WHOT_OUT");
  if (whotBounty && !whotBounty.completed) whotBounty.progress = card.value === 20 && p.hand.length === 0 ? 1 : 0;
  if (card.value === 20 && p.hand.length === 0) completeBounty(state, token, "WHOT_OUT", events);

  const b = state.private[token]?.bounties.find(x => x.id === "ACTION_COUNTER");
  const previous = state.discardPile[state.discardPile.length - 2];
  if (b && !b.completed && isActionCard(card) && previous && isActionCard(previous)) {
    b.progress = 1;
    completeBounty(state, token, "ACTION_COUNTER", events);
  }

  const clean = state.cleanSweepSequence;
  if (clean && clean.playerToken === token && clean.turnSequence === state.turnSequence) {
    clean.cardsPlayed += 1;
    const cleanBounty = state.private[token]?.bounties.find(x => x.id === "CLEAN_SWEEP");
    if (cleanBounty && !cleanBounty.completed) cleanBounty.progress = Math.min(3, clean.cardsPlayed);
    if (clean.cardsPlayed >= 3) completeBounty(state, token, "CLEAN_SWEEP", events);
  }
}

function recordPenaltyTarget(state: GameState, target: string): void {
  if (!state.roundPenaltyTargets.includes(target)) state.roundPenaltyTargets.push(target);
}

function maybeDoubleTrouble(state: GameState, token: string, events: GameEvent[]): void {
  const b = state.private[token]?.bounties.find(x => x.id === "DOUBLE_TROUBLE");
  if (!b || b.completed) return;
  b.progress = Math.min(2, state.roundPenaltyTargets.length);
  if (b.progress >= 2) completeBounty(state, token, "DOUBLE_TROUBLE", events);
}

export function createInitialState(
  roomId: string,
  players: Array<Pick<PlayerState, "token" | "name" | "connected">>,
  drawPile: Card[],
  settings: import("./types").RoomSettings
): GameState {
  if (players.length < 2 || players.length > 6) throw new Error("A game requires 2-6 players");
  const pile = structuredClone(drawPile);
  const openingCard = pile.shift();
  if (!openingCard) throw new Error("Deck is empty");
  const activeShape = openingCard.shape ?? shapes[0];
  const playerStates: PlayerState[] = players.map(p => ({ ...p, hand: [] }));
  const privateState = Object.fromEntries(playerStates.map(p => [p.token, createPrivatePlayerState(p.token, settings.perksEnabled)]));
  return {
    version: 1, roomId, players: playerStates, private: privateState, drawPile: pile,
    discardPile: [openingCard], openingCardResolved: true, activeShape, currentPlayerIndex: 0,
    turnSequence: 0, turnStartedAt: 0, settings, pendingDraw: null, winnerToken: null,
    roundPenaltyTargets: [], lastEmote: null, lastReactionAt: 0, cleanSweepSequence: null, lastCardPendingToken: null, eventLog: []
  };
}

export function createStandardDeck(): Card[] {
  // Standard 54-card Nigerian Whot composition.
  const suitValues: Record<Shape, CardValue[]> = {
    circle: [1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14],
    triangle: [1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14],
    cross: [1, 2, 3, 5, 7, 10, 11, 13, 14],
    square: [1, 2, 3, 5, 7, 10, 11, 13, 14],
    star: [1, 2, 3, 4, 5, 7, 8],
  };
  const deck: Card[] = [];
  for (const shape of shapes) for (const value of suitValues[shape]) deck.push({ id: `${shape}-${value}`, value, shape });
  for (let i = 1; i <= 5; i += 1) deck.push({ id: `whot-20-${i}`, value: 20, shape: null });
  return deck;
}

export function cardPenaltyValue(card: Card): number {
  if (card.value === 20) return 20;
  return card.shape === "star" ? card.value * 2 : card.value;
}

export function handPenaltyScore(hand: Card[]): number {
  return hand.reduce((total, card) => total + cardPenaltyValue(card), 0);
}

export function createPrivatePlayerState(_playerToken: string, perksEnabled = true): import("./types").PrivatePlayerState {
  const bountyIds: BountyId[] = ["WHOT_OUT", "DOUBLE_TROUBLE", "ACTION_COUNTER", "CLEAN_SWEEP", "SHAPE_SNIPER"];
  const shuffled = [...bountyIds];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  if (!perksEnabled) return { bounties: [], perks: {}, peekedCards: [] };
  const perkIds: PerkId[] = ["SHIELD", "PEEK", "SWAP"];
  const perk = perkIds[Math.floor(Math.random() * perkIds.length)];
  return {
    bounties: shuffled.slice(0, 2).map(id => ({ id, progress: 0, completed: false })),
    perks: { [perk]: 1 },
    peekedCards: []
  };
}

export function applyAction(
  state: GameState,
  action: Action,
  timestamp: number
): { nextState: GameState; events: GameEvent[] } {
  const nextState = cloneState(state);
  const events: GameEvent[] = [];
  const finalize = () => {
    nextState.eventLog = [...(nextState.eventLog ?? []), ...events].slice(-24);
    return { nextState, events };
  };

  if (nextState.winnerToken) throw new Error("Game is already finished");

  if (action.type === "EMOTE") {
    const allowed: EmoteId[] = ["GBAM","OYA_OYA","SHARP_SHARP","NA_SO","PEPPER_DEM","CHAI","KAI","NA_WA","E_DON_HAPPEN","CHOP_KNUCKLE","CHECK_UP","LAST_CARD","I_DEY_ONE","EHEN_SEE","I_DON_WIN","DEM_GO_HEAR","BABA_SHOW","SIT_DOWN","NO_WAHALA","E_GO_BETTER","RUN_AM_BACK","SAPA","YOU_DEY_WHOT","SHEY_SURE","CALM_DOWN","SEE_PRESSURE","ESE_O","DAALU","NAGODE","SORRY_O","KPELE","WELL_PLAYED","OMO","NA_SO_BIG","WALAHI","E_CHOKE"];
    if (!allowed.includes(action.emote)) throw new Error("Invalid emote");
    const emoter = nextState.players.find((player) => player.token === action.playerToken);
    if (!emoter || !emoter.connected) throw new Error("Player is not at the table");
    if (nextState.lastEmote && timestamp - nextState.lastReactionAt < 1800) throw new Error("Slow down — reactions are limited to one every 2 seconds");
    nextState.lastReactionAt = timestamp;
    nextState.lastEmote = { playerToken: action.playerToken, emote: action.emote, at: timestamp };
    return finalize();
  }

  const active = currentPlayer(nextState);

  if (action.type === "TIMEOUT") {
    if (action.playerToken !== active.token) throw new Error("Not your turn");
    if (timestamp - nextState.turnStartedAt < nextState.settings.turnTimerSeconds * 1000) {
      throw new Error("Turn has not expired");
    }
    const drawn = drawMany(nextState, action.playerToken, 1);
    if (drawn > 0) event(nextState, events, { type: "CARD_DRAWN", playerToken: action.playerToken, count: drawn, timestamp });
    advance(nextState, timestamp, events);
    return finalize();
  }

  if (action.type === "USE_PERK") {
    if (!nextState.settings.perksEnabled) throw new Error("Perks are disabled");
    const privateState = nextState.private[action.playerToken];
    if (!privateState || (privateState.perks[action.perk] ?? 0) < 1) throw new Error("Perk unavailable");

    if (action.perk === "SHIELD") {
      if (!nextState.pendingDraw || action.playerToken !== currentPlayer(nextState).token) {
        throw new Error("Shield requires an active pending draw on you");
      }
      privateState.perks.SHIELD = (privateState.perks.SHIELD ?? 0) - 1;
      nextState.pendingDraw = null;
      event(nextState, events, { type: "PERK_USED", playerToken: action.playerToken, perk: "SHIELD" });
      return finalize();
    }

    if (action.perk === "PEEK") {
      privateState.perks.PEEK = (privateState.perks.PEEK ?? 0) - 1;
      privateState.peekedCards = nextState.drawPile.slice(0, 3);
      event(nextState, events, { type: "PERK_USED", playerToken: action.playerToken, perk: "PEEK" });
      return finalize();
    }

    if (action.perk === "SWAP") {
      const target = action.targetPlayerToken;
      if (!target || target === action.playerToken) throw new Error("Swap requires another player");
      const targetPlayer = player(nextState, target);
      const me = player(nextState, action.playerToken);
      if (!me.hand.length || !targetPlayer.hand.length) throw new Error("Both players need cards");
      privateState.perks.SWAP = (privateState.perks.SWAP ?? 0) - 1;
      const seed = Array.from(`${nextState.version}:${nextState.turnSequence}:${action.playerToken}:${target}`)
        .reduce((h, ch) => ((h * 31) + ch.charCodeAt(0)) >>> 0, 2166136261);
      const a = seed % me.hand.length;
      const b = ((seed >>> 8) % targetPlayer.hand.length);
      [me.hand[a], targetPlayer.hand[b]] = [targetPlayer.hand[b], me.hand[a]];
      event(nextState, events, { type: "PERK_USED", playerToken: action.playerToken, perk: "SWAP", targetPlayerToken: target });
      return finalize();
    }
  }

  if (action.type === "CALL_LAST_CARD") {
    const caller = player(nextState, action.playerToken);
    const target = player(nextState, action.targetPlayerToken);
    if (!caller.connected || !target.connected) throw new Error("Player is not at the table");

    if (action.targetPlayerToken === action.playerToken) {
      if (caller.hand.length !== 1 || nextState.lastCardPendingToken !== caller.token) {
        throw new Error("You can only call Last Card when you have exactly one card");
      }
      nextState.lastCardPendingToken = null;
      event(nextState, events, { type: "LAST_CARD_CALLED", callerToken: caller.token, targetPlayerToken: caller.token });
      return finalize();
    }

    if (target.hand.length !== 1 || nextState.lastCardPendingToken !== target.token) {
      throw new Error("That player cannot be caught right now");
    }
    const drawn = drawMany(nextState, target.token, 2);
    nextState.lastCardPendingToken = null;
    event(nextState, events, { type: "LAST_CARD_CALLED", callerToken: caller.token, targetPlayerToken: target.token });
    if (drawn > 0) event(nextState, events, { type: "CARD_DRAWN", playerToken: target.token, count: drawn, timestamp });
    return finalize();
  }

  if (action.playerToken !== active.token) throw new Error("Not your turn");

  if (nextState.lastCardPendingToken === active.token) {
    const drawn = drawMany(nextState, active.token, 2);
    nextState.lastCardPendingToken = null;
    if (drawn > 0) event(nextState, events, { type: "CARD_DRAWN", playerToken: active.token, count: drawn, timestamp });
    if (drawn > 0) recordPenaltyTarget(nextState, active.token);
    if (drawn > 0) maybeDoubleTrouble(nextState, active.token, events);
  }

  const top = topCard(nextState);
  if (action.type !== "USE_PERK") {
    const privateState = nextState.private[action.playerToken];
    if (privateState) privateState.peekedCards = [];
  }

  if (action.type === "DRAW") {
    if (nextState.pendingDraw) {
      const amount = nextState.pendingDraw.amount;
      const initiator = nextState.pendingDraw.initiatedBy;
      const p = player(nextState, action.playerToken);
      const drawn = drawMany(nextState, p.token, amount);
      recordPenaltyTarget(nextState, p.token);
      maybeDoubleTrouble(nextState, initiator, events);
      nextState.pendingDraw = null;
      event(nextState, events, { type: "CARD_DRAWN", playerToken: p.token, count: drawn, timestamp });
      advance(nextState, timestamp, events);
      return finalize();
    }

    const drawn = drawMany(nextState, action.playerToken, 1);
    if (drawn > 0) event(nextState, events, { type: "CARD_DRAWN", playerToken: action.playerToken, count: drawn, timestamp });
    advance(nextState, timestamp, events);
    return finalize();
  }

  if (action.type === "PLAY_CARD") {
    const p = active;
    const index = p.hand.findIndex(c => c.id === action.cardId);
    if (index < 0) throw new Error("Card not in hand");
    const card = p.hand[index];

    if (!canPlay(card, top, nextState.activeShape, nextState.pendingDraw?.amount ?? 0, nextState.pendingDraw?.source ?? null, nextState.settings.pickThree)) {
      throw new Error("Card is not playable");
    }

    if (card.value === 20 && !action.chosenShape) throw new Error("Whot requires a shape");
    if (action.chosenShape && !shapes.includes(action.chosenShape)) throw new Error("Invalid shape");

    if (nextState.pendingDraw) {
      const canStackTwo = card.value === 2 && nextState.pendingDraw.source === "PICK_TWO" && nextState.settings.stackPickTwo;
      const canStackFive = card.value === 5 && nextState.pendingDraw.source === "PICK_THREE" && nextState.settings.pickThree;
      if (!canStackTwo && !canStackFive) throw new Error("Pending penalty must be resolved or stacked");
    }

    p.hand.splice(index, 1);
    nextState.discardPile.push(card);
    if (card.value !== 20 && card.shape) nextState.activeShape = card.shape;
    if (card.value === 20) nextState.activeShape = action.chosenShape!;

    event(nextState, events, { type: "CARD_PLAYED", playerToken: p.token, card: publicCard(card), timestamp });

      // Winning on any action is immediate: no effect resolves.
    if (p.hand.length === 0) {
      if (card.value === 20) completeBounty(nextState, p.token, "WHOT_OUT", events);
      checkWin(nextState, p.token, events);
      return finalize();
    }

    if (p.hand.length === 1) nextState.lastCardPendingToken = p.token;

    // Action bounty checks must occur before resolving the card effect.
    bountyAfterPlay(nextState, p.token, card, events);

    // Pick Two can stack only on another Pick Two when the house rule allows it.
    if (card.value === 2) {
      if (nextState.pendingDraw) nextState.pendingDraw.amount += 2;
      else nextState.pendingDraw = { amount: 2, source: "PICK_TWO", initiatedBy: p.token };
      event(nextState, events, { type: "PICK_TWO_PENDING", playerToken: p.token, amount: nextState.pendingDraw.amount });
      advance(nextState, timestamp, events);
      return finalize();
    }

    if (card.value === 5 && nextState.settings.pickThree) {
      if (nextState.pendingDraw) nextState.pendingDraw.amount += 3;
      else nextState.pendingDraw = { amount: 3, source: "PICK_THREE", initiatedBy: p.token };
      event(nextState, events, { type: "PICK_THREE_PENDING", playerToken: p.token, amount: 3 });
      advance(nextState, timestamp, events);
      return finalize();
    }

    if (nextState.pendingDraw) throw new Error("Pending draw must be resolved");

    if (card.value === 1 && nextState.settings.holdOn) {
      nextState.cleanSweepSequence = { playerToken: p.token, cardsPlayed: 1, turnSequence: nextState.turnSequence };
      event(nextState, events, { type: "TURN_SKIPPED", playerToken: p.token, reason: "HOLD_ON" });
      // Immediate additional turn: current player remains active.
      nextState.turnStartedAt = timestamp;
      nextState.turnSequence += 1;
      event(nextState, events, { type: "TURN_STARTED", playerToken: p.token, turnSequence: nextState.turnSequence, timestamp });
      return finalize();
    }

    if (card.value === 8 && nextState.settings.suspension) {
      event(nextState, events, { type: "TURN_SKIPPED", playerToken: p.token, reason: "SUSPENSION" });
      advance(nextState, timestamp, events, 1);
      return finalize();
    }

    if (card.value === 14 && nextState.settings.generalMarket) {
      const affected: string[] = [];
      for (const opponent of nextState.players) {
        if (opponent.token === p.token) continue;
        const drawn = drawMany(nextState, opponent.token, 1);
        if (drawn > 0) {
          affected.push(opponent.token);
          recordPenaltyTarget(nextState, opponent.token);
        }
      }
      maybeDoubleTrouble(nextState, p.token, events);
      event(nextState, events, { type: "GENERAL_MARKET", playerToken: p.token, affectedPlayers: affected });
      nextState.roundPenaltyTargets = [];
      // General Market is a repeat-turn card: the player who dropped 14 continues.
      nextState.turnSequence += 1;
      nextState.turnStartedAt = timestamp;
      event(nextState, events, { type: "TURN_STARTED", playerToken: p.token, turnSequence: nextState.turnSequence, timestamp });
      return finalize();
    }

    // Ordinary card / Whot passes turn.
    if (card.value === 20) {
      const targetIndex = nextIndex(nextState);
      const target = nextState.players[targetIndex];
      const targetHasPlayable = target.hand.some(c => canPlay(c, card, nextState.activeShape, 0, null, nextState.settings.pickThree));
      const b = nextState.private[p.token]?.bounties.find(x => x.id === "SHAPE_SNIPER");
      if (b && !b.completed && !targetHasPlayable) {
        b.progress = 1;
        completeBounty(nextState, p.token, "SHAPE_SNIPER", events);
      }
    }

    if (nextState.cleanSweepSequence?.playerToken === p.token &&
        nextState.cleanSweepSequence.turnSequence === nextState.turnSequence) {
      // Sequence is continued only by another immediate Hold-On turn.
    } else {
      nextState.cleanSweepSequence = null;
    }

    advance(nextState, timestamp, events);
    return finalize();
  }

  throw new Error("Unsupported action");
}

export function getSpectatorClientView(state: GameState): Omit<ClientView, "match"> {
  return {
    roomId: state.roomId,
    stateVersion: state.version,
    players: state.players.map(p => ({ token: p.token, name: p.name, handCount: p.hand.length, connected: p.connected })),
    topCard: topCard(state) ? publicCard(topCard(state)!) : null,
    activeShape: state.activeShape,
    currentPlayerToken: currentPlayer(state)?.token ?? null,
    turnStartedAt: state.turnStartedAt,
    turnTimerSeconds: state.settings.turnTimerSeconds,
    pendingDraw: state.pendingDraw?.amount ?? 0,
    settings: { ...state.settings },
    winnerToken: state.winnerToken,
    gameStatus: state.winnerToken ? "won" : "playing",
    yourHand: [],
    spectator: true,
    yourBounties: [],
    yourPerks: {},
    peekedCards: [],
    drawPileCount: state.drawPile.length,
    recentEvents: (state.eventLog ?? []).filter(event => event.type !== "BOUNTY_COMPLETED"),
    lastEmote: state.lastEmote ? {
      playerToken: state.lastEmote.playerToken,
      playerName: state.players.find(p => p.token === state.lastEmote!.playerToken)?.name ?? "Player",
      emote: state.lastEmote.emote,
      at: state.lastEmote.at,
    } : null,
  };
}

export function getSanitizedClientView(state: GameState, playerToken: string): Omit<ClientView, "match"> {
  const me = state.players.find(p => p.token === playerToken);
  if (!me) throw new Error("Unknown player");

  return {
    roomId: state.roomId,
    stateVersion: state.version,
    players: state.players.map(p => ({
      token: p.token,
      name: p.name,
      handCount: p.hand.length,
      connected: p.connected
    })),
    topCard: topCard(state) ? publicCard(topCard(state)!) : null,
    activeShape: state.activeShape,
    currentPlayerToken: currentPlayer(state)?.token ?? null,
    turnStartedAt: state.turnStartedAt,
    turnTimerSeconds: state.settings.turnTimerSeconds,
    pendingDraw: state.pendingDraw?.amount ?? 0,
    settings: { ...state.settings },
    winnerToken: state.winnerToken,
    gameStatus: state.winnerToken ? "won" : "playing",
    yourHand: me.hand.map(publicCard),
    yourBounties: structuredClone(state.private[playerToken]?.bounties ?? []),
    yourPerks: structuredClone(state.private[playerToken]?.perks ?? {}),
    peekedCards: (state.private[playerToken]?.peekedCards ?? []).map(publicCard),
    drawPileCount: state.drawPile.length,
    recentEvents: (state.eventLog ?? []).filter(event => event.type !== "BOUNTY_COMPLETED"),
    lastEmote: state.lastEmote ? {
      playerToken: state.lastEmote.playerToken,
      playerName: state.players.find((player) => player.token === state.lastEmote!.playerToken)?.name ?? "Player",
      emote: state.lastEmote.emote,
      at: state.lastEmote.at,
    } : null,
  };
}
