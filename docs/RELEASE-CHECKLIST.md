# Whot Release Checklist

## Before deployment

1. Use Node.js 22 and the repository root as the Netlify base directory.
2. Run `npm ci`.
3. Run `npm run verify` (native Vitest, server typecheck, frontend typecheck, and Vite production build).
4. Confirm the configured persistence provider is available. The current Blob adapter is for preview/testing only; production multiplayer must use transactional room storage as described in `PRODUCTION-STORAGE-NOTE.md`.

## Preview smoke test

1. Open the preview in Browser A, enter a display name, and create a room.
2. Open the preview in Browser B. Confirm Active Rooms reports `Game service connected` and the new room appears under **Open rooms**.
3. Copy the room code from the room card and join it in Browser B. Confirm player counts update.
4. Start a game in Browser A. Confirm Browser B's room card changes to **Live now** and can be watched from a third tab without exposing player hands.
5. Exit as the host. Confirm the room disappears and other clients return to Home with a closed-table message.
6. Repeat with the host tab closed unexpectedly. After the 90-second heartbeat grace period, confirm the room is removed.
7. Check the mobile layout at 320px, a tablet width around 768px, and laptop widths around 1280–1440px. Ensure the active-room tabs, copy-code control, room cards, and main actions remain usable.

## Diagnostics

Open `/.netlify/functions/game?route=%2Fhealth`. A healthy response includes `ok: true`, `storage: "available"`, and a `roomRecords` count. If Active Rooms says the service is unavailable, inspect the deployed `game` function logs and storage configuration before changing the frontend. A healthy endpoint only confirms API/storage reachability, not safe concurrent state updates.

## Voice pack

Recorded Nigerian-accent voice reactions are intentionally not enabled until licensed or commissioned voice assets are added. Text reactions and non-verbal cues work without those assets. See `docs/voice-pack.md`.


## Production concurrency gate (required)

- [ ] Replace `src/blobStore.ts` in production with a transactional adapter (for example, Netlify Database/Postgres) and schema migration.
- [ ] Run two clients issuing play/turn actions at nearly the same time; verify only one valid state transition is committed and no update is lost.
- [ ] Verify join/leave/host-close races and stale host cleanup under concurrent requests.
- [ ] Keep the Blob adapter marked preview-only until these checks pass.
