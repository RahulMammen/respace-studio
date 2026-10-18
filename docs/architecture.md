# Architecture

```
Browser (React 19 + Vite 8 + React Three Fiber 9)
  │  relative /api URLs, session cookie + X-CSRF-Token
  ▼
FastAPI app (one origin: serves /api and the built frontend)
  ├─ routers/auth           accounts, sessions, CSRF bootstrap
  ├─ routers/projects       projects, geometry, inventory, brief, uploads
  ├─ routers/alternatives   scenes, typed ops, revisions, compare, schedule CSV
  ├─ routers/ai             generate, extract outline, chat edits, proposals, review
  ├─ routers/feedback       tester feedback linked to revisions, CSV export
  ├─ routers/transfer       versioned project JSON export/import
  ├─ geometry/              shapes (shared formulas) + validate (incl. walkway)
  ├─ edits.py               typed operations, lock enforcement, diffs
  ├─ layout.py              rule-based non-AI layouts (demo mode, test double)
  ├─ ai/                    provider interface, Gemini adapter, prompts, schemas
  └─ db.py + Alembic        SQLite (WAL), migrations from the first commit
        backend/data/       DB, uploaded plans (git-ignored)
```

## Key decisions
- **One origin.** In production FastAPI serves the built frontend, so the browser only talks to its own origin. Testers on the same network never call `localhost`. In development, Vite proxies `/api` to the backend.
- **The scene is the single source of truth.** The AI returns structured data. The server converts it to the authoritative `Scene` model, validates it, and stores it. The renderer draws only that data.
- **Ownership is enforced in one place.** Every route reaches a project through `deps.owned_project`, which filters by `owner_id`. Another user's project returns 404, so its existence is not revealed.
- **Revisions are optimistic.** Each alternative has a `revision` number. A write must carry the `base_revision` it was based on. A stale write, including a late AI result, gets HTTP 409 and never overwrites newer edits.
- **Proposals, not silent edits.** AI edits and review suggestions become `ChangeProposal`s that are previewed, highlighted, then applied or discarded. Applying re-checks the revision and re-validates the whole scene. A patch that adds new errors is refused.
- **Locks.** `locks` on an object is a subset of `position`, `rotation`, `size`, `material` and `presence`. AI operations that touch a locked property are rejected. Full AI proposals have their locked properties restored from the base scene, and each restoration is reported. A full-scene save may not change a property that is locked both before and after the save. The architect can still unlock explicitly.
- **Undo/redo** keeps a client-side stack of scene snapshots. Each undo or redo is saved as a new revision (`source: undo|redo`), so history is never rewritten.

## Data model
| Table | Purpose |
|---|---|
| `users` | email, display name, Argon2id password hash |
| `auth_sessions` | SHA-256 of the session token, CSRF token, expiry |
| `projects` | owner, name, `geometry`, `inventory`, `brief` (JSON), bounded conversation summary |
| `assets` | uploaded plan pages and reference images (generated storage names) |
| `alternatives` | named design alternatives: current scene, revision, validation status |
| `revisions` | every saved scene snapshot, with source, summary and optional label |
| `change_proposals` | AI or review proposals: base revision, ops, scene, report, status |
| `chat_messages` | conversation per project, linked to proposals |
| `feedback` | tester feedback linked to alternative and revision |

## Scene schema (`backend/app/scene.py`, `schema_version = 1`)
```jsonc
{
  "schema_version": 1,
  "objects": [{
    "id": "sofa",                 // stable id: [a-z0-9][a-z0-9_-]{0,47}
    "category": "sofa",           // sofa|armchair|table|dining_chair|desk|bed|wardrobe|bookshelf|rug|lamp|wall_art
    "variant": "three_seat",      // catalogue model reference
    "room_id": "living",
    "requirement_id": "sofa",     // null = optional addition, kept separate in the schedule
    "label": "",
    "position": {"x": 3.6, "y": 1.38},   // footprint centre, metres
    "rotation_deg": 0,
    "size": {"w": 2.2, "d": 0.92, "h": 0.8},
    "finish": {"material": "boucle", "color": "#ece6db"},
    "accent": null,
    "elevation_m": 0,             // wall art / pendants
    "locks": ["position"],
    "existing": false
  }],
  "finishes": [{"room_id": "living", "floor": {...}, "walls": {...}}],
  "lighting": {"mood": "evening", "color_temperature_k": 2700, "intensity": 1.0, "accent_lights": true},
  "rationale": "...", "tradeoffs": ["..."], "unresolved": ["..."]
}
```
`Geometry` holds `plan_asset_id`, `calibration` (`a`, `b` in pixels and `length_m`), `rooms[]` (polygon, wall height and thickness, openings) and `confirmed`. `Inventory` holds requirements (category, variant, count, required, existing, size range, finish, room) and `walkway_clearance_m`. The project export format is `{"format": "respace-project", "format_version": 1, ...}`. Import validates the whole document and creates a new project owned by the importer.

## Frontend structure
- `state/workspace.ts`: project, geometry, inventory, current alternative, undo/redo stacks, a debounced save queue with stale detection, and proposal preview.
- `workspace/PlanStep.tsx`: SVG plan editor (pan, zoom, pinch, calibrate, trace with snapping, openings, vertex editing, AI outline draft, confirm).
- `workspace/FurnishStep.tsx`: catalogue, inventory with size ranges and finishes, brief, priorities, clearance, reference images.
- `workspace/DesignStep.tsx`: alternatives, 3D canvas, properties and checks, chat, proposals, history, compare, presentation, review.
- `three/`: `SceneView` (cameras, controls, lighting, dragging with snapping, overlays), `Room` (floors, walls with real openings, door leaves, windows), `Furniture` (procedural models).

## Security summary
- Argon2id hashing (pwdlib). Server-side sessions in an HttpOnly, SameSite=Lax cookie. A double-submit CSRF token is required on every unsafe method. Unsafe cross-origin requests are rejected by an Origin/Referer check against the request's own Host plus configured origins.
- Sign-in limit: 10 failures per IP and email per 10 minutes. A dummy hash equalises timing for unknown emails.
- Uploads: only PNG/JPEG, verified by decoding; 15 MB and 40-megapixel limits; re-encoded, which strips EXIF metadata such as location; stored under generated names in `backend/data/uploads`.
- Security headers: `nosniff`, `X-Frame-Options: DENY`, a CSP for the app shell, and `no-store` on API responses.
- The model never executes anything: responses are parsed as data against a fixed schema. Plan text, brief and requests are fenced as untrusted content in prompts.
- Known gap: LAN mode uses plain HTTP, so cookies are not `Secure`. Use it only on a trusted private network. See `docs/deployment.md`.
