# AI generation, validation, repair and editing

## Provider
- **Google Gemini API** through the official `google-genai` SDK (`models.generate_content` with `response_json_schema`). The default model is `gemini-3.8-flash`, which was stable, on the free tier, accepted image input and supported JSON-schema output on 2026-10-18. Set `GEMINI_MODEL` to change it. ReSpace never downgrades the model or switches provider on its own.
- `app/ai/provider.py` defines `DesignModelProvider.generate_structured(StructuredRequest) -> StructuredResponse`. Adding another provider means writing one adapter.
- `app/ai/mock.py` is a deterministic **test double** used only when `AI_PROVIDER=mock` (CI and Playwright). The API and UI label it "Test double". It does not count as live AI verification.
- Errors are mapped to product messages: not configured (503), key or permission (`ai_auth`), unavailable model, quota or rate limit (429), timeout (504), invalid output, blocked. Only timeouts and 5xx are retried (at most `AI_MAX_RETRIES`, default 2, with backoff). Quota errors are not retried, because retrying would spend the remaining free-tier allowance.
- Every call has a timeout (`AI_TIMEOUT_SECONDS`, default 90). If the browser cancels or disconnects, the server cancels the in-flight task.

## What is sent to Google
| Task | Content sent |
|---|---|
| Generate | Confirmed room polygons and openings (metres), the furniture requirements, the relevant catalogue subset, the brief text and priorities, up to 3 selected reference images (downscaled to 1024 px), and the current scene when rearranging |
| Chat edit | Compact scene summary with locks, rooms, inventory, selected ids, the request, the last 6 messages and a bounded summary of older requests |
| Outline suggestion | The plan image (downscaled to 1600 px JPEG) and task instructions; no account data |
| Review | A PNG of the current 3D view (downscaled to 1280 px), the scene summary, validation findings and the brief |

ReSpace does not send emails, names, project names or file names. Prompts and images are not logged; logs record only the task label and the error code. **Free tier:** Google's terms say unpaid-service content may be used to improve its products and may be read by human reviewers, and ask users not to submit sensitive, confidential or personal information. Use synthetic or anonymised plans only.

## Generation pipeline
1. Requires confirmed geometry and a non-empty inventory.
2. One structured call asks for `count` (≤ 3) clearly distinct proposals that follow the `AIProposalSet` schema. Before sending, the Pydantic schema is converted to inline JSON Schema (no `$ref`).
3. Each proposal is parsed independently with Pydantic, then converted to `Scene`. Ids are sanitised and de-duplicated, and invalid colours fall back to catalogue colours. Objects that cannot be parsed are reported as conversion errors; ReSpace does not guess them.
4. When rearranging an existing scene, locked properties are **restored from the base scene**, and each restoration is listed in the proposal notes.
5. Every proposal goes through `validate_scene`. Schema validity does not establish geometric validity.
6. **Bounded repair.** For up to `AI_MAX_REPAIR_ROUNDS` (default 2), all failing proposals are sent back in **one batched call**, with at most 12 issues each. A repaired proposal replaces the original only if it is not worse.
7. Proposals are stored as alternatives with their actual validation status. A proposal that still fails is labelled **Needs attention**, never "validated". The model's `conflicts` list is shown to the architect in a dialog, with guidance to change the brief, sizes or clearance.

## Conversational editing
1. The request is refused **before** any model call if the client's `base_revision` is stale.
2. One structured call returns an `AIEditPlan` with `intent`:
   - `edit`: typed operations;
   - `rearrange`: a new arrangement of the same inventory, using the generation pipeline with locks restored;
   - `geometry_change`: walls cannot be edited from chat, so the reply points to the Plan step and re-confirmation;
   - `question`: a reply only.
3. Operations are `move`, `rotate`, `resize`, `set_finish`, `set_lighting`, `set_room_finish`, `add` and `remove`. They are applied by `edits.apply_operations`. An operation on a locked property, a missing object or an invalid value is **rejected and reported**, never partly applied. Everything else is preserved exactly; `diff_scenes` proves which properties changed.
4. The whole resulting scene is validated. If the operations introduce **new** errors, there are up to 2 bounded repair rounds.
5. The result becomes a pending `ChangeProposal`. The UI previews it with a before/after toggle, a ghost of the original, dashed accent outlines on affected objects, a list of rejected operations and conflicts, and Apply/Discard.
6. On Apply, the server re-checks the revision (stale returns 409 and marks the proposal stale) and refuses any patch that adds new validation errors.

These requests are covered by automated tests with the test double: keep everything except flooring, move only one object, keep a locked sofa, warmer lighting, another arrangement with the same inventory, a stale proposal after a manual edit, a refused stale request, a patch that adds errors, a geometry request, and bounded history.

## Plan outline suggestion
The model returns rooms and openings in **image pixels**, with confidence values and a list of uncertain features. ReSpace converts them using the **architect's calibration** only. Dimension text the model read from the drawing is shown verbatim for comparison and is never applied as a dimension. Openings are snapped to the nearest wall within 0.4 m. The result is a dashed draft overlay that the architect can use as a draft or discard; nothing is confirmed automatically. Results are cached per (plan, calibration, model), up to 32 entries, so changing any of these invalidates the cache.

## Visual review
This is an explicit user action ("Review"), one bounded call. The screenshot must be a real PNG captured from the canvas. Observations that cite only objects which do not exist are dropped and counted as ungrounded. Suggestions name categories, sizes, finishes and colours, never products, brands, URLs or prices, and are shown as optional additions. Any suggested operations become a normal pending proposal.

## Token and cost controls
- Context is compact JSON with millimetre rounding, and the catalogue is filtered to relevant categories.
- Repair batches all failing proposals into one call. Output limits are set per task (generate 16k tokens, edit 4k, review 4k, extract 6k).
- History keeps the last 30 messages. Older user requests are folded into a summary of at most 1,200 characters, of which at most 600 are sent.
- Reviews never run automatically. Outline extraction is cached.
- CI never makes live calls.

## Live verification
`python -m app.ai.smoke` sends one small synthetic structured-output request. Results are recorded in `HANDOFF.md`.
