import { describe, expect, test } from "vitest";
import { applyRoomAction, createRoom, joinRoom, leaveRoom, listActiveRooms, readClientState, resetFinishedRoom, startRoom, spectateRoom, reconnectRoom } from "../src/roomManager";
import type { RoomDirectoryDocument, RoomDocument, RoomStore, Versioned } from "../src/room";

class MemoryRoomStore implements RoomStore {
  private values = new Map<string, Versioned<RoomDocument>>();
  private directory: Versioned<RoomDirectoryDocument> | null = null;
  private counter = 0;

  async get(key: string) {
    const value = this.values.get(key);
    return value ? structuredClone(value) : null;
  }

  async create(key: string, value: RoomDocument) {
    if (this.values.has(key)) return { modified: false };
    const etag = `etag-${++this.counter}`;
    this.values.set(key, { data: structuredClone(value), etag });
    return { modified: true, etag };
  }

  async compareAndSet(key: string, value: RoomDocument, etag: string) {
    const current = this.values.get(key);
    if (!current || current.etag !== etag) return { modified: false };
    const nextEtag = `etag-${++this.counter}`;
    this.values.set(key, { data: structuredClone(value), etag: nextEtag });
    return { modified: true, etag: nextEtag };
  }

  async list(prefix: string) {
    return [...this.values.keys()].filter((key) => key.startsWith(prefix));
  }

  async delete(key: string) {
    this.values.delete(key);
  }

  async getDirectory() {
    return this.directory ? structuredClone(this.directory) : null;
  }

  async createDirectory(value: RoomDirectoryDocument) {
    if (this.directory) return { modified: false };
    const etag = `etag-${++this.counter}`;
    this.directory = { data: structuredClone(value), etag };
    return { modified: true, etag };
  }

  async compareAndSetDirectory(value: RoomDirectoryDocument, etag: string) {
    if (!this.directory || this.directory.etag !== etag) return { modified: false };
    const nextEtag = `etag-${++this.counter}`;
    this.directory = { data: structuredClone(value), etag: nextEtag };
    return { modified: true, etag: nextEtag };
  }
}

