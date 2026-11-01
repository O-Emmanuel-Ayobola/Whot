# Phase A.2 — Connection & Room Reliability

## Included
- Player and spectator heartbeat timestamps with a 90-second disconnect grace window.
- Dedicated `/heartbeat` endpoint for active sessions.
- Browser online/visibility recovery calls `/reconnect` and refreshes authoritative state.
- Stale non-host players are marked disconnected instead of immediately deleting their sessions, allowing reconnection within the grace window.
- Active Rooms counts only recently-seen connected players and spectators.
- Explicit Leave remains authoritative: the existing host-close/live-game rules are unchanged.
- Abandoned rooms are still removed when the host exceeds the 90-second grace window.

## Client behavior
- State polling continues at 1.5 seconds.
- Heartbeats run every 12 seconds while the tab is visible and the browser is online.
- Returning to a tab or regaining network connectivity triggers reconnect + state refresh.
