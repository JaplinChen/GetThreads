# CONTRIBUTING

This project can be edited by both Codex and Claude Code.
Use this file as the single source of engineering rules so tool-generated changes stay compatible.

## Required checks (run before commit)

```bash
npm run lint
npm run test
npm run build
```

If one fails, fix it before opening PR/commit.

## Project conventions

- Language: TypeScript (ESM).
- Do not edit `dist/` manually.
- Keep changes in `src/` and generated output via build.
- Prefer `import type` for type-only imports.
- Avoid `any` unless unavoidable.

## Architecture guidelines

- `src/core/errors.ts`: shared error classification and user-facing error messages.
- `src/core/logger.ts`: shared structured logging entrypoint.
- `src/commands/command-runner.ts`: shared async command wrapper.
- `src/commands/register-commands.ts`: command wiring and command/action dispatcher.

When adding new commands:

1. Implement handler logic in `src/commands/*`.
2. Register via `registerAsyncCommand` or `registerAsyncAction` in `register-commands.ts`.
3. Route errors through `runCommandTask` + `formatErrorMessage`.
4. Use `logger` instead of raw scattered `console.*` where possible.

## URL and dedup policy

- Use `canonicalizeUrl` from `src/utils/url-canonicalizer.ts`.
- Do not re-implement URL normalization in feature modules.
- If platform-specific URL behavior is needed, extend `canonicalizeUrl` with tests.

## Callback data policy (Telegram)

- Telegram callback data has a strict length limit.
- Use `buildCallbackData(...)` and `resolveCallbackPayload(...)` in `knowledge-query-command.ts`.
- Do not put long raw payload directly into `callback_data`.

## Tests to update when changing core behavior

- URL normalization changes:
  - `src/utils/url-canonicalizer.test.ts`
- Callback token/payload mapping changes:
  - `src/commands/knowledge-query-command.test.ts`

## Suggested workflow for AI coding tools

1. Read this file and relevant module before editing.
2. Make minimal scoped changes.
3. Run lint/test/build.
4. Summarize changed files and behavior impact.

## Non-goals for routine edits

- Do not refactor unrelated modules in the same commit.
- Do not change generated lock/build files unless dependencies/build output changed.
