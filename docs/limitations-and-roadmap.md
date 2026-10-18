# Known limitations and roadmap

## Limitations (current release)
- **Concept design only.** There are no building-code, accessibility, structural, fire or engineering-grade lighting checks. The checks are geometric aids.
- **Furniture is approximate.** Procedural envelopes, not product models, with eleven categories and a few variants each. Round and L-shaped items collide as their bounding rectangles.
- **Geometry**: simple polygonal rooms on one floor. No curved walls, columns, level changes, multi-storey plans or CAD/BIM import. Openings are rectangular. For multi-room plans, a connecting door must be added to each room it joins.
- **Walkway check**: two-dimensional, rectangular footprints, space under tables counts as blocked, rooms checked one at a time (see `docs/geometry.md`).
- **AI**: quality varies by model and brief. Free-tier rate limits apply. Proposals that still fail after two repair rounds are shown as failing. Outline tracing is a draft and is often imperfect on busy drawings. AI design quality has not been measured.
- **Lighting** is an indicative mood (colour temperature, intensity, lamp glow), not a photometric simulation. The renders are not photorealistic.
- **Walkthrough** keeps you inside room polygons but does not use the door positions to block or allow passage between adjacent rooms.
- **Undo/redo** history lives in the browser session. Saved revisions persist, but the undo stack resets on reload.
- **LAN mode** is plain HTTP and intended only for short sessions on a trusted network.
- **Single process with SQLite.** Suitable for a small pilot, not for many concurrent users.
- No user satisfaction or design accuracy claims: no structured user study has been run yet.

## Roadmap
1. Pilot feedback analysis and usability fixes.
2. Object library expansion (kitchen and bath fixtures, plants, wall decor), with licensed low-poly assets recorded in `ASSETS.md`.
3. Multi-room walkway connectivity across shared doors, and door-aware walkthrough.
4. DXF import of simple wall layers, with confirmation.
5. Background job queue for AI requests with progress streaming.
6. Hosted pilot with HTTPS, Postgres and a paid AI tier (needs approval, see `docs/deployment.md`).

## Native phone app (future)
- **Phase 1**: keep the responsive web app as the phone client. It already supports touch orbit, pinch, the walk pad and a stacked layout.
- **Phase 2**: an Expo / React Native app reusing the TypeScript scene schema, the geometry module (`shapes.ts`, pinned by the shared fixtures) and the API client. Rendering through `@react-three/fiber/native`, plus offline viewing of saved revisions.
- **Phase 3**: AR placement (ARKit/ARCore) using the validated scene to place furniture in the real room, with the measured plan as the anchor.
- The backend API and ownership model stay unchanged; mobile adds a token-based session in place of cookies.
