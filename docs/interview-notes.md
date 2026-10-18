# Interview notes: major technical decisions

**Why structured scene data instead of AI images?** An image cannot be edited, measured or validated. A typed scene (positions, sizes, materials, locks) can be checked geometrically, diffed, versioned and rendered consistently. The model's job shrinks to proposing parameters inside a schema.

**Why validate after structured output?** Provider structured output only guarantees syntax. Pydantic checks types and ranges independently. `validate_scene` then checks what schemas cannot: containment, collisions, door swings, counts, size ranges and connectivity.

**Why bounded, batched repair?** Unbounded loops burn quota and can oscillate. Two rounds, batched into one call each, is predictable in cost. Whatever still fails is shown as failing, never quietly passed.

**How do locks survive AI edits?** On two levels. Operations that touch a locked property are rejected one by one, and the rejections are reported. Whole-scene AI proposals have locked properties restored from the base scene. Full saves cannot change a property that is locked both before and after. The UI disables locked inputs and dragging.

**How do you stop a slow AI reply overwriting newer edits?** Optimistic concurrency. Each alternative has a revision counter. Requests and proposals carry the `base_revision` they were computed from. A mismatch gets HTTP 409 and the proposal is marked stale.

**How do you know the rendered furniture matches the validated footprint?** The footprint formula exists in Python and in TypeScript, and both are pinned by a shared fixture file that includes non-right-angle rotations and both polygon winding orders. Procedural models are built inside their declared box, and a browser test measures the actual Three.js meshes against that box.

**Why a connectivity test rather than minimum gaps?** Two pieces 1 m apart can still sit behind a 0.6 m bottleneck. Minkowski-style erosion and dilation with Shapely gives an exact (vector) free-space region for a walker of a given width. Graph connectivity on that region answers "can I get there".

**Why SQLite, a single process and same-origin serving?** This is a local pilot with a handful of testers. SQLite with WAL plus Alembic migrations keeps setup to one command. Same-origin serving removes CORS and the "tester's browser calls its own localhost" class of bugs, and keeps cookies first-party.

**Why sessions plus CSRF instead of JWT?** Server-side sessions can be revoked and keep tokens out of JavaScript (HttpOnly cookie). The double-submit CSRF token and Origin check close the cross-site gap that cookies open.

**Why Gemini?** At planning time it was the available multimodal option with a free tier, image input and JSON-schema output. It sits behind a small interface, and the test double proves the seam works. The trade-off is that free-tier content may be used for training, which is why only synthetic plans are used.

**What would you change for production?** HTTPS behind a reverse proxy with secure cookies, Postgres, background jobs for AI calls, rate limiting per user, object storage for plans, audit logs, a paid AI tier with data-use protections, and proper accessibility and usability studies.
