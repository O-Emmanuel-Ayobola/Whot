import { randomUUID } from "node:crypto";
import {
  applyAction,
  createInitialState,
  createStandardDeck,
  getSanitizedClientView,
  getSpectatorClientView,
} from "./engine";
import type { Action, ClientView, GameState, MatchMode, MatchState, RoomSettings } from "./types";
import type { RoomDirectoryDocument, RoomDocument, RoomPlayer, RoomStore } from "./room";
import { roomKey } from "./room";

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_PLAYERS = 6;
const MIN_PLAYERS = 2;
const CAS_RETRIES = 8;
const HOST_HEARTBEAT_INTERVAL_MS = 8_000;
const HOST_STALE_AFTER_MS = 90_000;
const PLAYER_STALE_AFTER_MS = 90_000;
const HEARTBEAT_INTERVAL_MS = 12_000;
const DIRECTORY_CAS_RETRIES = 8;

async function updateRoomDirectory(store: RoomStore, roomCode: string, add: boolean, now = Date.now()): Promise<void> {
  for (let attempt = 0; attempt < DIRECTORY_CAS_RETRIES; attempt += 1) {
    const current = await store.getDirectory();
    if (!current) {
      const initial: RoomDirectoryDocument = { version: 1, roomCodes: add ? [roomCode] : [], updatedAt: now };
      const created = await store.createDirectory(initial);
      if (created.modified) return;
      continue;
    }
    const roomCodes = new Set(current.data.roomCodes);
    if (add) roomCodes.add(roomCode);
    else roomCodes.delete(roomCode);
    const next: RoomDirectoryDocument = {
      version: current.data.version + 1,
      roomCodes: [...roomCodes],
      updatedAt: now,
    };
    const result = await store.compareAndSetDirectory(next, current.etag);
    if (result.modified) return;
  }
  throw new Error("Room directory is busy; please try again");
}

export interface CreateRoomInput {
  playerName: string;
  settings?: Partial<RoomSettings>;
}

export interface RoomCredentials {
  roomCode: string;
  playerToken: string;
  isHost: boolean;
}

export interface ActiveRoomSummary {
  roomCode: string;
  phase: "lobby" | "playing";
  hostName: string;
  playerCount: number;
  spectatorCount: number;
  maxPlayers: number;
  matchMode: MatchMode;
  startingHandSize: number;
  visibility: "public" | "private";
  joinable: boolean;
  spectatable: boolean;
  updatedAt: number;
}

export interface RoomSummary {
  roomCode: string;
  phase: RoomDocument["phase"];
  players: Array<{ name: string; connected: boolean }>;
  settings: RoomSettings;
  match: MatchState;
}

export interface LobbyView {
  roomCode: string;
  hostToken: string;
  roomId: string;
  phase: "lobby";
  players: Array<{ name: string; token: string; handCount: number; connected: boolean }>;
  settings: RoomSettings;
  match: MatchState;
}

export function defaultSettings(overrides?: Partial<RoomSettings>): RoomSettings {
  return {
    visibility: overrides?.visibility ?? "public",
    stackPickTwo: overrides?.stackPickTwo ?? true,
    pickThree: overrides?.pickThree ?? false,
    holdOn: overrides?.holdOn ?? true,
    suspension: overrides?.suspension ?? true,
    generalMarket: overrides?.generalMarket ?? true,
    startingHandSize: Math.min(7, Math.max(3, Number(overrides?.startingHandSize ?? 5))),
    turnTimerSeconds: overrides?.turnTimerSeconds ?? 20,
    perksEnabled: overrides?.perksEnabled ?? false,
    matchMode: overrides?.matchMode ?? "quick",
  };
}

export function targetWinsForMode(mode: MatchMode): number {
  if (mode === "best_of_3") return 2;
  if (mode === "tournament") return 3;
  return 1;
}