describe("Phase 2 room management", () => {
  test("creates a room with a four-character code and secret host token", async () => {
    const store = new MemoryRoomStore();
    const result = await createRoom(store, { playerName: "Emmanuel" }, 1000);

    expect(result.roomCode).toMatch(/^[A-Z0-9]{4}$/);
    expect(result.playerToken).toBeTruthy();
    expect(result.isHost).toBe(true);
    expect(result.room.players).toHaveLength(1);
    expect(result.room.players[0].name).toBe("Emmanuel");
  });

  test("public room is discoverable immediately through the room directory", async () => {
    const store = new MemoryRoomStore();
    const result = await createRoom(store, { playerName: "Host", settings: { visibility: "public" } }, 1000);

    const rooms = await listActiveRooms(store, 1001);
    expect(rooms).toHaveLength(1);
    expect(rooms[0]).toMatchObject({ roomCode: result.roomCode, visibility: "public", phase: "lobby", joinable: true });
  });

  test("private room stays out of the public room directory", async () => {
    const store = new MemoryRoomStore();
    await createRoom(store, { playerName: "Host", settings: { visibility: "private" } }, 1000);

    const rooms = await listActiveRooms(store, 1001);
    expect(rooms).toHaveLength(0);
  });

  test("joins until six players and rejects the seventh", async () => {
    const store = new MemoryRoomStore();
    const host = await createRoom(store, { playerName: "Host" }, 1000);
    for (let i = 1; i < 6; i += 1) {
      await joinRoom(store, host.roomCode, `P${i}`, 1000 + i);
    }

    const full = await readClientState(store, host.roomCode, host.playerToken, 2000).catch((error) => error);
    expect(full).not.toBeInstanceOf(Error);
    await expect(joinRoom(store, host.roomCode, "P7", 2007)).rejects.toThrow("Room is full");
  });

  test("host can start and action updates are returned through a sanitized view", async () => {
    const store = new MemoryRoomStore();
    const host = await createRoom(store, { playerName: "Host" }, 1000);
    const guest = await joinRoom(store, host.roomCode, "Guest", 1001);

    const started = await startRoom(store, host.roomCode, host.playerToken, 2000);
    expect(started.phase).toBe("playing");

    const state = await readClientState(store, host.roomCode, host.playerToken, 2001);
    expect(state.yourHand).toHaveLength(5);
    expect(state.players.find((p) => p.token === guest.playerToken)?.handCount).toBe(5);
    expect(JSON.stringify(state)).not.toContain("private");
  });

  test("non-host cannot start the room", async () => {
    const store = new MemoryRoomStore();
    const host = await createRoom(store, { playerName: "Host" }, 1000);
    const guest = await joinRoom(store, host.roomCode, "Guest", 1001);

    await expect(startRoom(store, host.roomCode, guest.playerToken, 2000)).rejects.toThrow("Only the host can start");
  });

  test("a player leaving mid-game ends the game for everyone and returns the room to lobby", async () => {
    const store = new MemoryRoomStore();
    const host = await createRoom(store, { playerName: "Host" }, 1000);
    const guest = await joinRoom(store, host.roomCode, "Guest", 1001);
    await startRoom(store, host.roomCode, host.playerToken, 2000);

    await leaveRoom(store, host.roomCode, guest.playerToken, 2100);
    const state = await readClientState(store, host.roomCode, host.playerToken, 2101);

    expect(state.players.find((p) => p.token === guest.playerToken)?.connected).toBe(false);
    expect(state.players.find((p) => p.token === host.playerToken)?.connected).toBe(true);
    expect(state.winnerToken).toBeNull();
    expect(state.gameStatus).toBe("ended");

    const lobby = await resetFinishedRoom(store, host.roomCode, host.playerToken);
    expect(lobby.phase).toBe("lobby");
    expect(lobby.players).toHaveLength(1);
    expect(lobby.players[0].name).toBe("Host");
  });

  test("a winner is shown as the winner, then the same players can return to the lobby", async () => {
    const store = new MemoryRoomStore();
    const host = await createRoom(store, { playerName: "Host" }, 1000);
    await joinRoom(store, host.roomCode, "Guest", 1001);
    await startRoom(store, host.roomCode, host.playerToken, 2000);

    const room = await store.get(`room:${host.roomCode}`);
    if (!room?.data.gameState) throw new Error("game missing");
    room.data.gameState.winnerToken = host.playerToken;
    room.data.phase = "finished";
    await store.compareAndSet(`room:${host.roomCode}`, room.data, room.etag);

    const state = await readClientState(store, host.roomCode, host.playerToken, 2100);
    expect(state.winnerToken).toBe(host.playerToken);
    expect(state.gameStatus).toBe("won");

    const lobby = await resetFinishedRoom(store, host.roomCode, host.playerToken);
    expect(lobby.phase).toBe("lobby");
    expect(lobby.players).toHaveLength(2);
    expect(lobby.hostToken).toBe(host.playerToken);
  });

  test("CAS retries preserve both joins when the first write loses a race", async () => {
    const store = new MemoryRoomStore();
    const host = await createRoom(store, { playerName: "Host" }, 1000);

    const firstRead = await store.get(`room:${host.roomCode}`);
    if (!firstRead) throw new Error("room missing");
    const stale = structuredClone(firstRead.data);
    stale.players.push({ token: "stale", name: "Stale", connected: true, joinedAt: 1001 });
    stale.version += 1;
    stale.updatedAt = 1001;
    await store.compareAndSet(`room:${host.roomCode}`, stale, firstRead.etag);

    const joined = await joinRoom(store, host.roomCode, "Fresh", 1002);
    const final = await store.get(`room:${host.roomCode}`);
    expect(joined.playerToken).toBeTruthy();
    expect(final?.data.players.some((p) => p.name === "Fresh")).toBe(true);
  });
});

