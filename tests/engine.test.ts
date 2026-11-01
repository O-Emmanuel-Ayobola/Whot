import { describe, expect, test } from "vitest";
import {
  applyAction,
  createInitialState,
  createPrivatePlayerState,
  createStandardDeck,
  getSanitizedClientView,
} from "../src/engine";
import { Card, GameState } from "../src/types";

const c = (id: string, value: Card["value"], shape: Card["shape"]): Card => ({ id, value, shape });

const makePrivate = () => ({
  bounties: [
    { id: "WHOT_OUT" as const, progress: 0, completed: false },
    { id: "DOUBLE_TROUBLE" as const, progress: 0, completed: false },
    { id: "ACTION_COUNTER" as const, progress: 0, completed: false },
    { id: "CLEAN_SWEEP" as const, progress: 0, completed: false },
    { id: "SHAPE_SNIPER" as const, progress: 0, completed: false },
  ],
  perks: { SHIELD: 1 as const, PEEK: 1 as const, SWAP: 1 as const },
  peekedCards: [],
});

const base = (): GameState => ({
  version: 1,
  roomId: "ABCD",
  players: [
    { token: "A", name: "A", hand: [], connected: true },
    { token: "B", name: "B", hand: [], connected: true },
    { token: "C", name: "C", hand: [], connected: true },
  ],
  private: { A: makePrivate(), B: makePrivate(), C: makePrivate() },
  drawPile: [
    c("draw-1", 3, "triangle"),
    c("draw-2", 4, "square"),
    c("draw-3", 5, "star"),
    c("draw-4", 7, "cross"),
    c("draw-5", 10, "circle"),
    c("draw-6", 11, "triangle"),
  ],
  discardPile: [c("top", 7, "circle")],
  openingCardResolved: true,
  activeShape: "circle",
  currentPlayerIndex: 0,
  turnSequence: 0,
  turnStartedAt: 0,
  settings: { stackPickTwo: true, pickThree: false, holdOn: true, suspension: true, generalMarket: true, startingHandSize: 5, turnTimerSeconds: 20, perksEnabled: true },
  pendingDraw: null,
  winnerToken: null,
  roundPenaltyTargets: [],
  lastEmote: null,
  lastReactionAt: 0,
  cleanSweepSequence: null,
});

