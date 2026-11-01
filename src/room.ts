import type { GameState, MatchState, RoomSettings } from "./types";

export type RoomPhase = "lobby" | "playing" | "finished";

export interface RoomPlayer {
  token: string;
  name: string;
  connected: boolean;
  joinedAt: number;
  role?: "player" | "spectator";
  /** Last successful client heartbeat/state poll. */
  lastSeenAt?: number;
}

export interface RoomDocument {
  version: number;
  roomCode: string;
  hostToken: string;
  phase: RoomPhase;
  players: RoomPlayer[];
  settings: RoomSettings;
  match?: MatchState;
  gameState: GameState | null;
  createdAt: number;
  updatedAt: number;
  /** Last time the host actively polled the room. Used to prune abandoned rooms. */
  hostLastSeenAt?: number;
  /** Last accepted action id per player, used to make retried requests idempotent. */
  lastActionIds?: Record<string, string[]>;
}

export interface Versioned<T> {
  data: T;
  etag: string;
}

export interface RoomDirectoryDocument {
  version: number;
  roomCodes: string[];
  updatedAt: number;
}

export interface RoomStore {
  get(key: string): Promise<Versioned<RoomDocument> | null>;
  create(key: string, value: RoomDocument): Promise<{ modified: boolean; etag?: string }>;
  compareAndSet(key: string, value: RoomDocument, etag: string): Promise<{ modified: boolean; etag?: string }>;
  list(prefix: string): Promise<string[]>;
  delete(key: string): Promise<void>;
  getDirectory(): Promise<Versioned<RoomDirectoryDocument> | null>;
  createDirectory(value: RoomDirectoryDocument): Promise<{ modified: boolean; etag?: string }>;
  compareAndSetDirectory(value: RoomDirectoryDocument, etag: string): Promise<{ modified: boolean; etag?: string }>;
}

export const ROOM_PREFIX = "room:";

export const roomKey = (roomCode: string) => `${ROOM_PREFIX}${roomCode}`;
