export type Shape = "circle" | "triangle" | "cross" | "square" | "star";
export type CardValue = 1 | 2 | 3 | 4 | 5 | 7 | 8 | 10 | 11 | 12 | 13 | 14 | 15 | 20;
export type ActionValue = 1 | 2 | 5 | 8 | 14 | 20;
export type BountyId = "WHOT_OUT" | "DOUBLE_TROUBLE" | "ACTION_COUNTER" | "CLEAN_SWEEP" | "SHAPE_SNIPER";
export type PerkId = "SHIELD" | "PEEK" | "SWAP";
export type EmoteId = "GBAM" | "OYA_OYA" | "SHARP_SHARP" | "NA_SO" | "PEPPER_DEM" | "CHAI" | "KAI" | "NA_WA" | "E_DON_HAPPEN" | "CHOP_KNUCKLE" | "CHECK_UP" | "LAST_CARD" | "I_DEY_ONE" | "EHEN_SEE" | "I_DON_WIN" | "DEM_GO_HEAR" | "BABA_SHOW" | "SIT_DOWN" | "NO_WAHALA" | "E_GO_BETTER" | "RUN_AM_BACK" | "SAPA" | "YOU_DEY_WHOT" | "SHEY_SURE" | "CALM_DOWN" | "SEE_PRESSURE" | "ESE_O" | "DAALU" | "NAGODE" | "SORRY_O" | "KPELE" | "WELL_PLAYED" | "OMO" | "NA_SO_BIG" | "WALAHI" | "E_CHOKE";

export interface Card {
  id: string;
  value: CardValue;
  shape: Shape | null; // null only for Whot 20
}

export interface PlayerState {
  token: string;
  name: string;
  hand: Card[];
  connected: boolean;
}

export type MatchMode = "quick" | "best_of_3" | "tournament";

export interface RoomSettings {
  visibility?: "public" | "private";
  stackPickTwo: boolean;
  pickThree: boolean;
  holdOn: boolean;
  suspension: boolean;
  generalMarket: boolean;
  startingHandSize: number;
  turnTimerSeconds: number;
  perksEnabled: boolean;
  matchMode?: MatchMode;
}

export interface MatchState {
  mode: MatchMode;
  roundNumber: number;
  wins: Record<string, number>;
  championToken: string | null;
  lastChampionToken: string | null;
  targetWins: number;
  lastWinnerToken: string | null;
  lastEndedAt: number | null;
}

export interface BountyState {
  id: BountyId;
  progress: number;
  completed: boolean;
}

export interface PrivatePlayerState {
  bounties: BountyState[];
  perks: Partial<Record<PerkId, number>>;
  peekedCards: Card[];
}

export interface PendingDraw {
  amount: number;
  source: "PICK_TWO" | "PICK_THREE";
  initiatedBy: string;
}

export interface GameState {
  version: number;
  roomId: string;
  players: PlayerState[];
  private: Record<string, PrivatePlayerState>;
  drawPile: Card[];
  discardPile: Card[];
  openingCardResolved: boolean;
  activeShape: Shape;
  currentPlayerIndex: number;
  turnSequence: number;
  turnStartedAt: number;
  settings: RoomSettings;
  pendingDraw: PendingDraw | null;
  winnerToken: string | null;
  roundPenaltyTargets: string[];
  lastEmote: { playerToken: string; emote: EmoteId; at: number } | null;
  lastReactionAt: number;
  cleanSweepSequence: {
    playerToken: string;
    cardsPlayed: number;
    turnSequence: number;
  } | null;
  lastCardPendingToken?: string | null;
  eventLog?: GameEvent[];
}

export type Action = (
  | { type: "PLAY_CARD"; playerToken: string; cardId: string; chosenShape?: Shape }
  | { type: "DRAW"; playerToken: string }
  | { type: "USE_PERK"; playerToken: string; perk: PerkId; targetPlayerToken?: string }
  | { type: "CALL_LAST_CARD"; playerToken: string; targetPlayerToken: string }
  | { type: "TIMEOUT"; playerToken: string }
  | { type: "EMOTE"; playerToken: string; emote: EmoteId }
) & { requestId?: string; expectedVersion?: number };

export type GameEvent =
  | { type: "TURN_STARTED"; playerToken: string; turnSequence: number; timestamp: number }
  | { type: "CARD_PLAYED"; playerToken: string; card: PublicCard; timestamp: number }
  | { type: "CARD_DRAWN"; playerToken: string; count: number; timestamp: number }
  | { type: "PICK_TWO_PENDING"; playerToken: string; amount: number }
  | { type: "PICK_THREE_PENDING"; playerToken: string; amount: number }
  | { type: "GENERAL_MARKET"; playerToken: string; affectedPlayers: string[] }
  | { type: "TURN_SKIPPED"; playerToken: string; reason: "SUSPENSION" | "HOLD_ON" }
  | { type: "PERK_USED"; playerToken: string; perk: PerkId; targetPlayerToken?: string }
  | { type: "BOUNTY_COMPLETED"; playerToken: string; bountyId: BountyId }
  | { type: "SECRET_BOUNTY_COMPLETED" }
  | { type: "PLAYER_WON"; playerToken: string }
  | { type: "LAST_CARD_CALLED"; callerToken: string; targetPlayerToken: string };

export interface PublicCard {
  id: string;
  value: CardValue;
  shape: Shape | null;
}

export interface ClientView {
  roomId: string;
  players: Array<{
    token: string;
    name: string;
    handCount: number;
    connected: boolean;
  }>;
  topCard: PublicCard | null;
  activeShape: Shape;
  currentPlayerToken: string | null;
  turnStartedAt: number;
  turnTimerSeconds: number;
  pendingDraw: number;
  settings: RoomSettings;
  match: MatchState;
  stateVersion: number;
  winnerToken: string | null;
  gameStatus: "playing" | "won" | "ended";
  yourHand: PublicCard[];
  spectator?: boolean;
  yourBounties: BountyState[];
  yourPerks: Partial<Record<PerkId, number>>;
  peekedCards: PublicCard[];
  drawPileCount: number;
  lastEmote: { playerToken: string; playerName: string; emote: EmoteId; at: number } | null;
  recentEvents: GameEvent[];
}