describe("Whot pure engine", () => {
  test("standard turn sequence", () => {
    const s = base();
    // Keep A alive so the normal turn advances to B.
    s.players[0].hand = [c("a3", 3, "circle"), c("a4", 4, "square")];
    s.players[1].hand = [c("b4", 4, "square")];

    const r = applyAction(s, { type: "PLAY_CARD", playerToken: "A", cardId: "a3" }, 1000);

    expect(r.nextState.currentPlayerIndex).toBe(1);
    expect(r.nextState.discardPile.at(-1)?.id).toBe("a3");
    expect(r.nextState.winnerToken).toBeNull();
  });

  test("Pick Two stacks and the targeted Shield absorbs the entire stack", () => {
    const s = base();
    s.players[0].hand = [c("a2", 2, "circle"), c("a3", 3, "circle")];
    s.players[1].hand = [c("b2", 2, "square"), c("b4", 4, "square")];

    let r = applyAction(s, { type: "PLAY_CARD", playerToken: "A", cardId: "a2" }, 1000);
    expect(r.nextState.pendingDraw?.amount).toBe(2);
    expect(r.nextState.currentPlayerIndex).toBe(1);

    r = applyAction(r.nextState, { type: "PLAY_CARD", playerToken: "B", cardId: "b2" }, 2000);
    expect(r.nextState.pendingDraw?.amount).toBe(4);
    expect(r.nextState.currentPlayerIndex).toBe(2);

    // C is now the target of the four-card stack.
    r = applyAction(r.nextState, { type: "USE_PERK", playerToken: "C", perk: "SHIELD" }, 3000);
    expect(r.nextState.pendingDraw).toBeNull();
    expect(r.nextState.private.C.perks.SHIELD).toBe(0);
  });

  test("opening action card is neutral during initialization", () => {
    const deck = [c("opening", 8, "circle"), c("next", 3, "triangle")];
    const s = createInitialState(
      "ROOM",
      [
        { token: "A", name: "A", connected: true },
        { token: "B", name: "B", connected: true },
      ],
      deck,
      { stackPickTwo: false, pickThree: false, holdOn: true, suspension: true, generalMarket: true, startingHandSize: 5, turnTimerSeconds: 20, perksEnabled: true }
    );

    expect(s.discardPile[0].id).toBe("opening");
    expect(s.pendingDraw).toBeNull();
    expect(s.currentPlayerIndex).toBe(0);
    expect(s.turnSequence).toBe(0);
  });

  test("standard deck generator creates the configured shape/value cards and Whot wilds", () => {
    const deck = createStandardDeck();
    expect(deck.filter((card) => card.value === 20)).toHaveLength(5);
    expect(new Set(deck.filter((card) => card.value !== 20).map((card) => card.shape)).size).toBe(5);
  });

  test("WHOT_OUT bounty triggers and winning action stops resolution", () => {
    const s = base();
    s.players[0].hand = [c("w", 20, null)];

    const r = applyAction(s, {
      type: "PLAY_CARD",
      playerToken: "A",
      cardId: "w",
      chosenShape: "star",
    }, 1000);

    expect(r.nextState.winnerToken).toBe("A");
    expect(r.events.some((event) => event.type === "BOUNTY_COMPLETED" && event.bountyId === "WHOT_OUT")).toBe(true);
    expect(r.events.some((event) => event.type === "PLAYER_WON")).toBe(true);
    expect(r.events.some((event) => event.type === "TURN_STARTED")).toBe(false);
    expect(r.nextState.currentPlayerIndex).toBe(0);
  });

  test("private allocation gives two hidden bounties and one perk", () => {
    const a = createPrivatePlayerState("A");
    expect(a.bounties).toHaveLength(2);
    expect(new Set(a.bounties.map(b => b.id)).size).toBe(2);
    expect(a.bounties.every(b => !b.completed && b.progress === 0)).toBe(true);
    expect(Object.values(a.perks).filter((count) => (count ?? 0) > 0)).toHaveLength(1);
  });

  test("sanitized view never exposes other players' hands or bounties", () => {
    const s = base();

    // A owns only WHOT_OUT.
    s.private.A.bounties = [
      { id: "WHOT_OUT", progress: 0, completed: false },
    ];

    // B owns SHAPE_SNIPER. This must remain completely private.
    s.private.B.bounties = [
      { id: "SHAPE_SNIPER", progress: 0, completed: false },
    ];

    // A's hand is visible to A.
    s.players[0].hand = [
      c("a-card", 3, "circle"),
    ];

    // B's card must never be exposed to A.
    s.players[1].hand = [
      c("b-secret-card", 20, null),
    ];

    const view = getSanitizedClientView(s, "A");
    const serialized = JSON.stringify(view);

    // A can see their own hand.
    expect(view.yourHand).toHaveLength(1);
    expect(view.yourHand[0].id).toBe("a-card");

    // Other players expose only public information such as hand count.
    expect(
      view.players.find((p) => p.token === "B")?.handCount
    ).toBe(1);

    // A can see A's own bounty.
    expect(view.yourBounties).toHaveLength(1);
    expect(view.yourBounties[0].id).toBe("WHOT_OUT");

    // B's private bounty must not leak to A.
    expect(serialized).not.toContain("SHAPE_SNIPER");

    // B's private card must not leak to A.
    expect(serialized).not.toContain("b-secret-card");

    // The sanitized view must not contain a private-state object.
    expect((view as unknown as { private?: unknown }).private).toBeUndefined();
  });
});

  test("Last Card can be called and caught with a two-card penalty", () => {
    const s = base();
    s.players[0].hand = [c("a3", 3, "circle"), c("a4", 4, "square")];
    s.players[1].hand = [c("b4", 4, "square")];
    const played = applyAction(s, { type: "PLAY_CARD", playerToken: "A", cardId: "a3" }, 1000);
    expect(played.nextState.lastCardPendingToken).toBe("A");
    const caught = applyAction(played.nextState, { type: "CALL_LAST_CARD", playerToken: "B", targetPlayerToken: "A" }, 1100);
    expect(caught.nextState.lastCardPendingToken).toBeNull();
    expect(caught.nextState.players[0].hand).toHaveLength(3);
    expect(caught.events.some(event => event.type === "LAST_CARD_CALLED")).toBe(true);
  });

  test("recycled discard cards are shuffled and the face-up card is preserved", () => {
    const s = base();
    s.drawPile = [];
    s.discardPile = [c("d1", 3, "circle"), c("d2", 4, "square"), c("top", 7, "circle")];
    s.players[0].hand = [];
    const result = applyAction(s, { type: "DRAW", playerToken: "A" }, 1000);
    expect(result.nextState.discardPile.at(-1)?.id).toBe("top");
    expect(result.nextState.players[0].hand).toHaveLength(1);
    expect(result.nextState.players[0].hand[0].id).not.toBe("top");
  });


