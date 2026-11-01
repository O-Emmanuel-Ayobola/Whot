# WHOT! — Played at Home (Phase 15: Room UX + Release Verification)

This phase adds an offline practice layer without changing the server-authoritative online room flow.

## Historical feature set (practice removed in Phase 13)
- Practice vs Computer was previously available from the landing page.
- Easy, Medium and Hard AI personalities/decision styles.
- Speed Whot option with a 5-second turn timer.
- Local practice round uses the same core engine and card rules as online play.
- WHOT 20 shape picker, Pick Two stacking, draw/timeout behavior and win flow are reused.
- Practice results include a dedicated winner/game-over screen and replay button.

## Online multiplayer remains unchanged
Private rooms, spectators, match modes, social/progression, secret bounties, audio settings and the existing server transport remain in place.

## Verification
The environment did not have a complete installed dependency tree. `npm ci` timed out and the available TypeScript check could not run because the Node/Vitest type packages were unavailable. The source changes are included, but run `npm install`, `npm test`, `npm run typecheck`, `npm run typecheck:frontend`, and `npm run build` locally before deployment.

## Phase 8 — Played at Home / House Rules + Ranks

- Added editable host-controlled house rules in the lobby.
- Rule toggles: 2 Pick Two stacking, 5 Pick Three, 1 Hold On, 8 Suspension, 14 General Market.
- Card 5 remains a normal 5 when Pick Three is disabled.
- Starting hand can be set from 3–7 cards.
- Added saved local rulesets, including the built-in **Auntie Ngozi's rules** preset.
- Added a Rules & Tutorial panel with animated card examples.
- Added a friends-room leaderboard using the current room's match wins.
- Added themed rank ladder: Roadside → Compound → Market → Chief → Republic Champion.
- Added weekly local win tracking and most-used card-back tracking on the profile.
- Multiplayer table now uses a table-baize green surface to make the cards stand out.
- Solo bots now have home-character names, styles, and trash talk.
- Added `/settings` host endpoint so house rules are persisted server-side before the game starts.

### Verification

- All TS/TSX source files passed TypeScript transpile syntax validation.
- Full `tsc` / Vitest execution could not be completed in the build environment because required `@types/node`, `vitest`, and related dependencies were unavailable; `npm ci --ignore-scripts` timed out.

## Phase 9 — The Dare Deck

Added a local progression layer for table tasks and dares. Active challenges include Last Card Swagger, Slap and Shout, Number Loyalty, Clean Sweep, Pick-Two Survivor, Whot Flex, Shape Hopper, Poker Face, Hold the Line and more. Daily/weekly tasks, mystery tasks, task XP, and a dedicated Dares panel are available from navigation.

Round task detection is driven from the sanitized game state: card plays, draws, Whot shape selection, turn changes, Pick-Two penalties and round results. The server remains authoritative for all actual card play.

## Phase 11 — Themes + Design Rework

This phase keeps the Phase 10 game systems and gives the product a stronger visual identity.

### Table themes
- Baize — classic green felt
- Sunset — warm red/orange home-table look
- Night Market — dark late-night table
- Lagoon — deep teal felt
- Royal — blue + gold premium table
- Paper — bright tabletop

Themes are stored with the local player profile and apply across the home screen, room lobby and game table. Older `cream`/`wine` profile values are migrated visually to `baize`/`sunset`.

### Design rework
- Home page now leads with the "played at home" hook.
- Room code has a stronger invitation treatment.
- Lobby cards, scoreboards and house rules have a more tactile card-table feel.
- Multiplayer tables use theme-specific felt/table treatments.
- Profile theme selector now uses visual theme cards and unlock levels.
- Card hover/deal treatment is more physical and premium.
- House rules/tutorial panels were tightened into a more editorial UI.
- Responsive layouts were updated for smaller screens.

### Verification
- All TS/TSX source files transpile successfully with the local TypeScript compiler.
- Full dependency-based typecheck/tests were not run in the extracted environment because the project dependencies are not installed.

## Phase 13 — Responsive UI + Live Room Browser

- Removed Practice vs Computer / AI from the landing screen and removed the unused local AI implementation from the frontend bundle. The normal multiplayer room flow remains the primary experience.
- Added a live `/rooms` endpoint backed by the shared room store. The home screen now lists discoverable lobby rooms and live matches, including host name, room code, player count, mode, starting hand size and spectator count.
- Active room cards provide one-tap **Join this table** for open lobbies and **Watch live table** for live matches. The panel supports a name, search, manual refresh and automatic refresh every eight seconds.
- Added host heartbeats. A host who exits through the app closes/deletes the room immediately. Rooms whose host stops polling are pruned after 90 seconds; clients are returned to the home screen with a clear notice when their room has closed.
- Added a responsive layout for laptop, tablet and narrow phone widths, with room cards, search controls, create/join forms and navigation adapting by breakpoint.
- Added room-store listing/deletion methods and tests for the active room directory, immediate host closure, and stale-host cleanup.