function createMatchState(mode: MatchMode, players: RoomPlayer[]): MatchState {
  return {
    mode,
    roundNumber: 0,
    wins: Object.fromEntries(players.map((player) => [player.token, 0])),
    championToken: null,
    lastChampionToken: null,
    targetWins: targetWinsForMode(mode),
    lastWinnerToken: null,
    lastEndedAt: null,
  };
}

function ensureMatch(room: RoomDocument): MatchState {
  if (room.match) return room.match;
  room.match = createMatchState(room.settings.matchMode ?? "quick", room.players);
  return room.match;
}

function publicLobby(room: RoomDocument): LobbyView {
  const match = ensureMatch(room);
  return {
    roomCode: room.roomCode,
    hostToken: room.hostToken,
    roomId: room.roomCode,
    phase: "lobby",
    players: room.players.map((player) => ({ name: player.name, token: player.token, handCount: 0, connected: player.connected })),
    settings: { ...room.settings },
    match: structuredClone(match),
  };
}

export function normalizePlayerName(name: string): string {
  const clean = name.trim().replace(/\s+/g, " ");
  if (!clean) throw new Error("Player name is required");
  if (clean.length > 24) throw new Error("Player name must be 24 characters or fewer");
  return clean;
}

export function normalizeRoomCode(code: string): string {
  const clean = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(clean)) throw new Error("Room code must be 4 characters");
  return clean;
}

export function createSessionToken(): string {
  return randomUUID();
}

export function generateRoomCode(): string {
  let code = "";
  for (let i = 0; i < 4; i += 1) {
    code += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
  }
  return code;
}

function summarize(room: RoomDocument): RoomSummary {
  return {
    roomCode: room.roomCode,
    phase: room.phase,
    players: room.players.map(({ name, connected }) => ({ name, connected })),
    settings: { ...room.settings },
    match: structuredClone(ensureMatch(room)),
  };
}

