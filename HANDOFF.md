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
| `pytest` | **95 passed**. AI paths use provider test doubles. |
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

## Live AI verification (gemini-3.8-flash, Gemini free tier)
The key is configured in `backend/.env`. All live runs used synthetic sample projects. Paid billing was never enabled.

**Overall status: INCOMPLETE.** Not every required live check has passed. The free-tier quota limits this project to **20 generate requests per day for this model** (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`, from the sanitized 429 details). On 2026-10-18 the quota was used up by the first, unbounded live runs. The provider reported a retry delay of 61,899 s, about 17 h, measured at 06:43 UTC.

### Results recorded on 2026-10-18 (first live session)
| Check | Result |
|---|---|
| Smoke, first attempt | **Failed and fixed.** The reply was truncated (`{"x": 2.0`) because thinking tokens count toward the output limit. Truncation is now detected, and the thinking level is set per task. |
| Smoke, second attempt | Valid JSON in 16.3 s, 471 tokens. **Wrong orientation**: rotation 0 for "facing north", where 180 is correct. That prompt did not explain the convention. The smoke test now explains it and fails on a wrong position or orientation (unit-tested); this stricter version has not run live yet. |
| Generation, warm living room, 3 proposals (old rule: one 0.9 m width) | 3 calls (1 generation and 2 batched repairs), 134 s, about 21.5k tokens. Each proposal had 7 objects, no conversion errors, and stayed inside the room with no collisions. All 3 stayed invalid on one check, furniture reachability, and were labelled "Needs attention". This led to the circulation change below. |
| Locked sofa, "Move the sofa 50 cm towards the window" | **Pass.** No move operation; the conflict "position is locked" was reported; the sofa was identical in the proposal. |
| Locked sofa, "Try another arrangement using the same required inventory" | **Pass for locks.** Intent was rearrange, 72 s. Other furniture moved; the sofa's position, rotation, size and locks were unchanged. The layout still failed the old reachability rule. |
| Combined revision, "Make the lighting warmer", outline extraction | Not run successfully. They failed instantly with `RuntimeError: Event loop is closed`, an SDK client lifecycle bug that is now fixed. |
| Quota handling | **Verified live.** Once the quota was used up, the Interactions endpoint hung until timeout. The adapter now uses `generate_content`: a 429 comes back immediately, and the app reports, for example, "The AI provider's daily free-tier request limit (20) is used up. Try again in about 17 h 0 min." Per-minute limits get a separate message (unit-tested). |
| Bounded verifier, 2026-10-18 06:56 UTC | `scripts/live_ai_check.py --reset` exited **3 (INCOMPLETE)**. Smoke was INCOMPLETE on the daily quota; 1 of 8 budget units was used; the remaining checks were not started. |

### Still required (all INCOMPLETE)
| Required check | Status |
|---|---|
| Smoke with orientation check | INCOMPLETE (quota) |
| Generation under the revised circulation rules (0.9 m between doors, 0.6 m access) | INCOMPLETE (quota) |
| Combined revision with the sofa locked: floor becomes pale oak; accent lights on; chairs lighter; no furniture moved; sofa unchanged; no new errors; applies cleanly | INCOMPLETE (quota) |
| "Make the lighting warmer": lighting warmer, no furniture or finish changes | INCOMPLETE (quota) |
| Outline extraction on the study sample: room within 0.2 m of the drawn outline, at least one opening, nothing applied automatically | INCOMPLETE (quota) |
| Browser visual review of a real canvas screenshot: summary, grounded observations, no URLs or prices | INCOMPLETE (quota) |

### How to finish (one sequential run, at most 8 attempts in total)
After the daily quota resets:
```powershell
cd backend
.venv\Scripts\python scripts\live_ai_check.py --reset
cd ..\frontend
$env:LIVE_AI = "1"; $env:AI_CALL_BUDGET = "8"; $env:AI_BUDGET_FILE = "$PWD\..\backend\data\live-run\ai-budget.json"
npx playwright test live-review
```
- **Budget.** Every outbound attempt, including repairs and retries, takes one unit from `backend/data/live-run/ai-budget.json` before it is sent. The SDK's own HTTP retries are disabled, so they cannot bypass the count.
- **Split.** The script may use at most 7 attempts; the browser review uses the 8th. The run uses one repair round to stay inside the budget.
- **Results.** They go to `backend/data/live-run/results.json` and `review.json`, which Git ignores. A rerun without `--reset` reuses checks that already passed.
- **Exit codes.** The script exits 0 only if every check passes, 1 if any check fails, and 3 if any check is incomplete.

### Fixes made because of the live runs
- The SDK client is bound to the running event loop.
- Thinking level is set per task, and truncated replies are detected.
- Errors are classified precisely with a key-free excerpt. Quota errors now distinguish daily from per-minute limits, using Google's QuotaFailure and RetryInfo details.
- Proposals are kept when a repair call fails or times out.
- The adapter uses `generate_content`, so quota errors appear immediately.
- Repair prompts include per-check hints.
- An optional shared call budget (`AI_CALL_BUDGET`, `AI_BUDGET_FILE`) is available for verification runs.
- **Circulation (accepted by the owner as a configurable concept-design heuristic).**
  - The main walkway between doors defaults to 0.9 m. A furniture access path defaults to 0.6 m and can never be wider than the walkway.
  - A seat can be reached beside its front edge.
  - Both values are visible and editable in Furnish → Circulation.
  - Saved project values are never rewritten. A project saved before this change reads the 0.6 m default without storing it, which is covered by a test.
  - The UI and docs state that these are not accessibility or building-code checks.
  - Regression tests show:
    - side approach to a seat passes;
    - an enclosed seat, and a seat facing a wall, still fail;
    - a door-to-door route narrower than the configured main width fails, and passes only when the width is reduced.

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
- Live AI checks listed above as INCOMPLETE (daily free-tier quota).
- A test session with a real architect. The guide is ready: `docs/testing-guide.md`.
- Hosted deployment. It needs an account, HTTPS and your approval: `docs/deployment.md`.
- No licence file has been added. Choosing a licence for the public repository is your decision.
