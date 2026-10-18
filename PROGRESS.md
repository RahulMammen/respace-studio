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
- `backend`: ruff, ruff format, mypy clean; pytest 81 passed (mock/test-double AI only).
- `frontend`: eslint clean; tsc clean; vitest 7 passed; vite build OK.
- Visual check (built app via FastAPI on 127.0.0.1:8000): sign-in, projects, design orbit and plan views.

## Blockers
- Live AI verification blocked until `GEMINI_API_KEY` is set in `backend/.env`.

## Next action
- Playwright end-to-end workflows; visual polish pass; LAN-mode verification; documentation.
