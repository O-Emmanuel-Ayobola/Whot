# Fix: `leaveRoom` has no exported member

The canonical Netlify function in this project is `netlify/functions/game.ts` and `netlify.toml` points Netlify to `netlify/functions`.

If your existing Windows checkout also contains `src/netlify/functions/game.ts`, that is a stale duplicate from an older layout. It is included by the TypeScript `src/**/*.ts` pattern and can fail typechecking even though it is not the configured Netlify function.

From the project root, first confirm the canonical function exists:

```powershell
Test-Path .\netlify\functions\game.ts
```

Then remove only the obsolete duplicate (after confirming the canonical function above returns `True`):

```powershell
Remove-Item .\src\netlify\functions\game.ts
```

Remove empty parent folders if desired. Do not remove `src/roomManager.ts` or `netlify/functions/game.ts`.

Then rerun:

```powershell
npm run build
```

If you need to keep a nested handler for a separate reason, its relative imports must point to the sibling modules in `src/` (for example `../../roomManager`, `../../blobStore`, and `../../types` from `src/netlify/functions/game.ts`). Do not keep two competing Netlify function layouts in a single project.
