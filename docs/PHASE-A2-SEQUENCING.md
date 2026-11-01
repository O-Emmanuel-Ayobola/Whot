# Phase A.2 — Multiplayer Action Sequencing

This phase adds server-authoritative sequencing on top of the existing CAS room writes.

## Included

- Gameplay actions carry the client's latest `stateVersion` as `expectedVersion`.
- The server rejects stale gameplay actions with HTTP 409 instead of applying them to newer state.
- Each player keeps a rolling server-side history of accepted request IDs so delayed retries cannot replay an old action.
- EMOTE actions remain non-sequenced so reactions do not conflict with gameplay state.
- A reconnect endpoint restores a previously disconnected session without changing its token.
- The frontend reconnects a remembered session before the first state refresh and refreshes after a stale-action response.

## Intentional behavior

A stale gameplay action is rejected and the client refreshes. The player must retry the move against the latest table state. The server never guesses whether the stale move is still legal.

Explicitly leaving a room does not automatically happen from a refresh. A remembered session can reconnect until the room is closed or the session is invalid.
