# Manual test (about 20 minutes)

Use synthetic samples only. Open http://127.0.0.1:8000 and sign in, or create an account.
AI buttons send requests to Gemini. The free-tier daily quota may be used up; step 8 checks that this is handled safely. Skip the AI buttons if you want zero AI requests.

**Plan file:** `frontend/e2e/fixtures/synthetic-plan.png`. A PDF version, `synthetic-plan.pdf`, is in the same folder.

1. **Create and save a project**
   1. Projects → **New project** → name it "Manual test flat" → **Create project**.
   2. Click the back arrow (top left). The project card appears with "Plan not confirmed".
   3. Open the project again.
2. **Upload, calibrate and trace the plan**
   1. Drag `synthetic-plan.png` onto **Import floor plan**. To test PDF import instead, choose the PDF and pick page 1.
   2. Click **Calibrate** (ruler icon). Click both ends of the "5000" dimension line at the top, then enter `5000` mm. The panel should show *1 px = 10.0 mm* (± a little, depending on your clicks).
   3. With the pen tool, click the four inside corners of the room, then click the first corner again. The labels should read about 5.00 m and 4.00 m, and the room about 20.0 m².
   4. Drag one corner and watch it snap. Press `Ctrl+Z` only in the Design step, not here; fix the corner with the corner table instead.
   5. Use the door tool on the top wall near the existing door arc, and the window tool on the bottom wall.
   6. Click **Confirm geometry** → **Confirm**.
3. **Furniture and sample layouts**
   1. Add Sofa, Armchair, Table and Bookshelf. Raise the armchair count to 2. Open an item and set a width range.
   2. Check **Circulation**: the main walkway is 0.90 m and the access path 0.60 m. Change one value and note **Reset to defaults**.
   3. Click **Continue to design** → **Sample layout (not AI)**. The card shows "Sample · not AI".
4. **Views**
   1. Switch between **Plan** (`1`), **Orbit** (`2`) and **Walk** (`3`).
   2. In Walk, use W/A/S/D or the on-screen pad, and drag to look around.
   3. In Orbit, try **Viewpoint** and **Wall visibility**. Press `F` to reset the camera and `?` to see the shortcuts.
5. **Edit**
   1. Pick Sofa from the Furniture list, or click it in 3D.
   2. Drag it near a wall and watch it snap. Use Shift for free movement.
   3. Rotate with `R` or the 15° buttons. Type a new width; values outside the allowed range are clamped.
   4. Choose **Velvet** and a colour.
   5. Deselect with `Esc`, then set the lighting to **Evening** and turn on **Warm accent lighting**. Then pick a floor finish.
   6. The top bar should return to "All changes saved".
6. **Locks, history and comparison**
   1. Select the sofa → **Lock all**. Its inputs become disabled, and dragging no longer moves it.
   2. Click Undo, then Redo, in the top bar.
   3. Open **History**, name a revision, and click **Compare** on an older revision.
   4. Use the alternative's **…** menu → **Duplicate**, then **Compare with current**.
7. **Exports, reload and feedback**
   1. Click **PNG** in the view toolbar, and **Export project JSON** (download icon, top bar).
   2. Open **Summary** (bottom of the right panel) → **Schedule CSV**.
   3. Reload the page. The sofa's position, rotation, size, material and locks, and the lighting, should all be unchanged.
   4. Click the speech-bubble icon → record feedback with a rating → **Save feedback**.
   5. Projects → **Feedback CSV** includes your entry.
8. **AI quota safety** (optional; sends at most one request when the quota is available)
   - Click **Generate 3 proposals**. If the quota is used up, you see "daily free-tier request limit … is used up".
   - Your existing alternative and furniture stay unchanged, and you can still edit manually.

Automated equivalent (no Gemini requests; the quota error is simulated):
```bash
cd frontend && set MOCK_AI_FAIL=quota && npx playwright test manual-areas
```

## Still needs a person
- Judging visual quality, camera comfort, touch use on a real phone or tablet, and whether the checks and labels make sense to an architect.
- Clicking calibration points on your own plans. The automated pass uses known pixel positions.
- Live AI quality. Live verification remains INCOMPLETE until the quota resets; see `HANDOFF.md`.
