# Geometry, units and validation

## Units and coordinate conventions
| Space | Units | Origin | Axes |
|---|---|---|---|
| Plan image | pixels | top-left pixel | `u` to the right, `v` downward |
| World (backend and scene JSON) | metres | the plan image's top-left pixel | `x` to the right, `y` down the plan |
| Three.js | metres | same as world | `x = world x`, `z = world y`, `y` up |

- **Calibration.** The architect marks two points `a`, `b` on the plan and enters their real length. `metres_per_pixel = length / |b − a|`, and `world = pixel × metres_per_pixel`. The scale is uniform and the axes are shared, so the image and the traced geometry stay aligned. If the plan is recalibrated, traced rooms are rescaled by `new_scale / old_scale` about the origin.
- **Rotation.** `rotation_deg` turns about the vertical axis, positive clockwise when seen from above (y points down the screen). Unrotated, an object's width runs along +x, its depth along +y, and its front faces +y. In Three.js the same rotation is `rotation.y = −rotation_deg × π/180`.
- **Room polygons** trace the interior finished face of the walls. Walls are drawn outside the polygon, `wall_thickness_m` thick.
- **Openings** sit on wall edge `i`, which runs from vertex `i` to vertex `i+1`. `offset_m` is the distance along the edge from vertex `i` to the opening's centre. The inward normal of an edge comes from the polygon's winding: `(−uy, ux)` when the shoelace area is positive, `(uy, −ux)` otherwise. Tests cover both winding orders.

`backend/app/geometry/shapes.py` and `frontend/src/geometry/shapes.ts` implement the same formulas. `shared/geometry_fixtures.json` holds expected numbers for rotated footprints, openings on clockwise and anticlockwise rooms, door swings, calibration and Three.js mapping. pytest regenerates and checks the file, and Vitest checks the frontend against it. A Playwright test also reads every rendered furniture group (`?debug=geometry`) and asserts that its meshes stay inside the validated footprint box, within 21 mm.

## Building geometry checks (before confirmation)
- At least one room; unique ids.
- Polygon: no duplicate corners, not self-intersecting (`shapely.is_valid`), area ≥ 1 m², at most 60 m across, every wall ≥ 0.2 m.
- Wall height 2.0–6.0 m.
- Openings: the wall exists; the opening fits within its wall; height (plus sill) ≤ wall height; no overlapping openings on the same wall. A raised door sill gives a warning. A door swing that hits another wall gives a warning.
- Rooms on one floor must not overlap. Shared walls are allowed.
- Geometry becomes authoritative only when the architect confirms it. Any later edit returns it to draft. AI tracing only ever proposes a draft.

## Scene checks
| Check | Rule |
|---|---|
| Supported references | The category, variant and material are in the catalogue. Room and requirement ids exist. The requirement category matches the object. |
| Dimensions | Within the catalogue's min/max for the category, and within the brief's size range when one is given. |
| Counts | Each required item appears exactly `count` times. Optional items may appear up to `count` times. Existing pieces stay marked existing. Room assignment is respected. |
| Containment | Footprint inside the room polygon, with 5 mm tolerance. Wall-mounted items must sit flush (within 6 cm) and parallel to a wall face, facing into the room. Items must fit under the ceiling. |
| Collisions | Floor items may not overlap by more than 1 cm². Rugs are overlays and never collide. Table lamps sit on a table, desk or shelf (otherwise a warning). Pendants hang from the ceiling. Wall art has no floor footprint. Dining chairs may tuck up to 0.22 m under a table or desk. |
| Openings | No floor item inside an inward door's swing sector or inside the clear zone in front of a door or passage (depth = max(0.6 m, main walkway width)). A door narrower than the clearance gives a warning. Items taller than the sill within 0.3 m of a window give a warning. Wall art may not cover an opening. |
| Walkway | The connectivity test described below. |

Overall status is `invalid` if there is any error, `warnings` if there are only warnings, and `valid` otherwise.

## Walkway connectivity check (approximate)
A gap between each pair of objects does not prove that a person can walk through the room. ReSpace tests whether there is a connected route instead. It uses two configurable widths, both set in the Furnish step:

| Width | Default | Purpose |
|---|---|---|
| Main walkway `c` | 0.9 m (0.6–1.5) | Routes between doors |
| Access path `a` | 0.6 m (0.45–1.2, never wider than `c`) | Reaching each piece of furniture from the entrance, for example stepping in beside a seat |

1. Model each walker as a disc. For a width `w`, `r = w/2`. Compute the walker-centre free space with Shapely: the room polygon eroded by `r`, minus the union of floor-blocking footprints dilated by `r`. Rugs, wall items, table lamps and pendants do not block.
2. **Doors.** Using the main walkway, find the connected piece that contains the main entrance's entry point (the door centre moved `r + 2 cm` into the room). If no door is marked as the entrance, the first door is used. Every other door's entry point must lie in that same piece.
3. **Furniture.** Using the access path, every item with an access side must be reachable. Its access zone must overlap the entrance's piece by at least 0.01 m². The zones are:
   - front of seats, desks and storage;
   - behind dining chairs;
   - a ring around tables and beds.

   Front and back zones extend sideways by `r`, so a seat facing a coffee table can be reached from beside its front edge. Zone depth is the item's access depth plus `r`.

The defaults were chosen after the first live AI run (2026-10-18). With one 0.9 m width used for everything, every proposal failed because armchairs grouped around a coffee table could only be approached from directly in front. Separating the main route from the furniture access path matches how architects distinguish primary circulation from access space.

**Resolution.** The computation is exact polygon geometry, not a raster grid. The only approximation is the arcs in the buffers: 16 segments per quarter circle, so the chord error is under 0.6 mm at r = 0.5 m.

**Limitations.**
- Furniture is modelled as rectangles; round tables and rugs use their bounding rectangle, which is conservative.
- Space under tables and desks counts as blocked.
- Door leaves are kept clear by the separate swing check; they are not obstacles to walking.
- The check is two-dimensional: it ignores headroom, steps and floor finishes.
- Rooms are checked one at a time, starting from that room's doors. For multi-room plans, add the connecting door to both rooms.
- It is a concept-design aid. It is not an accessibility or building-code assessment.

The plan view shows the reachable free space in green and unreachable pockets in red.

## Footprint semantics (shared by validator and renderer)
| Item | Footprint used |
|---|---|
| Most furniture | The rotated `w × d` rectangle centred on `position`. The procedural model stays inside this box. |
| Round rug | The rotated ellipse inscribed in `w × d` (both the validator and the renderer use the ellipse). |
| Corner sofa | The full bounding rectangle (conservative); the L-shaped model sits inside it. |
| Round tables | The bounding rectangle (conservative); the round top sits inside it. |
