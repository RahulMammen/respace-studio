# Handoff: validation evidence

Date: 2026-10-18 · Repository: https://github.com/RahulMammen/respace-studio (public, branch `main`)

## Environment used
Windows 11, Python 3.12.10, Node 22.19.0, npm 10.9.3, Git 2.55, gh 2.102. CI runs on GitHub Actions (ubuntu-latest, Python 3.12, Node 22).
Tested library versions: FastAPI 0.143.3, Pydantic 2.14.1, SQLAlchemy 2.1.5, Alembic 1.20.0, Shapely 2.2.0, Pillow 13.0.0, google-genai 2.31.0, React 19.3.1, Vite 8.3.4, three 0.186.1, @react-three/fiber 9.8.2, @react-three/drei 10.7.9, TypeScript 6.0.3, Vitest 5.0.5, Playwright 1.64.1.

## Automated checks (local, 2026-10-18)
| Check | Result |
|---|---|
| `ruff check`, `ruff format --check` (backend) | clean |
| `mypy app` | no issues in 33 files |
| `pytest` | **87 passed**. AI paths use provider test doubles. |
| `eslint .`, `tsc -b` (frontend) | clean |
| `vitest run` | **12 passed**: shared geometry fixtures, rendered-box transform, overlap and self-intersection, undo/redo save queue, stale detection, API client CSRF and errors |
| `vite build` | OK |
| Playwright `workflow.spec.ts` | **10 passed** against the production build with the AI test double |
| Fresh clone + `scripts/setup.ps1` + `pytest` | setup exit 0, tests exit 0, `frontend/dist` built, `backend/.env` created with a generated secret |
| GitHub Actions | `5d561ac`: backend, frontend and e2e jobs **success**. Commits after it are recorded in `PROGRESS.md`. |

What the backend tests cover:
- geometry and units: calibration, round trips, the Three.js rotation sign;
- invalid geometry: self-intersecting, tiny and overlapping rooms; openings outside or overlapping a wall;
- containment with rotation, collisions, rug and lamp semantics, door swing and clear zones, window obstruction, wall art, dining chairs tucked under tables;
- counts and size ranges, unknown models and materials;
- walkway connectivity: bottleneck, second door, blocked entrance, no door, perimeter access;
- rule-based layouts are valid;
- auth, CSRF, cross-origin and LAN origin handling, login rate limit;
- ownership across 16 endpoints, upload validation, geometry confirmation flow;
- revisions, undo/redo, stale writes, locks on save and on operations, compare and schedule, export/import round trip, bad imports, feedback, samples;
- missing key, quota, timeout, auth and model errors; invalid JSON; repair success and exhaustion; prompt fencing;
- conversational edits: keep everything except flooring, move only one object with a locked sofa, warmer lighting, stale proposal, stale request refused, a patch that adds errors is refused, geometry request, another arrangement with locks restored, bounded history;
- review grounding, outline extraction as draft only, extraction cache.

The browser workflows cover: register; create a project; import a PDF page; calibrate (1 px = 10.0 mm); trace (20.0 m²); add a door; confirm; set furniture and brief; generate three proposals (test double, labelled); check that rendered meshes stay inside validated footprints; edit manually; lock; undo/redo; make a chat edit where the locked sofa is preserved; reload persistence; PNG and JSON export; feedback; history, compare and presentation; summary and schedule CSV.

## Live AI verification (gemini-3.8-flash, free tier, 2026-10-18)
The key is configured. All runs used synthetic sample projects in a throwaway data directory, with bounded calls (`backend/scripts/live_ai_check.py`). Paid billing was never enabled.