test("best of 3 keeps round scores in the same lobby and resets for a new match after a champion", async () => {
  const store = new MemoryRoomStore();
  const host = await createRoom(store, { playerName: "Host", settings: { matchMode: "best_of_3" } }, 1000);
  const guest = await joinRoom(store, host.roomCode, "Guest", 1001);

  await startRoom(store, host.roomCode, host.playerToken, 2000);
  let room = await store.get(`room:${host.roomCode}`);
  if (!room?.data.gameState) throw new Error("game missing");
  room.data.gameState.winnerToken = host.playerToken;
  room.data.phase = "finished";
  await store.compareAndSet(`room:${host.roomCode}`, room.data, room.etag);

  let lobby = await resetFinishedRoom(store, host.roomCode, host.playerToken);
  expect(lobby.match.wins[host.playerToken]).toBe(1);
  expect(lobby.match.wins[guest.playerToken]).toBe(0);
  expect(lobby.match.championToken).toBeNull();

  await startRoom(store, host.roomCode, host.playerToken, 3000);
  room = await store.get(`room:${host.roomCode}`);
  if (!room?.data.gameState) throw new Error("second game missing");
  room.data.gameState.winnerToken = host.playerToken;
  room.data.phase = "finished";
  await store.compareAndSet(`room:${host.roomCode}`, room.data, room.etag);
  lobby = await resetFinishedRoom(store, host.roomCode, host.playerToken);

  expect(lobby.match.wins[host.playerToken]).toBe(2);
  expect(lobby.match.championToken).toBe(host.playerToken);

  const restarted = await startRoom(store, host.roomCode, host.playerToken, 4000);
  expect(restarted.phase).toBe("playing");
  expect(restarted.match.wins[host.playerToken]).toBe(0);
  expect(restarted.match.roundNumber).toBe(1);
});


test("spectators can join a live room without seeing hands or affecting the match", async () => {
  const store = new MemoryRoomStore();
  const host = await createRoom(store, { playerName: "Host" }, 1000);
  await joinRoom(store, host.roomCode, "Guest", 1001);
  await startRoom(store, host.roomCode, host.playerToken, 2000);

  const spectator = await spectateRoom(store, host.roomCode, "Viewer", 2100);
  const view = await readClientState(store, host.roomCode, spectator.playerToken, 2101);

  expect(view.spectator).toBe(true);
  expect(view.yourHand).toHaveLength(0);
  expect(view.players).toHaveLength(2);
  expect(view.players.every((p) => p.handCount === 5)).toBe(true);

  await leaveRoom(store, host.roomCode, spectator.playerToken, 2200);
  const hostView = await readClientState(store, host.roomCode, host.playerToken, 2201);
  expect(hostView.gameStatus).toBe("playing");
});


test("active room browser lists open and live rooms without exposing player tokens", async () => {
  const store = new MemoryRoomStore();
  const host = await createRoom(store, { playerName: "Host" }, 1000);
  const active = await listActiveRooms(store, 1001);
  expect(active).toHaveLength(1);
  expect(active[0]).toMatchObject({ roomCode: host.roomCode, phase: "lobby", hostName: "Host", playerCount: 1, joinable: true });
  expect(JSON.stringify(active)).not.toContain(host.playerToken);

  await joinRoom(store, host.roomCode, "Guest", 1002);
  await startRoom(store, host.roomCode, host.playerToken, 2000);
  const live = await listActiveRooms(store, 2001);
  expect(live[0]).toMatchObject({ phase: "playing", playerCount: 2, joinable: false, spectatable: true });
});

test("host leaving deletes the room immediately", async () => {
  const store = new MemoryRoomStore();
  const host = await createRoom(store, { playerName: "Host" }, 1000);
  await joinRoom(store, host.roomCode, "Guest", 1001);

  await leaveRoom(store, host.roomCode, host.playerToken, 1002);
  await expect(readClientState(store, host.roomCode, host.playerToken, 1003)).rejects.toThrow("Room not found");
  expect(await listActiveRooms(store, 1003)).toHaveLength(0);
});

test("stale rooms are pruned after the host stops heartbeating", async () => {
  const store = new MemoryRoomStore();
  const host = await createRoom(store, { playerName: "Host" }, 1000);
  const guest = await joinRoom(store, host.roomCode, "Guest", 1001);

  expect(await listActiveRooms(store, 1000 + 90_001)).toHaveLength(0);
  await expect(readClientState(store, host.roomCode, guest.playerToken, 1000 + 90_002)).rejects.toThrow("Room not found");
});


