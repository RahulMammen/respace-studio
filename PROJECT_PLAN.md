# ReSpace Studio — Implementation Plan

**1. Workflow and release scope.** Sign in → create project → upload PNG/JPEG or pick a PDF page → calibrate (mark segment, enter length) → trace/correct rooms, wall heights, doors, windows (AI may propose geometry; nothing is authoritative until confirmed) → furniture inventory and brief → three validated AI proposals (or labelled sample mode) → edit in plan/orbit/walkthrough → chat edits with preview, Apply/Discard, locks → revisions, alternatives, compare → PNG/JSON export, summary, schedule → feedback per revision. Single room first, then several simple rooms on one floor. No CAD/BIM, multistorey, AI meshes, native app.

**2. Architecture.** Monorepo: `frontend/` (React 19, TypeScript, Vite 8, R3F 9, drei 10, zustand with command-based undo, pdfjs-dist renders PDF pages in-browser, Vitest, ESLint) and `backend/` (FastAPI, Pydantic 2, SQLAlchemy 2 + Alembic, SQLite, Shapely for geometry validation, pwdlib/argon2 + DB-backed session cookies). Plans stored in ignored `backend/data/`. Playwright E2E, GitHub Actions (ruff, mypy, pytest, eslint, tsc, vitest, build, Playwright with mocked AI). npm + pip/venv only.

**3. UI and visual direction.** Warm ivory canvas, stone panels, charcoal text, one muted sage-green accent; Fraunces display + Inter text (OFL, self-hosted). Room canvas fills screen; slim left tool rail, collapsible right properties/inventory panel, chat drawer, top bar with view switcher, undo/redo, save status. Proposed changes in dashed accent outline, locks with padlock badge and hatched footprint. Procedural furniture with generated thumbnails, material swatches, compass, dimension labels, snapping, camera presets, low-quality mode, shortcuts dialog, reduced motion, touch gestures.

**4. AI provider.** Google Gemini API, official `google-genai` SDK, default `gemini-3.8-flash` (stable, free tier, image input, JSON-schema output; verified 2026-10-18), configurable via `GEMINI_MODEL`. Behind a `DesignModelProvider` interface; mock provider for CI only. Key setup: copy `backend/.env.example` to `backend/.env`, open it in Antigravity, set `GEMINI_API_KEY=` to a key from Google AI Studio. `.env` is git-ignored; never paste the key in chat. Limitations: free-tier rate limits (shown in AI Studio, not documented per model); free-tier content may be used for training and read by human reviewers, so only synthetic plans go to the AI; output quality varies; layout judgement is not expert.

**5. Validation and editing.** Pydantic scene schema (stable IDs, metres, degrees). Validator: finite/positive values, catalogue categories, counts, dimension ranges, Shapely containment, oriented-footprint collisions (rugs/ceiling lamps exempt from floor collision; wall items checked against walls), door-swing and window clearances, configurable walkway width via clearance-graph check. Max 2 repair rounds; unresolved issues shown, never marked valid. Edits are typed ops (move/rotate/resize/setMaterial/setLighting/add/remove); backend rejects locked-property changes and stale `base_revision`; full scene revalidated before Apply.

**6. Milestones and acceptance.**
- M0 Scaffold, attribution config, CI, repo creation — CI green, commit author verified.
- M1 Projects, upload, PDF, calibration, tracing — coordinate/self-intersection tests, E2E 1–2.
- M2 Inventory, procedural 3D, editing, views — footprint/dimension agreement tests, E2E 5.
- M3 Live generation, validation, repair — validator + mock-provider tests, live run logged.
- M4 Chat edits, locks, history, compare — lock/stale/undo tests, E2E 6.
- M5 Review, presentation, exports — round-trip tests, E2E 7.
- M6 Auth, ownership, samples, feedback, docs — ownership/upload tests, E2E 3–4, 8, fresh-clone check, screenshots, HANDOFF.md.

**7. Uncertainties and testing.** Gemini extraction accuracy on real plans (manual tracing is primary); free-tier quota may slow live testing; walkthrough comfort on touch devices. Testing: tester runs locally or reaches `http://<your-LAN-IP>:8000` on the same network (Windows firewall prompt is yours to approve); sample synthetic projects; feedback form logs against revision.

**Approved 2026-10-18 with clarifications:** Gemini free tier, synthetic/anonymised plans, no paid billing. Localhost by default; explicit LAN option, same-origin serving, no public exposure. Auth and ownership in the foundation (M0/M1), final security check in M6. Walkway check is a documented connectivity test from the entrance, not a pairwise gap. Rendered and validated geometry share one definition, tested with shared fixtures. One small live structured-output request runs as soon as the key exists. Details: `BUILD_SPEC.md` section 0.
