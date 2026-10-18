# ReSpace Studio — Build Specification

Status: **Plan approved 2026-10-18 — Stage B in progress.** Section 0 records approved decisions;
sections 1–14 preserve the owner's original requirements. Keep this file aligned with approved
decisions.

---

## 0. Approved / proposed decisions (Stage A, 2026-10-18)

| Area | Decision |
|---|---|
| Folder | `D:\College\Projects\ReSpaceStudio` (verified empty, no parent Git repo) |
| Repo | `RahulMammen/respace-studio`, PUBLIC (name verified unused 2026-10-18) |
| Git identity | repo-local `Rahul Tom Mammen <rahul.tom.mammen@gmail.com>`; global left unchanged |
| Attribution | project `.claude/settings.json`: `attribution.commit = ""`, `attribution.pr = ""`, `includeCoAuthoredBy = false`; no Claude trailers, bylines, or session links; verified by inspecting commits before push |
| Frontend | React 19, TypeScript, Vite 8, three 0.186, @react-three/fiber 9, @react-three/drei 10, zustand (state + command-based undo), pdfjs-dist (client-side PDF page rasterisation), Vitest + Testing Library, ESLint, Playwright 1.64 |
| Backend | Python 3.12, FastAPI, Pydantic 2, SQLAlchemy 2 + Alembic, SQLite, Shapely (polygon validity, containment, collisions), pwdlib[argon2] password hashing, server-side session cookie, pytest, ruff, mypy |
| AI provider | Google Gemini API via official `google-genai` SDK (Interactions API), default model `gemini-3.8-flash` (stable, free tier, image input, JSON-schema structured output). Model ID configurable via `GEMINI_MODEL`. No silent model downgrade or provider switch. Provider behind `DesignModelProvider` interface |
| Data handling | Free (unpaid) Gemini tier: Google may use prompts/outputs to improve products and human reviewers may read them; terms say not to submit sensitive/confidential/personal data. Therefore live tests use synthetic plans only; README warns testers; real client plans require paid tier or explicit owner decision |
| Package managers | npm (installed) and pip + venv (uv/pnpm not installed; avoid extra tooling) |
| Assets | Procedural furniture geometry (no model downloads). Optional small CC0 textures/HDRI (Poly Haven / ambientCG, ≤1k resolution), fonts via @fontsource (OFL). All recorded in `ASSETS.md` |
| Coordinates | Plan image: pixels, origin top-left, +u right, +v down. World (backend): metres, origin = plan top-left after calibration, +X = right, +Y = down-plan. Three.js: `x = X`, `z = Y`, `y = up`, metres. Angles: rotation about vertical axis, degrees in API, clockwise when viewed from above in plan |
| Deployment | Default bind `127.0.0.1`. Explicit opt-in LAN launch (`-Lan`) binds `0.0.0.0`; production frontend and API served from one origin so tester browsers never call `localhost`. Firewall never changed automatically. No public internet exposure, no paid hosting |
| AI tier (approved) | Gemini free tier with synthetic/anonymised plans for development and architect testing. Paid billing never enabled |
| Auth/ownership (approved A) | Users, sessions and `owner_id` exist from the first migration. Every project, upload, scene, revision, feedback and export endpoint resolves the project through an owner-checked dependency. Final security verification in M6 |
| Walkway check (approved B) | Approximate connectivity check, not just pairwise gaps: free floor = room interior eroded by clearance/2 minus floor-blocking footprints dilated by clearance/2 (Shapely, vector geometry, arc tolerance < 1 mm). Main entrance door must connect to every other door and to each furniture access zone in the same connected free region. Documented in `docs/geometry.md` with limitations |
| Render = validate (approved C) | One footprint definition (centre, size, rotation) used by the validator and by the renderer; procedural meshes are built to fill exactly their declared bounding box. Shared fixture `shared/geometry_fixtures.json` checked by pytest and Vitest (rotated objects, openings, coordinate conversion) |
| LAN security (approved D) | Same-origin serving; HttpOnly SameSite=Lax session cookie; double-submit CSRF token on unsafe methods plus Origin/Host check; configurable allowed origins; API key backend-only; frontend uses relative `/api` URLs |
| Live AI early (approved E) | `backend/.env.example` + ignored `backend/.env` created first; `python -m app.ai.smoke` sends one small synthetic structured-output request once the key exists; access/quota errors reported verbatim-categorised |

