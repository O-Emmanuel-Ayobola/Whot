# Production storage gate: room state needs transactions

## Current state

`src/blobStore.ts` stores one whole room document per Netlify Blob key and implements versioned conditional writes. This is useful for prototypes and preview testing, but it is not an adequate production guarantee for a real-time multiplayer game where several clients may submit card plays, heartbeats, reactions, joins, and leaves at the same time.

The issue is not whether the endpoint is reachable or whether a read-after-write returns quickly. Game actions are read-modify-write transitions with invariants (whose turn it is, who holds which cards, pending penalties, winner detection). Those transitions need to commit atomically against the latest state.

Netlify's current documentation explicitly positions Blobs for object/cache-like state and says not to use it for transactional read-modify-write logic, even with conditional-write retries. It recommends Netlify Database/Postgres for state that requires transaction safety:

- [Netlify Blobs guidance](https://www.netlify.com/knowledge-base/how-to-store-files-and-objects-with-netlify-blobs/)
- [Netlify Database documentation](https://docs.netlify.com/build/data-and-storage/netlify-database/)
- [Netlify Database getting started](https://docs.netlify.com/build/data-and-storage/netlify-database/getting-started/)

## Before production launch

1. Provision a transactional database supported by the chosen Netlify plan.
2. Add a versioned schema migration for room records and any indexes needed for active-room listing / heartbeat cleanup.
3. Implement room mutations as transactions or atomic version-checked updates. Ensure the read, validation and write for a game action cannot race with another request.
4. Keep room tokens private; only return the sanitized client view to players/spectators.
5. Add concurrency tests for two nearly simultaneous actions, join-vs-start, host-leave-vs-action, and stale-host cleanup.
6. Deploy to a Netlify preview and run `npm run verify`, followed by a multi-browser smoke test and load/concurrency test.

## What the health endpoint does (and does not) prove

`/.netlify/functions/game?route=%2Fhealth` confirms that the function can access its configured storage and reports the current room-record count. It does **not** certify transaction safety or verify that simultaneous game mutations cannot overwrite one another.

Until a transactional adapter and these tests are present, describe the current deploy as a preview / controlled playtest, not production-hardened multiplayer.