### Verification

- All TypeScript/TSX source files passed TypeScript syntax transpilation.
- The full dependency-based typecheck and Vitest suite were not run here because `node_modules` is not installed in this environment. Run `npm ci`, `npm test`, and `npm run build` before deployment.


## Phase 14 — Room directory fix + deployment hardening

- Fixed the Netlify publish directory: Vite outputs to repository-root `dist`, and Netlify now publishes that exact directory.
- Changed browser requests to call Netlify's stable default endpoint `/.netlify/functions/game?route=...` instead of relying on custom function path routing. This specifically hardens the active room directory and all game API calls.
- Added `/health` to verify that the game function and Netlify Blobs store are accessible; it returns whether storage is available and the number of room records.
- Disabled browser-generated spoken reactions. Text reactions and non-verbal sound effects remain, while the audio settings clearly explain that recorded Nigerian-accent voice clips will be added once licensed/commissioned assets are available. An empty `frontend/public/audio/voices/` asset folder and `docs/voice-pack.md` are included for that later pack.
- Added `.nvmrc` and a Node version requirement for a consistent Netlify/Vite build.

### Deployment checks

1. Use the repository root as the Netlify base directory.
2. Build command: `npm run build`. Publish directory: `dist`. Functions directory: `netlify/functions`.
3. Deploy with Netlify Functions and the site-wide Netlify Blobs store enabled for the site.
4. After deployment, open `/.netlify/functions/game?route=%2Fhealth`. It should return JSON with `ok: true` and `storage: "available"`.
5. Open two browsers/devices, create a room in one, and verify it appears in Active Rooms on the other. Join, start the game, then verify the listing changes from open to live.
6. Run `npm ci`, `npm test`, and `npm run build` before production release.


## Phase 15 — Room UX + Release Verification

- Added All / Open / Live filters for the active-room directory.
- Added a server-health indicator so a deployment/API problem is distinguishable from an empty room list.
- Added one-tap room-code copying with clipboard fallback.
- Added room-directory request de-duplication to avoid overlapping refreshes and stale response races.
- Validated room-list and health endpoint response shapes before rendering.
- Remembered the player's display name locally (with storage failure safely ignored).
- Fixed the default six pinned reactions so every default button maps to a valid reaction.
- Fixed first-reaction rate limiting so a player can react immediately after the game begins; the Pick Three test now keeps a second card in hand so it tests the action effect instead of immediate round victory.
- Added `npm run verify` and a GitHub Actions workflow to run tests, typechecks, and the production frontend build on pushes and pull requests.
- Updated the Vite config to resolve its own directory with `fileURLToPath(import.meta.url)`, avoiding ESM `__dirname` assumptions.
- Hardened saved reaction pins so older or malformed local preferences recover to six valid reactions.

### Release verification

Run `npm ci`, then `npm run verify`. Before launch, deploy to a Netlify preview and test create/join/watch/host-exit from separate browser sessions. The app currently uses Netlify Blobs for room documents; that is convenient for a preview but **is not a transaction-safe production store for concurrent game actions**. Before advertising this as production multiplayer, migrate room state to a transactional database (for example, Netlify Database/Postgres) and run the concurrency smoke tests described in `docs/PRODUCTION-STORAGE-NOTE.md`. The in-app service status and `/.netlify/functions/game?route=%2Fhealth` endpoint report API/storage reachability, not transaction safety.

Environment verification performed here: 12 TS/TSX files passed syntax transpilation; backend type-checking passed against temporary Netlify declarations; frontend API/component type-checking passed with temporary React declarations; the existing 24 engine/room test cases were executed through a lightweight compatibility harness and all passed. A native `npm run verify` attempt stopped immediately because `vitest` was unavailable after dependency installation timed out; the actual Vite production build was therefore not run locally. CI/Netlify preview verification remains a release gate.


### Important production limitation

The current `src/blobStore.ts` is a Netlify Blobs adapter. It improves storage consistency for reads and uses conditional writes, but it does not provide database transactions for the room's read-modify-write state transitions. Netlify's own guidance says Blobs is not intended for transactional/concurrent state and recommends a database when concurrent-write invariants matter: https://www.netlify.com/knowledge-base/how-to-store-files-and-objects-with-netlify-blobs/ and https://docs.netlify.com/build/data-and-storage/netlify-database/. Keep this release in preview/testing until room state is backed by transactions and a two-client simultaneous-action test passes. See `docs/PRODUCTION-STORAGE-NOTE.md`.

### Windows build error: `leaveRoom` has no exported member

If `npm run build` reports the error from `src/netlify/functions/game.ts`, see [the fix guide](docs/FIX-WINDOWS-BUILD-ERROR.md). The canonical Netlify function is `netlify/functions/game.ts`; remove the stale nested copy from an existing checkout after verifying that the canonical function exists.