Environment verified: Python 3.12.10, Node 22.19.0, npm 10.9.3, Git 2.55.0, gh 2.102.0
(authenticated as RahulMammen, scopes repo/workflow), Claude Code 2.1.281, Playwright 1.64.1
via npx, built-in browser pane available for screenshots.

---

## 1. Product vision

ReSpace Studio is an AI-assisted interior concept-design workspace for architects and interior
designers. An architect uploads a floor plan, confirms its geometry, provides furniture
requirements and a design brief, and receives editable 3D interior proposals.

The architect can:
- Explore the proposed space.
- Move and configure furniture directly.
- Request changes through natural language.
- Lock objects or individual properties.
- Compare design alternatives.
- Save revisions and export presentation images.
- Record feedback during user testing.

Example brief: "Living room with a three-seater sofa, two accent chairs, a bookshelf, and a coffee
table. Warm contemporary style, oak finishes, muted green accents, and evening lighting. Preserve a
clear main walkway."

Example revision: "Keep the arrangement and sofa. Make the chairs visually lighter, change the
floor to pale oak, and add warm accent lighting."

The AI must produce structured, editable scene data. The renderer must display that same scene.

The application supports architectural concept exploration. Do not claim building-code
compliance, structural verification, engineering-grade lighting analysis, or expert-level design
quality without evidence.

## 2. Architecture and release scope

Preferred stack: React, TypeScript, Vite; Three.js through React Three Fiber and helpers; Python
3.12, FastAPI, Pydantic; SQLAlchemy with migrations; SQLite; live multimodal AI via backend; pytest,
frontend tests, Playwright; GitHub Actions. Use compatible versions and record what was tested.
Avoid unnecessary infrastructure and framework churn.

Complete a single-room workflow first, then support several simple rooms on one floor using the
same project model. Complex CAD/BIM imports, multistorey reconstruction, arbitrary AI-generated
furniture meshes, and a native phone app are future extensions. A responsive web interface is part
of this release.

Maintain `PROGRESS.md` after each milestone: completed work, commands and verification results,
blockers, exact next action.

## 3. Art direction and usability

Calm, spatial, artistic, professional. Warm ivory, stone, charcoal, one restrained accent colour.
Refined typography, clear hierarchy, readability, generous whitespace, careful alignment, subtle
borders, restrained animation. Visual furniture thumbnails, material samples, colour swatches.
Consistent interaction and selection language. Visual quality is a release requirement.

Workspace built around the room: canvas takes most of the screen; compact contextual tools;
properties for selected object; collapsible secondary panels; AI conversation accessible without
crowding the model; clear plan/orbit/walkthrough switching; orientation cues, dimensions, snapping,
camera reset; locks and proposed changes visually distinct; undo/redo and save status visible.

First-run guidance: 1) Import the plan. 2) Confirm geometry and furniture. 3) Describe the design and
explore proposals. Concise product language. Provider configuration, JSON, repair attempts, and
diagnostics live in technical settings.

Support mouse, trackpad, keyboard, touch where practical. Accessible shortcuts guide. Readable
contrast, reduced-motion support. Inspect rendered screens at milestones; fix clutter, overlap,
unreadable labels, awkward camera behaviour, inaccessible controls before completion.

## 4. Milestone 1 — Measured floor plan and project storage

