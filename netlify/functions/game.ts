import type { Context } from "@netlify/functions";
import { createNetlifyRoomStore } from "../../src/blobStore";
import {
  applyRoomAction,
  createRoom,
  joinRoom,
  leaveRoom,
  resetFinishedRoom,
  readClientState,
  startRoom,
  updateRoomSettings,
  spectateRoom,
  listActiveRooms,
  reconnectRoom,
  heartbeatRoom,
} from "../../src/roomManager";
import type { Action, RoomSettings } from "../../src/types";

const store = createNetlifyRoomStore();

async function body(request: Request): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Request failed";
  const status = /stale action/i.test(message) ? 409 : /not found|room has closed|host left|host.*inactive/i.test(message) ? 404 : /invalid|required|must be|room is full|already started|not your turn|only the host|no longer active/i.test(message) ? 400 : 500;
  return json({ error: message }, status);
}

export default async function handler(request: Request, _context: Context) {
  try {
    const url = new URL(request.url);
    // Use Netlify's default /.netlify/functions/game endpoint with a route query
    // rather than relying on custom path routing. This works consistently in
    // local Netlify Dev and production deployments.
    const rawPath = url.searchParams.get("route") ?? url.pathname;
    const path = rawPath.replace(/^\/api(?=\/)/, "").replace(/\/$/, "") || "/";

    if (request.method === "GET" && path === "/health") {
      const keys = await store.list("room:");
      return json({
        ok: true,
        service: "whot-game-api",
        storage: "available",
        roomRecords: keys.length,
        runtime: process.env.NETLIFY ? "netlify" : "local",
      });
    }

    if (request.method === "GET" && path === "/rooms") {
      return json({ rooms: await listActiveRooms(store) });
    }

    if (request.method === "POST" && path === "/create") {
      const data = await body(request);
      const result = await createRoom(store, {
        playerName: String(data.playerName ?? ""),
        settings: data.settings as Partial<RoomSettings> | undefined,
      });
      return json(result);
    }

    if (request.method === "POST" && path === "/join") {
      const data = await body(request);
      const result = await joinRoom(store, String(data.roomCode ?? ""), String(data.playerName ?? ""));
      return json(result);
    }

    if (request.method === "POST" && path === "/spectate") {
      const data = await body(request);
      const result = await spectateRoom(store, String(data.roomCode ?? ""), String(data.playerName ?? ""));
      return json(result);
    }

    if (request.method === "POST" && path === "/settings") {
      const data = await body(request);
      const result = await updateRoomSettings(
        store,
        String(data.roomCode ?? ""),
        String(data.playerToken ?? ""),
        data.settings as Partial<RoomSettings>,
      );
      return json(result);
    }

    if (request.method === "POST" && path === "/start") {
      const data = await body(request);
      const result = await startRoom(store, String(data.roomCode ?? ""), String(data.playerToken ?? ""));
      return json(result);
    }

    if (request.method === "POST" && path === "/leave") {
      const data = await body(request);
      const result = await leaveRoom(store, String(data.roomCode ?? ""), String(data.playerToken ?? ""));
      return json(result);
    }

    if (request.method === "POST" && path === "/reset") {
      const data = await body(request);
      const result = await resetFinishedRoom(store, String(data.roomCode ?? ""), String(data.playerToken ?? ""));
      return json(result);
    }

    if (request.method === "POST" && path === "/action") {
      const data = await body(request);
      const action = data.action as Action | undefined;
      if (!action) return json({ error: "Action is required" }, 400);
      const result = await applyRoomAction(
        store,
        String(data.roomCode ?? ""),
        String(data.playerToken ?? ""),
        action,
      );
      return json(result);
    }

    if (request.method === "POST" && path === "/reconnect") {
      const data = await body(request);
      const result = await reconnectRoom(store, String(data.roomCode ?? ""), String(data.playerToken ?? ""));
      return json(result);
    }

    if (request.method === "POST" && path === "/heartbeat") {
      const data = await body(request);
      const result = await heartbeatRoom(store, String(data.roomCode ?? ""), String(data.playerToken ?? ""));
      return json(result);
    }

    if (request.method === "GET" && path === "/state") {
      const roomCode = url.searchParams.get("roomCode") ?? "";
      const token = url.searchParams.get("token") ?? "";
      const result = await readClientState(store, roomCode, token);
      return json(result);
    }

    return json({ error: "Not found" }, 404);
  } catch (error) {
    return errorResponse(error);
  }
}