test("host leaving during a live game closes the table for every participant", async () => {
  const store = new MemoryRoomStore();
  const host = await createRoom(store, { playerName: "Host" }, 1000);
  const guest = await joinRoom(store, host.roomCode, "Guest", 1001);
  await startRoom(store, host.roomCode, host.playerToken, 2000);

  await leaveRoom(store, host.roomCode, host.playerToken, 2100);
  await expect(readClientState(store, host.roomCode, guest.playerToken, 2101)).rejects.toThrow("Room not found");
  expect(await listActiveRooms(store, 2102)).toHaveLength(0);
});


test("host polling refreshes its heartbeat so active rooms stay discoverable", async () => {
  const store = new MemoryRoomStore();
  const host = await createRoom(store, { playerName: "Host" }, 1_000);
  await joinRoom(store, host.roomCode, "Guest", 1_100);

  // The host tab keeps calling GET /state in the app; that heartbeat should
  // keep the same room visible to the room browser beyond the stale cutoff.
  await readClientState(store, host.roomCode, host.playerToken, 92_000);
  const active = await listActiveRooms(store, 92_001);
  expect(active).toHaveLength(1);
  expect(active[0].roomCode).toBe(host.roomCode);
});

test("rejects a stale gameplay action instead of overwriting a newer state", async () => {
  const store = new MemoryRoomStore();
  const host = await createRoom(store, { playerName: "Host" }, 1000);
  const guest = await joinRoom(store, host.roomCode, "Guest", 1001);
  await startRoom(store, host.roomCode, host.playerToken, 2000);
  const hostView = await readClientState(store, host.roomCode, host.playerToken, 2001);
  const staleVersion = hostView.stateVersion;

  const room = await store.get(`room:${host.roomCode}`);
  if (!room?.data.gameState) throw new Error("game missing");
  room.data.gameState.version += 1;
  await store.compareAndSet(`room:${host.roomCode}`, room.data, room.etag);

  await expect(applyRoomAction(store, host.roomCode, host.playerToken, {
    type: "DRAW",
    playerToken: host.playerToken,
    expectedVersion: staleVersion,
    requestId: "stale-1",
  }, 2002)).rejects.toThrow("Stale action");
  void guest;
});

test("retries of an old request id are ignored even after later actions", async () => {
  const store = new MemoryRoomStore();
  const host = await createRoom(store, { playerName: "Host" }, 1000);
  await joinRoom(store, host.roomCode, "Guest", 1001);
  await startRoom(store, host.roomCode, host.playerToken, 2000);
  const room = await store.get(`room:${host.roomCode}`);
  if (!room?.data.gameState) throw new Error("game missing");
  const first = { type: "EMOTE" as const, playerToken: host.playerToken, emote: "GBAM" as const, requestId: "req-1" };
  await applyRoomAction(store, host.roomCode, host.playerToken, first, 2001);
  const afterFirst = await store.get(`room:${host.roomCode}`);
  if (!afterFirst?.data.gameState) throw new Error("game missing after first action");
  const versionAfterFirst = afterFirst.data.gameState.version;
  await applyRoomAction(store, host.roomCode, host.playerToken, { type: "EMOTE", playerToken: host.playerToken, emote: "CHAI", requestId: "req-2" }, 2002);
  const beforeRetry = await store.get(`room:${host.roomCode}`);
  if (!beforeRetry?.data.gameState) throw new Error("game missing before retry");
  await applyRoomAction(store, host.roomCode, host.playerToken, first, 2003);
  const afterRetry = await store.get(`room:${host.roomCode}`);
  expect(afterRetry?.data.gameState?.version).toBe(beforeRetry.data.gameState.version);
  expect(afterRetry?.data.gameState?.version).toBeGreaterThan(versionAfterFirst);
});

test("reconnect restores a previously disconnected player's connection state", async () => {
  const store = new MemoryRoomStore();
  const host = await createRoom(store, { playerName: "Host" }, 1000);
  const guest = await joinRoom(store, host.roomCode, "Guest", 1001);
  await leaveRoom(store, host.roomCode, guest.playerToken, 1002);
  await reconnectRoom(store, host.roomCode, guest.playerToken, 1003);
  const room = await store.get(`room:${host.roomCode}`);
  expect(room?.data.players.find(p => p.token === guest.playerToken)?.connected).toBe(true);
});