- Create, list, open, rename, delete projects.
- PNG/JPEG floor-plan upload; usable PDF-page import workflow.
- Plan canvas with pan, zoom, calibration, editing.
- Calibration: mark a known segment, enter its length.
- Editable simple room boundaries and wall heights.
- Doors, windows, positions/dimensions.
- Confirmation before inferred geometry becomes authoritative.
- AI-assisted extraction may propose geometry and flag uncertain features; must not silently
  invent precise dimensions. Manual tracing and correction remain usable.
- Explicit units and coordinate conventions; documented and tested conversion between plan
  coordinates, backend geometry, Three.js coordinates.
- Persist: source plan and calibration, confirmed geometry, furniture requirements, scene
  alternatives, locks, revisions.
- Uploaded plans in ignored local storage, never Git.

## 5. Milestone 2 — Furniture and interactive 3D

Visual furniture inventory: category, count, required/optional, dimensions or permitted ranges,
existing furniture to retain, configurable materials/colours/supported style parameters.

Core categories: sofa, armchair, table, dining chair, desk, bed, wardrobe/bookshelf, rug, lamp.

Attractive procedural models and, where helpful, a small number of properly licensed assets.
Record asset sources and licence obligations. Avoid large model downloads.

Implement: selection, movement, rotation, dimension editing; snapping and contextual property
controls; material and lighting controls; floor-plan, orbit, walkthrough views; camera presets and
reset; wall/ceiling visibility controls; lower-quality mode for weaker devices.

Displayed dimensions and collision footprints must agree. Do not describe approximate furniture as
exact reconstructions.

## 6. Milestone 3 — Live AI design generation

Real backend AI-provider adapter.

Inputs: confirmed room geometry and openings; furniture requirements and allowed dimensions; style
description and optional reference images; existing scene and locked properties; user priorities
and requested changes.

Outputs: three distinct proposals where feasible; structured scene data with stable IDs; material
and lighting choices; concise rationale and tradeoffs; explicit unresolved constraints.

Use provider structured outputs; validate independently with Pydantic. Schema validity does not
establish geometric validity.

Enforce: finite coordinates and positive dimensions; valid categories, IDs, supported model
references; required furniture counts; allowed dimension ranges; room containment; relevant
collisions; opening and door-swing constraints; configurable circulation/access clearances.
Suitable collision semantics for rugs, wall decor, lighting. Document geometric assumptions and
clearance settings.

Bounded proposal repair. Never silently display an invalid proposal as validated. If requirements
conflict, explain conflicting constraints and offer changes for the architect to approve. No
objective claim of professional design quality; show understandable component checks and user
preferences. Never execute model-generated code, SQL, shell commands, or scripts. Treat uploaded
plan text and images as untrusted content.

## 7. Milestone 4 — Conversational editing and history

Conversation per project; typed scene-edit operations; backend-enforced object/property locks;
proposed-change preview; highlighting affected objects; Apply and Discard; undo/redo; persisted
revisions and named alternatives; before/after comparison.

Operations: move, rotate, resize within bounds, set material, set lighting, add/remove explicitly
permitted objects. Preserve unrelated scene properties. Do not alter confirmed building geometry
without explicit geometry-edit request. Validate the complete resulting scene before accepting a
patch. Scene revision identifiers reject stale AI responses that would overwrite newer manual edits.
Preserve current scene while AI request is processing.

Verify: "Keep everything except the flooring." "Move only the desk nearer the window." "Keep this
sofa and its position locked." "Make the lighting warmer." "Try another arrangement using the same
required inventory."

## 8. Milestone 5 — Review and presentation

Optional bounded AI review using actual scene screenshot, scene data, validation findings.
Explanations grounded in actual scene properties. Architect acceptance of proposed revisions.
Presentation mode. PNG export from actual rendered scene. Versioned project JSON export/import.
Concise design summary and furniture schedule. Save/load preserving geometry, objects, materials,
locks, lighting, positions. Optional additions separate from required furniture. Suggestions may
specify categories, dimensions, finishes, colours. No fabricated product URLs or prices. No
generated photographic imagery that disagrees with the editable scene presented as accurate render.

## 9. Milestone 6 — Architect user testing

