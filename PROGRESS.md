# ReSpace Studio — Progress

Updated: 2026-10-18

## Status
Stage B in progress. Plan approved 2026-10-18 (see `BUILD_SPEC.md` section 0).

## Completed
- Foundation: repo-local Git identity, project attribution settings (`.claude/settings.json`), `.gitignore`,
  `CLAUDE.md`, `backend/.env.example`; ignored `backend/.env` created with a generated session secret.
- Backend (FastAPI + SQLAlchemy + Alembic + SQLite): users, server-side sessions, CSRF double-submit token,
  origin check, login rate limit; owner-checked access to projects, uploads, alternatives, revisions,
  proposals, feedback and exports; PNG/JPEG upload validation and re-encoding; geometry validation;
  scene validation (schema refs, sizes, counts, containment, collisions with rug/lamp/wall semantics,
  door swings, clear zones, windows, wall art); walkway connectivity check; typed edit operations with
  lock enforcement; revisions with stale-write rejection; change proposals (apply/discard); export/import;
  feedback; synthetic sample projects; rule-based non-AI layouts.
- AI: provider interface, Gemini adapter (google-genai Interactions API, structured JSON schema output,
  timeouts, bounded retries, error classification), generation with bounded batched repair, conversational
  edits with bounded repair, plan-outline extraction (draft only), visual review with grounding filter,
  test-double provider for CI, `python -m app.ai.smoke` live check.
- Frontend (React 19 + Vite 8 + R3F 9): sign-in, projects, plan editor (import PNG/JPEG/PDF page, calibrate,
  trace, doors/windows, AI outline suggestion, confirm), furniture inventory and brief, 3D design workspace
  (plan/orbit/walk, procedural furniture, drag with snapping, properties, locks, lighting, finishes, checks,
  walkway overlay, proposals preview, chat, history, compare, presentation, PNG export, summary page).
- Shared geometry fixtures (`shared/geometry_fixtures.json`) checked by pytest and Vitest.

## Verification so far
- `backend`: ruff, ruff format, mypy clean; pytest 83 passed (test-double AI only).
- `frontend`: eslint clean; tsc clean; vitest 12 passed; vite build OK.
- Playwright: 10 workflow steps passed locally (register, PDF import, calibrate 10.0 mm/px, trace 20.0 m²,
  door, confirm, furnish, generate with test double, rendered-bounds check, manual edit, lock, undo/redo,
  chat edit with locked sofa preserved, reload, PNG + JSON export, feedback, history/compare/presentation).
- LAN mode (2026-10-18): served on 0.0.0.0:8010; via http://192.168.68.106:8010 same-origin sign-in worked,
  cross-origin POST returned 403, and every browser request targeted the LAN origin (no localhost calls).
- Screenshots captured with Playwright (`docs/screenshots/`), desktop 1440x900 and phone 390x844; fixed
  issues found: canvas height collapse, rotated plan camera, overlay occlusion, chat panel covering Apply,
  mobile header overlap, missing accessible names, eager PDF chunk.

## Blockers
- Live AI verification blocked until `GEMINI_API_KEY` is set in `backend/.env`.

- Fresh clone (2026-10-18): `scripts/setup.ps1` exit 0, backend tests exit 0, build OK.
- CI: `1bb68d5` and `5d561ac` green (backend, frontend, e2e).

## Next action
- Add `GEMINI_API_KEY` to `backend/.env`, then run the live checks listed in `HANDOFF.md` and record results.