function validatePlayer(room: RoomDocument, playerToken: string): RoomPlayer {
  const player = room.players.find((item) => item.token === playerToken);
  if (!player) throw new Error("Invalid player session");
  return player;
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function startGame(room: RoomDocument, now: number): GameState {
  const activePlayers = room.players.filter((player) => player.connected && (player.role ?? "player") === "player");
  if (activePlayers.length < MIN_PLAYERS) throw new Error("At least 2 connected players are required to start");
  if (activePlayers.length > MAX_PLAYERS) throw new Error("Room is full");

  const deck = shuffle(createStandardDeck());
  const game = createInitialState(
    room.roomCode,
    activePlayers.map((player) => ({ token: player.token, name: player.name, connected: player.connected })),
    deck,
    room.settings,
  );

  for (let round = 0; round < room.settings.startingHandSize; round += 1) {
    for (const player of game.players) {
      const card = game.drawPile.shift();
      if (!card) throw new Error("Deck ran out while dealing");
      player.hand.push(card);
    }
  }

  game.turnStartedAt = now;
  game.version = room.version + 1;
  return game;
}

async function updateWithCas(
  store: RoomStore,
  code: string,
  mutate: (room: RoomDocument) => RoomDocument,
): Promise<RoomDocument> {
  const key = roomKey(code);

  for (let attempt = 0; attempt < CAS_RETRIES; attempt += 1) {
    const current = await store.get(key);
    if (!current) throw new Error("Room not found");

    const next = mutate(structuredClone(current.data));
    // Older room documents predate host heartbeats. Freeze their last known
    // update time into the new field before generic mutations refresh updatedAt.
    if (next.hostLastSeenAt === undefined) next.hostLastSeenAt = current.data.updatedAt;
    next.version = current.data.version + 1;
    next.updatedAt = Date.now();

    const result = await store.compareAndSet(key, next, current.etag);
    if (result.modified) return next;
  }

  throw new Error("Room is busy; please try again");
}

export async function createRoom(store: RoomStore, input: CreateRoomInput, now = Date.now()): Promise<RoomCredentials & { room: RoomSummary }> {
  const playerName = normalizePlayerName(input.playerName);
  const settings = defaultSettings(input.settings);

  for (let attempt = 0; attempt < 16; attempt += 1) {
    const roomCode = generateRoomCode();
    const hostToken = createSessionToken();
    const room: RoomDocument = {
      version: 1,
      roomCode,
      hostToken,
      phase: "lobby",
      players: [{ token: hostToken, name: playerName, connected: true, joinedAt: now, lastSeenAt: now, role: "player" }],
      settings,
      match: createMatchState(settings.matchMode ?? "quick", [{ token: hostToken, name: playerName, connected: true, joinedAt: now }]),
      gameState: null,
      createdAt: now,
      updatedAt: now,
      hostLastSeenAt: now,
    };

    const result = await store.create(roomKey(roomCode), room);
    if (result.modified) {
      // Room creation is the critical operation. Keep the room usable even if
      // the optional public-room directory update has a transient failure.
      // The room itself can still be joined directly with its code.
      try {
        await updateRoomDirectory(store, roomCode, true, now);
      } catch {
        // Do not turn a successful room creation into a 500 response.
      }
      return { roomCode, playerToken: hostToken, isHost: true, room: summarize(room) };
    }
  }

  throw new Error("Could not allocate a unique room code");
}

export async function joinRoom(store: RoomStore, roomCodeInput: string, playerNameInput: string, now = Date.now()): Promise<RoomCredentials & { room: RoomSummary }> {
  const roomCode = normalizeRoomCode(roomCodeInput);
  const playerName = normalizePlayerName(playerNameInput);
  let issuedToken = "";
  let staleHostDetected = false;
  let room: RoomDocument;
  try {
    room = await updateWithCas(store, roomCode, (current) => {
    const host = current.players.find((player) => player.token === current.hostToken);
    const hostLastSeen = current.hostLastSeenAt ?? host?.lastSeenAt ?? current.updatedAt;
    if (!host?.connected || now - hostLastSeen > HOST_STALE_AFTER_MS) {
      staleHostDetected = true;
      throw new Error("This room has closed because the host is no longer active");
    }
    if (current.phase !== "lobby") throw new Error("Game has already started");
    if (current.players.filter((player) => (player.role ?? "player") === "player" && player.connected).length >= MAX_PLAYERS) throw new Error("Room is full");

    issuedToken = createSessionToken();
    const next = current;
    next.players.push({ token: issuedToken, name: playerName, connected: true, joinedAt: now, lastSeenAt: now, role: "player" });
    ensureMatch(next).wins[issuedToken] = 0;
    return next;
    });
  } catch (error) {
    if (staleHostDetected) await store.delete(roomKey(roomCode)).catch(() => undefined);
    throw error;
  }

  return { roomCode, playerToken: issuedToken, isHost: room.hostToken === issuedToken, room: summarize(room) };
}

export async function spectateRoom(store: RoomStore, roomCodeInput: string, spectatorNameInput: string, now = Date.now()): Promise<RoomCredentials & { room: RoomSummary }> {
  const roomCode = normalizeRoomCode(roomCodeInput);
  const spectatorName = normalizePlayerName(spectatorNameInput);
  let issuedToken = "";
  let staleHostDetected = false;
  let room: RoomDocument;
  try {
    room = await updateWithCas(store, roomCode, (current) => {
      const host = current.players.find((player) => player.token === current.hostToken);
      if (!host?.connected || now - (current.hostLastSeenAt ?? current.updatedAt) > HOST_STALE_AFTER_MS) {
        staleHostDetected = true;
        throw new Error("This room has closed because the host is no longer active");
      }
      if (current.phase !== "playing") throw new Error(current.phase === "lobby" ? "The game has not started yet. Join as a player instead." : "This game has ended. Refresh the room list and choose another live table.");
      const spectatorCount = current.players.filter((p) => (p.role ?? "player") === "spectator" && p.connected).length;
      if (spectatorCount >= 8) throw new Error("Spectator limit reached");
      issuedToken = createSessionToken();
      current.players.push({ token: issuedToken, name: spectatorName, connected: true, joinedAt: now, lastSeenAt: now, role: "spectator" });
      return current;
    });
  } catch (error) {
    if (staleHostDetected) await store.delete(roomKey(roomCode)).catch(() => undefined);
    throw error;
  }
  return { roomCode, playerToken: issuedToken, isHost: false, room: summarize(room) };
}

export async function listActiveRooms(store: RoomStore, now = Date.now()): Promise<ActiveRoomSummary[]> {
  // Netlify Blob list operations can lag behind a just-created blob. Use a
  // strongly-read CAS directory as the primary index, with the blob listing as
  // a backward-compatible fallback for rooms created before the index existed.
  const directory = await store.getDirectory();
  const indexedCodes = directory?.data.roomCodes ?? [];
  const listedKeys = await store.list("room:");
  const keys = [...new Set([...indexedCodes.map(roomKey), ...listedKeys])];
  const active: ActiveRoomSummary[] = [];
  await Promise.all(keys.map(async (key) => {
    const versioned = await store.get(key);
    if (!versioned) return;
    const room = versioned.data;
    const host = room.players.find((player) => player.token === room.hostToken);
    const hostLastSeen = room.hostLastSeenAt ?? host?.lastSeenAt ?? room.updatedAt;
    const abandoned = !host?.connected || now - hostLastSeen > HOST_STALE_AFTER_MS;
    if (abandoned || (room.phase !== "lobby" && room.phase !== "playing") || (room.settings.visibility ?? "public") === "private") {
      if (abandoned) {
        await store.delete(key).catch(() => undefined);
        await updateRoomDirectory(store, room.roomCode, false, now).catch(() => undefined);
      }
      return;
    }
    const playerCount = room.players.filter((player) => player.connected && (player.role ?? "player") === "player" && now - (player.lastSeenAt ?? room.updatedAt) <= PLAYER_STALE_AFTER_MS).length;
    const spectatorCount = room.players.filter((player) => player.connected && player.role === "spectator" && now - (player.lastSeenAt ?? room.updatedAt) <= PLAYER_STALE_AFTER_MS).length;
    const hostName = host?.name ?? "Host";
    active.push({
      roomCode: room.roomCode,
      phase: room.phase,
      hostName,
      playerCount,
      spectatorCount,
      maxPlayers: MAX_PLAYERS,
      matchMode: room.settings.matchMode ?? "quick",
      startingHandSize: room.settings.startingHandSize,
      visibility: room.settings.visibility ?? "public",
      joinable: room.phase === "lobby" && playerCount < MAX_PLAYERS,
      spectatable: room.phase === "playing",
      updatedAt: room.updatedAt,
    });
  }));
  return active.sort((a, b) => (a.phase === b.phase ? b.updatedAt - a.updatedAt : a.phase === "lobby" ? -1 : 1));
}

export async function updateRoomSettings(
  store: RoomStore,
  roomCodeInput: string,
  hostToken: string,
  updates: Partial<RoomSettings>,
): Promise<LobbyView> {
  const roomCode = normalizeRoomCode(roomCodeInput);
  const room = await updateWithCas(store, roomCode, (current) => {
    if (current.hostToken !== hostToken) throw new Error("Only the host can edit house rules");
    if (current.phase !== "lobby") throw new Error("House rules can only be changed before the game starts");
    const previousMode = current.settings.matchMode ?? "quick";
    current.settings = defaultSettings({ ...current.settings, ...updates });
    if (previousMode !== (current.settings.matchMode ?? "quick")) {
      current.match = createMatchState(current.settings.matchMode ?? "quick", current.players.filter((player) => (player.role ?? "player") === "player"));
    }
    return current;
  });
  return publicLobby(room);
}

export async function startRoom(store: RoomStore, roomCodeInput: string, hostToken: string, now = Date.now()): Promise<RoomSummary> {
  const roomCode = normalizeRoomCode(roomCodeInput);
  const room = await updateWithCas(store, roomCode, (current) => {
    if (current.hostToken !== hostToken) throw new Error("Only the host can start the game");
    if (current.phase !== "lobby") throw new Error("Game has already started");
    let match = ensureMatch(current);
    if (match.championToken) {
      match = createMatchState(current.settings.matchMode ?? "quick", current.players.filter((player) => player.connected && (player.role ?? "player") === "player"));
      current.match = match;
    }
    match.roundNumber += 1;
    current.gameState = startGame(current, now);
    current.phase = "playing";
    return current;
  });

  return summarize(room);
}

function maybeTimeout(game: GameState, now: number): GameState {
  if (game.winnerToken) return game;
  const elapsed = now - game.turnStartedAt;
  if (game.turnStartedAt > 0 && elapsed >= game.settings.turnTimerSeconds * 1000) {
    const activeToken = game.players[game.currentPlayerIndex].token;
    return applyAction(game, { type: "TIMEOUT", playerToken: activeToken }, now).nextState;
  }
  return game;
}

export async function readRoomStatus(store: RoomStore, roomCodeInput: string, playerToken: string): Promise<LobbyView> {
  const roomCode = normalizeRoomCode(roomCodeInput);
  const current = await store.get(roomKey(roomCode));
  if (!current) throw new Error("Room not found");
  validatePlayer(current.data, playerToken);
  if (current.data.gameState) throw new Error("Game has started");
  return publicLobby(structuredClone(current.data));
}

export async function readClientState(
  store: RoomStore,
  roomCodeInput: string,
  playerToken: string,
  now = Date.now(),
): Promise<ClientView> {
  const roomCode = normalizeRoomCode(roomCodeInput);
  const key = roomKey(roomCode);
  const current = await store.get(key);
  if (!current) throw new Error("Room not found");
  let roomData = current.data;
  const roomMember = validatePlayer(roomData, playerToken);
  const host = roomData.players.find((player) => player.token === roomData.hostToken);
  const hostLastSeen = roomData.hostLastSeenAt ?? host?.lastSeenAt ?? roomData.updatedAt;

  if (!host?.connected || (playerToken !== roomData.hostToken && now - hostLastSeen > HOST_STALE_AFTER_MS)) {
    await store.delete(key).catch(() => undefined);
    throw new Error("This room has closed because the host left or became inactive");
  }

  if (now - (roomMember.lastSeenAt ?? 0) >= HEARTBEAT_INTERVAL_MS || (playerToken === roomData.hostToken && now - hostLastSeen >= HOST_HEARTBEAT_INTERVAL_MS)) {
    roomData = await updateWithCas(store, roomCode, (latest) => {
      const activeHost = latest.players.find((player) => player.token === latest.hostToken);
      if (!activeHost?.connected) throw new Error("This room has closed because the host left");
      const activeMember = latest.players.find((player) => player.token === playerToken);
      if (!activeMember) throw new Error("Invalid player session");
      activeMember.connected = true;
      activeMember.lastSeenAt = now;
      if (playerToken === latest.hostToken) latest.hostLastSeenAt = now;
      // Mark long-disconnected members without deleting their sessions. This lets
      // them reconnect within the grace window while keeping room counts honest.
      for (const player of latest.players) {
        if (player.token !== latest.hostToken && player.connected && now - (player.lastSeenAt ?? latest.updatedAt) > PLAYER_STALE_AFTER_MS) {
          player.connected = false;
          if (latest.gameState) {
            const gamePlayer = latest.gameState.players.find((item) => item.token === player.token);
            if (gamePlayer) gamePlayer.connected = false;
          }
        }
      }
      return latest;
    });
  }

  if (!roomData.gameState) {
    return publicLobby(structuredClone(roomData)) as unknown as ClientView;
  }

  if ((roomMember.role ?? "player") === "spectator") {
    return { ...getSpectatorClientView(roomData.gameState), match: structuredClone(ensureMatch(roomData)), gameStatus: roomData.phase === "finished" ? (roomData.gameState.winnerToken ? "won" : "ended") : "playing" };
  }

  const elapsed = now - roomData.gameState.turnStartedAt;
  if (!roomData.gameState.winnerToken && roomData.gameState.turnStartedAt > 0 && elapsed >= roomData.gameState.settings.turnTimerSeconds * 1000) {
    try {
      const room = await updateWithCas(store, roomCode, (latest) => {
        const activeHost = latest.players.find((player) => player.token === latest.hostToken);
        if (!activeHost?.connected) throw new Error("This room has closed because the host left");
        if (!latest.gameState) throw new Error("Game has not started");
        if (latest.gameState.winnerToken) return latest;
        const latestElapsed = now - latest.gameState.turnStartedAt;
        if (latestElapsed < latest.gameState.settings.turnTimerSeconds * 1000) return latest;
        const activeToken = latest.gameState.players[latest.gameState.currentPlayerIndex].token;
        latest.gameState = applyAction(latest.gameState, { type: "TIMEOUT", playerToken: activeToken }, now).nextState;
        return latest;
      });
      return { ...getSanitizedClientView(room.gameState!, playerToken), match: structuredClone(ensureMatch(room)), gameStatus: room.phase === "finished" ? (room.gameState?.winnerToken ? "won" : "ended") : "playing" };
    } catch (error) {
      if (error instanceof Error && error.message === "Room is busy; please try again") throw error;
    }
  }

  return { ...getSanitizedClientView(roomData.gameState, playerToken), match: structuredClone(ensureMatch(roomData)), gameStatus: roomData.phase === "finished" ? (roomData.gameState?.winnerToken ? "won" : "ended") : "playing" };
}


export async function leaveRoom(store: RoomStore, roomCodeInput: string, playerToken: string, now = Date.now()): Promise<{ ok: true; closed?: boolean }> {
  const roomCode = normalizeRoomCode(roomCodeInput);
  const key = roomKey(roomCode);
  let hostLeaving = false;

  await updateWithCas(store, roomCode, (current) => {
    const leaving = validatePlayer(current, playerToken);
    if (playerToken === current.hostToken && (leaving.role ?? "player") === "player") {
      hostLeaving = true;
      return current;
    }
    if (!leaving.connected) return current;

    leaving.connected = false;
    // Spectators can leave without affecting the live match.
    // A non-host player leaving during a live game ends the round for everyone.
    if ((leaving.role ?? "player") === "spectator") return current;
    if (current.gameState && current.phase === "playing") {
      const gamePlayer = current.gameState.players.find((player) => player.token === playerToken);
      if (gamePlayer) gamePlayer.connected = false;
      current.phase = "finished";
      return current;
    }
    return current;
  });

  // A room cannot outlive its host. Delete it immediately, whether the host
  // leaves from the lobby or during a match.
  if (hostLeaving) {
    await store.delete(key);
    return { ok: true, closed: true };
  }
  return { ok: true };
}

export async function resetFinishedRoom(store: RoomStore, roomCodeInput: string, playerToken: string): Promise<LobbyView> {
  const roomCode = normalizeRoomCode(roomCodeInput);

  const room = await updateWithCas(store, roomCode, (current) => {
    validatePlayer(current, playerToken);
    if (current.phase !== "finished") return current;

    const match = ensureMatch(current);
    const winner = current.gameState?.winnerToken ?? null;
    match.lastWinnerToken = winner;
    match.lastEndedAt = Date.now();

    if (winner) {
      match.wins[winner] = (match.wins[winner] ?? 0) + 1;
      if (match.wins[winner] >= match.targetWins) {
        match.championToken = winner;
        match.lastChampionToken = winner;
      }
    }

    current.players = current.players.filter((player) => player.connected && (player.role ?? "player") === "player");
    if (current.players.length === 0) throw new Error("Room is empty");

    if (!current.players.some((player) => player.token === current.hostToken)) {
      current.hostToken = current.players[0].token;
    }

    current.gameState = null;
    current.phase = "lobby";
    return current;
  });

  return publicLobby(room);
}

export async function heartbeatRoom(store: RoomStore, roomCodeInput: string, playerToken: string, now = Date.now()): Promise<RoomSummary> {
  const roomCode = normalizeRoomCode(roomCodeInput);
  const room = await updateWithCas(store, roomCode, (current) => {
    const player = validatePlayer(current, playerToken);
    const host = current.players.find((item) => item.token === current.hostToken);
    const hostLastSeen = current.hostLastSeenAt ?? host?.lastSeenAt ?? current.updatedAt;
    if (!host?.connected || (playerToken !== current.hostToken && now - hostLastSeen > HOST_STALE_AFTER_MS)) {
      throw new Error("This room has closed because the host is no longer active");
    }
    player.connected = true;
    player.lastSeenAt = now;
    if (playerToken === current.hostToken) current.hostLastSeenAt = now;
    if (current.gameState) {
      const gamePlayer = current.gameState.players.find((item) => item.token === playerToken);
      if (gamePlayer) gamePlayer.connected = true;
    }
    return current;
  });
  return summarize(room);
}

export async function reconnectRoom(store: RoomStore, roomCodeInput: string, playerToken: string, now = Date.now()): Promise<RoomSummary> {
  const roomCode = normalizeRoomCode(roomCodeInput);
  const room = await updateWithCas(store, roomCode, (current) => {
    const player = validatePlayer(current, playerToken);
    const host = current.players.find((item) => item.token === current.hostToken);
    const hostLastSeen = current.hostLastSeenAt ?? host?.lastSeenAt ?? current.updatedAt;
    if (!host?.connected || now - hostLastSeen > HOST_STALE_AFTER_MS) {
      throw new Error("This room has closed because the host is no longer active");
    }
    player.connected = true;
    player.lastSeenAt = now;
    if (current.gameState) {
      const gamePlayer = current.gameState.players.find((item) => item.token === playerToken);
      if (gamePlayer) gamePlayer.connected = true;
    }
    if (playerToken === current.hostToken) current.hostLastSeenAt = now;
    return current;
  });
  return summarize(room);
}

export async function applyRoomAction(store: RoomStore, roomCodeInput: string, playerToken: string, action: Action, now = Date.now()): Promise<ClientView> {
  const roomCode = normalizeRoomCode(roomCodeInput);
  if (action.playerToken !== playerToken) throw new Error("Action token does not match session token");

  const room = await updateWithCas(store, roomCode, (current) => {
    const member = validatePlayer(current, playerToken);
    if ((member.role ?? "player") === "spectator") throw new Error("Spectators cannot play cards");
    if (!current.gameState || current.phase === "lobby") throw new Error("Game has not started");
    if (current.gameState.winnerToken) throw new Error("Game is already finished");

    // A client may retry a request after a network timeout. If the server
    // already accepted that exact request, return the current state instead
    // of applying the card twice.
    const requestId = action.requestId;
    const seenRequests = current.lastActionIds?.[playerToken] ?? [];
    if (requestId && seenRequests.includes(requestId)) return current;

    const sequencedAction = action.type === "EMOTE"
      ? action
      : action.expectedVersion !== undefined
        ? action
        : { ...action, expectedVersion: current.gameState.version };

    if (sequencedAction.expectedVersion !== undefined && sequencedAction.expectedVersion !== current.gameState.version) {
      throw new Error(`Stale action: your table is on version ${current.gameState.version}. Refresh and try again.`);
    }

    current.gameState = applyAction(current.gameState, sequencedAction, now).nextState;
    if (requestId) {
      const nextRequests = [...seenRequests.filter(id => id !== requestId), requestId].slice(-12);
      current.lastActionIds = { ...(current.lastActionIds ?? {}), [playerToken]: nextRequests };
    }
    current.gameState.version = current.version + 1;
    if (current.gameState.winnerToken) current.phase = "finished";
    return current;
  });

  return { ...getSanitizedClientView(room.gameState!, playerToken), match: structuredClone(ensureMatch(room)), gameStatus: room.phase === "finished" ? (room.gameState?.winnerToken ? "won" : "ended") : "playing" };
}