Basic accounts and project ownership checks; secure authentication via maintained libraries;
protection against cross-user access; clear loading/empty/validation/failure states; file-type
validation and upload limits; responsive layouts and touch controls; feedback linked to design
revision; several sample projects with synthetic/anonymised plans. Straightforward setup; document
local and same-network testing. Production build and deployment instructions. No purchased
hosting, no public exposure of owner's computer, no private plans in public demo without explicit
authorisation. Distinguish GitHub source publication from hosted app availability.

## 10. AI provider, cost, data handling

Credentials backend-only in ignored env files; `.env.example` with placeholders; configurable
model; verified data-handling terms; explain what is sent externally; synthetic plans for live
tests; timeouts, cancellation, bounded retries; bounded repair and visual review; clear handling of
unavailable models, quota errors, missing keys; never silently fake AI output; clearly labelled
non-AI sample/demo mode; minimal logging of prompts/images/plans; no paid services without
authorisation. Mocks fine for CI, not live verification. Without key: finish implementation, report
live integration blocked.

## 11. Token and session efficiency

Development: concise progress, targeted reads, focused edits, reuse, no needless reinstalls,
focused checks during dev, full verification before release, screenshots at checkpoints, resume
from checkpoints, no parallel agents.

Application AI: send needed context only; structured scene summaries and targeted edits; preserve
geometry/constraints/locks; bounded history with summaries; cache reusable analysis with correct
invalidation; task-appropriate output limits; bounded repair; explicit visual critique; no silent
downgrade. Never save usage by skipping requirements, weakening tests, faking functionality, or
degrading UI. Record genuine tradeoffs.

## 12. Verification requirements

Automated checks: geometry, scale, units, coordinate conversion; invalid/self-intersecting
boundaries; containment, collisions, openings, clearances; counts and dimension limits; invalid AI
JSON and invalid scene geometry; property locks and unrelated-property preservation; stale AI
responses; undo/redo and persistence; ownership; upload validation; export/import round-trips;
missing keys, timeouts, quota errors, exhausted repair.

Browser workflows: 1) create project, import sample plan; 2) calibrate, trace/correct; 3) configure
furniture and brief; 4) generate or load labelled sample proposals; 5) explore and edit 3D; 6) lock
object, verify edits preserve it; 7) save, reload, export; 8) record feedback.

With API key: live generation and live conversational editing on synthetic sample; record model,
date, results, checks. No paid calls in every CI run.

Run lint, type checks, backend/frontend tests, production build, fresh-clone setup verification.
Inspect real screenshots; capture authentic README screenshots. Report incomplete checks
accurately. Never weaken assertions.

## 13. Git identity, attribution, publishing

Owner authorises (after plan approval) creating the public repo, commits, and pushing validated
work. Repo-local identity `Rahul Tom Mammen <rahul.tom.mammen@gmail.com>`; global unchanged. No
Claude collaborator invite, co-author trailer, generated byline, or session link. Configure
project-scoped empty commit/PR attribution; record in `CLAUDE.md`. Inspect author, committer, full
messages before pushing. Current timestamps; no forged history; preserve third-party credits.

Verify auth as RahulMammen; recheck name before creation; never overwrite or force-push; use suffix
if occupied. Push milestones and release; verify remote URLs and hashes; check Actions and fix
meaningful failures. Keep credentials, private plans, envs, caches, private data out of Git.

## 14. Documentation and final handoff

README (exact Windows setup/launch); architecture and scene-schema docs; AI generation, validation,
repair, editing design; geometry assumptions and limitations; asset provenance and licences;
architect testing guide with tasks; five-minute interviewer demo; interview explanations of major
decisions; known limitations and native-phone-app roadmap; `HANDOFF.md` with validation evidence.
No claims of production readiness, expert accuracy, photorealism, or user satisfaction without
evidence.

Final report: repo URL and pushed commit; working features; live AI vs mocked/sample checks; test,
build, CI results; launch commands; architect tester instructions; limitations; deployment/account
requirements.