| Check | Result |
|---|---|
| Smoke (`python -m app.ai.smoke`) | **Passed.** Valid structured JSON in 16.3 s; 70 input, 59 output and 342 thinking tokens. The placement was inside the room, but the rotation was 0 for "facing north", which is wrong under our convention. The smoke prompt does not explain the convention; the generation prompts do. |
| First smoke attempt | **Failed and fixed.** The reply was truncated (`{"x": 2.0`) because thinking tokens count toward `max_output_tokens`. Truncation is now detected and the thinking level is set per task. |
| Live generation, warm living room, 3 proposals | **Ran:** 3 calls (1 generation and 2 batched repairs), 134 s, about 21.5k tokens. Each proposal had 7 objects with no conversion errors and stayed inside the room without collisions. **All 3 stayed invalid after 2 repairs, on one check only: furniture reachability.** Proposal status was reported honestly as "Needs attention". |
| Locked sofa, asked "Move the sofa 50 cm towards the window" | **Passed.** The model replied that the position is locked, returned no move operation, and listed a conflict. The sofa's position, rotation, size and locks were identical in the proposal. |
| Locked sofa, "Try another arrangement using the same required inventory" | **Passed for locks.** Intent was rearrange; 72 s; the chairs, lamp and bookshelf moved. The sofa's position, rotation, size and locks were preserved. The result still failed the old reachability rule. |
| Spec revision request (lighter chairs, pale oak floor, warm accents, sofa locked) and "Make the lighting warmer" | **Not verified.** Both calls failed instantly with `RuntimeError: Event loop is closed` (the SDK client was reused across event loops). This is fixed, but the requests have not been re-run live. |
| Outline extraction (study sample) | **Not verified.** It failed with the same event-loop bug; after the fix, the quota was exhausted before a re-run. |
| Visual review with a real canvas screenshot | **Not verified** (quota). A manual spec is ready: `LIVE_AI=1 npx playwright test live-review`. |
| Quota handling | **Verified live.** After about 20 calls, the free-tier quota was exhausted. The Interactions endpoint hung until timeout (users would see "took too long"). The adapter now uses `generate_content`, which returns HTTP 429 at once, and the app reports "rate limit or free-tier quota was reached". |

Fixes made because of the live runs (all tested; 87 backend tests):
- the client is bound to the current event loop;
- thinking level is set per task, and truncation is detected;
- provider errors are classified precisely, with a key-free excerpt;
- generated proposals are kept when a repair call fails or times out;
- the adapter uses `generate_content` so quota errors appear promptly;
- repair prompts include per-check hints;
- walkway rule: the main walkway width (0.9 m) applies between doors, and a separate furniture access width (0.6 m, configurable) applies to reaching furniture. Seats can be approached beside their front edge. The rule and its rationale are in `docs/geometry.md`.

**Outstanding:**
- live generation re-run under the new access rule;
- the spec revision request and the lighting edit;
- outline extraction;
- visual review.

These need the free-tier quota to reset (daily limits reset at midnight Pacific time). Run:
```powershell
cd backend; .venv\Scripts\python scripts\live_ai_check.py
cd ..rontend; $env:LIVE_AI=1; npx playwright test live-review
```

## LAN verification (2026-10-18)
`python -m app.serve --lan --port 8010`, accessed from `http://192.168.68.106:8010`:
- same-origin sign-in worked; a cross-origin POST returned 403;
- every browser request went to the LAN origin (checked in the network log); none went to localhost;
- no firewall setting was changed.
This check used the same machine's LAN address. A second physical device has not been tested.

## Visual review
Screenshots in `docs/screenshots/` were taken from the running app with Playwright at 1440×900 and 390×844. Issues found and fixed during review:
- the canvas height collapsed;
- the plan camera was rotated;
- overlays were hidden under furniture in plan view;
- the chat panel covered the Apply button;
- the mobile header overlapped;
- icon buttons had no accessible names;
- the PDF chunk loaded eagerly;
- a draft autosave could undo a geometry confirmation.

## Git attribution
- Repository-local identity: `Rahul Tom Mammen <rahul.tom.mammen@gmail.com>`. The global Git identity was not changed.
- `.claude/settings.json`: `attribution.commit = ""`, `attribution.pr = ""`, `attribution.sessionUrl = false`, `includeCoAuthoredBy = false`.
- Before each push, author, committer and the full message of each commit were inspected. None contains a Co-Authored-By trailer, generated byline or session link.

## Not done or not verified
- Live AI checks (blocked on the key).
- A test session with a real architect. The guide is ready: `docs/testing-guide.md`.
- Hosted deployment. It needs an account, HTTPS and your approval: `docs/deployment.md`.
- No licence file has been added. Choosing a licence for the public repository is your decision.
