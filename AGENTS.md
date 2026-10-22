# AGENTS.md

Guidance for coding agents working in this repository. These instructions apply to the entire tree unless a more specific `AGENTS.md` overrides them.

## Project overview

RemielleStrap is a cross-platform Roblox bootstrapper and launcher built with Electron, TypeScript, Svelte 5, Vite, and Tailwind CSS 4. Windows is the primary target; macOS and Linux support must degrade gracefully where Roblox or OS integrations are unavailable.

The codebase separates the Electron main process, preload bridge, renderer, and shared contracts. Preserve that separation when adding features.

## Setup and common commands

Bun is used by the release workflow. The npm equivalents of these scripts also work.

```bash
bun install --frozen-lockfile  # install dependencies without changing the lockfile
bun run dev                    # start Electron with hot reload
bun run typecheck              # TypeScript for Node/preload plus svelte-check
bun run lint                   # ESLint
bun run build                  # typecheck and create the electron-vite build
bun run build:unpack           # build and package an unpacked application
bun run build:win              # package for Windows; build:mac and build:linux also exist
```

`bun run format` runs Prettier with `--write` across the repository. Prefer formatting only files you change so unrelated formatting churn does not obscure a patch. Avoid lockfile changes unless dependencies actually change, and keep dependency metadata consistent with the package manager used.

There is currently no automated `test` script. Run typechecking and linting for code changes, and run the relevant build or manual flow when behavior changes.

## Repository map

- `src/shared/`: platform-neutral domain models, settings and defaults, state, catalogs, and the IPC contract.
- `src/main/core/`: bootstrapper, deployment, channel, and version-selection logic.
- `src/main/services/`: application behavior and integrations such as accounts, mods, FastFlags, servers, backups, and settings persistence.
- `src/main/ipc/`: IPC registration, request validation, and delegation to services.
- `src/main/app/`: Electron windows, tray, protocol, notifications, CSP, and other app-shell behavior.
- `src/main/utils/`: main-process filesystem, archive, path, logging, and hashing helpers.
- `src/preload/`: the frozen, typed `contextBridge` API exposed as `window.remielle`.
- `src/renderer/src/lib/components/`: reusable Svelte components.
- `src/renderer/src/lib/pages/`: feature pages.
- `src/renderer/src/lib/stores/`: Svelte 5 rune-based stores in `.svelte.ts` files.
- `src/renderer/src/lib/ipc/`: the renderer's guarded access to the preload API.
- `docs/`: external formats and integration documentation.
- `README.md`: feature overview, build instructions, and the manual launch-path test matrix.

Use the configured aliases where appropriate: `@shared/*` across processes, `@main/*` in the main process, and `@renderer/*` in renderer code.

## Architecture invariants

### Shared contracts and IPC

`src/shared/ipc.ts` is the single source of truth for request/response and event types. When changing IPC:

1. Add or update reusable payload types in `src/shared/models.ts` (or the appropriate shared module).
2. Update `InvokeMap` or `EventMap` and the corresponding runtime channel list in `src/shared/ipc.ts`.
3. Implement main-process handling in `src/main/ipc/index.ts`, validating untrusted input with the helpers in `src/main/ipc/validate.ts`.
4. Keep domain behavior in a service or core module rather than in the IPC handler.
5. Expose only the necessary typed preload API and consume it in the renderer through `src/renderer/src/lib/ipc`.
6. Unsubscribe from renderer event listeners when their owner is destroyed or the effect is cleaned up.

The exhaustive channel checks and `registerIpcHandlers()` startup validation are intentional. Do not bypass them with untyped channel names or casts.

### Process boundaries and security

- The renderer must not import Node or Electron APIs, access the filesystem directly, or persist account secrets. Use the typed preload bridge.
- Keep `.ROBLOSECURITY` cookies, tokens, backup passphrases, and other credentials out of logs, settings JSON, and error messages. Long-term account credential storage belongs in the existing OS credential-store flow; clear transient renderer credential inputs immediately after use.
- Treat IPC payloads, imported files, remote metadata, archive entries, and URLs as untrusted. Validate them at the boundary and preserve HTTPS, checksum, external-host, and protected-path restrictions.
- Reuse existing path, filesystem, ZIP, HTTP, and logging helpers. New filesystem or process side effects belong in the main process and need explicit validation and error handling.
- Preserve the production CSP, context isolation, navigation restrictions, and least-privilege window settings. Development-only relaxations must not weaken packaged builds.

### State and platform behavior

- Main-process stores own persisted settings and state; renderer stores are reactive mirrors. Reconcile renderer state with values returned by main rather than maintaining competing sources of truth.
- Preserve existing defaults and migration behavior when changing persisted shapes. Older settings, backups, mods, and flag profiles should continue to load or fail with a clear, non-destructive error.
- Keep platform-specific behavior behind explicit platform checks. Do not assume Windows-only APIs, paths, Roblox player availability, window effects, or process tooling exist on every OS.
- Destructive operations such as installs, deletion, cleaning, mod application, and backup import should retain confirmation/dry-run behavior, useful errors, and rollback or restoration guarantees where already provided.

## Coding conventions

- Follow `.editorconfig` and `.prettierrc.yaml`: UTF-8, LF, two-space indentation, single quotes, no semicolons, no trailing commas, and a 100-character print width.
- TypeScript is strict. Prefer explicit types at process and persistence boundaries, and use `import type` for type-only imports. Do not silence errors with broad `any`, non-null assertions, or unnecessary type casts.
- Use Svelte 5 syntax and runes consistently with nearby code. Do not rewrite rune-based stores or components to older Svelte patterns without a reason.
- Follow existing naming, error-result, logging, and component patterns in the module you touch. Handle expected IPC failures without leaving unhandled promise rejections.
- Keep changes focused. Avoid unrelated refactors, dependency upgrades, generated files, and whole-repository formatting.
- Do not commit `node_modules/`, `out/`, `dist/`, logs, caches, credentials, local settings, or user data.

## Verification and documentation

For ordinary code changes, run:

```bash
bun run typecheck
bun run lint
```

Run `bun run build` before finishing changes that affect bundling, process boundaries, aliases, preload exposure, or production CSP. Package and manually test OS-specific changes on the affected platform when possible.

For launch, installation, mod, account, or cleanup changes, use the relevant scenarios from the **Manual test matrix** in `README.md`; static checks cannot cover those side effects. Exercise both success and failure/cancellation paths, and confirm that a failure does not leave user data or client files damaged.

Update documentation alongside behavior changes, especially `docs/community-mods.md` for the community index format, `docs/studio-bridge.md` for the Studio bridge, and `README.md` for user-visible workflows. In your final summary, list checks actually run and call out any platform-specific testing that remains necessary.