describe("social reactions", () => {
  test("broadcasts a first emote without changing the turn", () => {
    const s = base();
    const result = applyAction(s, { type: "EMOTE", playerToken: "B", emote: "GBAM" }, 1234);
    expect(result.nextState.lastEmote).toEqual({ playerToken: "B", emote: "GBAM", at: 1234 });
    expect(result.nextState.currentPlayerIndex).toBe(0);
  });

  test("rate-limits consecutive reactions but allows one after the cooldown", () => {
    const s = base();
    const first = applyAction(s, { type: "EMOTE", playerToken: "B", emote: "GBAM" }, 1234);
    let blocked = "";
    try {
      applyAction(first.nextState, { type: "EMOTE", playerToken: "B", emote: "CHAI" }, 2000);
    } catch (error) {
      blocked = error instanceof Error ? error.message : String(error);
    }
    expect(blocked).toContain("reactions are limited");
    const afterCooldown = applyAction(first.nextState, { type: "EMOTE", playerToken: "B", emote: "CHAI" }, 3034);
    expect(afterCooldown.nextState.lastEmote?.emote).toBe("CHAI");
  });
});

describe("house rules", () => {
  test("can turn card 5 into Pick Three while leaving it normal when disabled", () => {
    const players = [
      { token: "a", name: "A", connected: true },
      { token: "b", name: "B", connected: true },
    ];
    const deck = createStandardDeck().filter(c => c.id !== "circle-5-1");
    const state = createInitialState("R", players, deck, {
      stackPickTwo: true, pickThree: true, holdOn: true, suspension: true, generalMarket: true,
      startingHandSize: 5, turnTimerSeconds: 20, perksEnabled: false, matchMode: "quick"
    });
    // Keep a second card so the 5's action resolves instead of winning the round immediately.
    state.players[0].hand = [
      { id: "circle-5-1", value: 5, shape: "circle" },
      { id: "circle-3-extra", value: 3, shape: "circle" },
    ];
    state.discardPile[state.discardPile.length - 1] = { id: "triangle-3-1", value: 3, shape: "triangle" };
    state.activeShape = "circle";
    const result = applyAction(state, { type: "PLAY_CARD", playerToken: "a", cardId: "circle-5-1" }, Date.now()).nextState;
    expect(result.pendingDraw?.amount).toBe(3);
  });
});

test("standard Nigerian Whot deck has 54 cards with the supplied suit composition", () => {
  const deck = createStandardDeck();
  expect(deck).toHaveLength(54);
  expect(deck.filter(card => card.shape === "circle")).toHaveLength(12);
  expect(deck.filter(card => card.shape === "triangle")).toHaveLength(12);
  expect(deck.filter(card => card.shape === "cross")).toHaveLength(9);
  expect(deck.filter(card => card.shape === "square")).toHaveLength(9);
  expect(deck.filter(card => card.shape === "star")).toHaveLength(7);
  expect(deck.filter(card => card.value === 20)).toHaveLength(5);
});
