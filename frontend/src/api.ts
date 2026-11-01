import type { Action, ClientView, MatchState, RoomSettings } from "../../src/types";

export interface LobbyView {
  roomCode: string;
  hostToken: string;
  roomId: string;
  phase: "lobby";
  players: Array<{ token: string; name: string; handCount: number; connected: boolean }>;
  settings: RoomSettings;
  match: MatchState;
}

export interface ActiveRoom {
  roomCode: string;
  phase: "lobby" | "playing";
  hostName: string;
  playerCount: number;
  spectatorCount: number;
  maxPlayers: number;
  matchMode: "quick" | "best_of_3" | "tournament";
  startingHandSize: number;
  visibility: "public" | "private";
  joinable: boolean;
  spectatable: boolean;
  updatedAt: number;
}

export interface LobbyResult {
  roomCode: string;
  playerToken: string;
  isHost: boolean;
  room: {
    roomCode: string;
    phase: "lobby" | "playing" | "finished";
    players: Array<{ name: string; connected: boolean }>;
    settings: RoomSettings;
  };
}

const FUNCTION_URL = "/.netlify/functions/game";

async function request<T>(route: string, init?: RequestInit): Promise<T> {
  const [routePath, routeQuery = ""] = route.split("?", 2);
  const query = new URLSearchParams(routeQuery);
  query.set("route", routePath.startsWith("/") ? routePath : `/${routePath}`);
  const response = await fetch(`${FUNCTION_URL}?${query.toString()}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const contentType = response.headers.get("content-type") ?? "";
  const data = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : null;
  if (!response.ok) {
    const message = data && typeof data.error === "string"
      ? data.error
      : `Game service returned ${response.status} from ${FUNCTION_URL}. Check the Netlify Functions deployment.`;
    throw new Error(message);
  }
  if (data === null) {
    throw new Error("The game service did not return JSON. Check that the latest Netlify deployment includes the game function.");
  }
  return data as T;
}

function isActiveRoom(value: unknown): value is ActiveRoom {
  if (!value || typeof value !== "object") return false;
  const room = value as Partial<ActiveRoom>;
  return typeof room.roomCode === "string"
    && (room.phase === "lobby" || room.phase === "playing")
    && typeof room.hostName === "string"
    && typeof room.playerCount === "number"
    && typeof room.spectatorCount === "number"
    && typeof room.maxPlayers === "number"
    && (room.matchMode === "quick" || room.matchMode === "best_of_3" || room.matchMode === "tournament")
    && typeof room.startingHandSize === "number"
    && (room.visibility === "public" || room.visibility === "private")
    && typeof room.joinable === "boolean"
    && typeof room.spectatable === "boolean"
    && typeof room.updatedAt === "number";
}

export const getActiveRooms = async (): Promise<ActiveRoom[]> => {
  const payload = await request<{ rooms?: unknown }>("/rooms");
  if (!Array.isArray(payload.rooms) || !payload.rooms.every(isActiveRoom)) {
    throw new Error("The game server returned an invalid room list. Redeploy the latest game function and try again.");
  }
  return payload.rooms;
};

export const getApiHealth = async (): Promise<{ ok: boolean; service: string; storage: string; roomRecords: number }> => {
  const health = await request<{ ok?: unknown; service?: unknown; storage?: unknown; roomRecords?: unknown }>("/health");
  if (health.ok !== true || typeof health.service !== "string" || typeof health.storage !== "string" || typeof health.roomRecords !== "number") {
    throw new Error("The game server health check failed. Check Netlify Functions and Blobs storage.");
  }
  return health as { ok: boolean; service: string; storage: string; roomRecords: number };
};

export const createRoom = (playerName: string, settings?: Partial<RoomSettings>) =>
  request<LobbyResult>("/create", { method: "POST", body: JSON.stringify({ playerName, settings }) });

export const joinRoom = (roomCode: string, playerName: string) =>
  request<LobbyResult>("/join", { method: "POST", body: JSON.stringify({ roomCode, playerName }) });

export const spectateRoom = (roomCode: string, playerName: string) =>
  request<LobbyResult>("/spectate", { method: "POST", body: JSON.stringify({ roomCode, playerName }) });

export const updateRoomSettings = (roomCode: string, playerToken: string, settings: Partial<RoomSettings>) =>
  request<LobbyView>("/settings", { method: "POST", body: JSON.stringify({ roomCode, playerToken, settings }) });

export const startRoom = (roomCode: string, playerToken: string) =>
  request("/start", { method: "POST", body: JSON.stringify({ roomCode, playerToken }) });

export type GameView = ClientView & { phase: "game" };
export type StateView = LobbyView | GameView;

export const getState = async (roomCode: string, token: string): Promise<StateView> => {
  const view = await request<ClientView | LobbyView>(
    `/state?roomCode=${encodeURIComponent(roomCode)}&token=${encodeURIComponent(token)}`,
  );

  if ("yourHand" in view) {
    return { ...view, phase: "game" };
  }

  return view;
};

export const reconnectRoom = (roomCode: string, token: string) =>
  request<{ roomCode: string; phase: "lobby" | "playing" | "finished"; players: Array<{ name: string; connected: boolean }>; settings: RoomSettings; match: MatchState }>("/reconnect", { method: "POST", body: JSON.stringify({ roomCode, playerToken: token }) });

export const heartbeatRoom = (roomCode: string, token: string) =>
  request<{ roomCode: string; phase: "lobby" | "playing" | "finished"; players: Array<{ name: string; connected: boolean }>; settings: RoomSettings; match: MatchState }>("/heartbeat", { method: "POST", body: JSON.stringify({ roomCode, playerToken: token }) });

export const sendAction = (roomCode: string, token: string, action: Action) =>
  request<ClientView>("/action", {
    method: "POST",
    body: JSON.stringify({ roomCode, playerToken: token, action }),
  });

export const leaveRoom = (roomCode: string, token: string) =>
  request<{ ok: true }>("/leave", {
    method: "POST",
    body: JSON.stringify({ roomCode, playerToken: token }),
  });

export const resetFinishedRoom = (roomCode: string, token: string) =>
  request<LobbyView>("/reset", {
    method: "POST",
    body: JSON.stringify({ roomCode, playerToken: token }),
  });
