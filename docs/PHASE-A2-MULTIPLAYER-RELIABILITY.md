# Phase A.2 — Multiplayer reliability

Implemented in this build:

- Public/private room visibility. Public rooms appear in Active Rooms; private rooms are reachable by code only.
- Hosts can switch a lobby between public and private before starting.
- Action request IDs make retried client requests idempotent per player, preventing the same accepted action from being applied twice after a network retry.
- Existing optimistic CAS room writes remain in place; a concurrent write retries instead of silently overwriting the other action.
- Active Rooms reports visibility and never advertises private tables.
- Existing host heartbeat and stale-room cleanup remain unchanged.

Storage note: Netlify Blobs still provides optimistic CAS rather than a full database transaction. This pass reduces duplicate-action risk but does not remove the documented production-storage limitation.
