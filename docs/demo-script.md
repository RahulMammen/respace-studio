# Five-minute interviewer demonstration

**Setup.** Run `scripts/start.ps1`, sign in, and add the sample projects. With a Gemini key configured, generation and chat are live. Without one, use **Sample layout (not AI)** and say clearly that this is the non-AI mode.

| Time | Show | Say |
|---|---|---|
| 0:00 | Projects page | "ReSpace turns a measured plan and a furniture brief into editable 3D concept layouts. Everything the AI suggests is structured data that I validate and can edit." |
| 0:30 | **Study to trace**: calibrate on the 3600 line, trace two corners, open the corner table | "Scale comes only from my calibration. AI tracing is a dashed draft, and nothing becomes authoritative until I confirm it." |
| 1:15 | **Warm living room** → Furnish | "Counts, size ranges, existing pieces and the walkway clearance are explicit constraints, not prose." |
| 1:45 | Design: orbit view, select the sofa, drag it near a wall (it snaps), rotate with `R` | "The footprint I drag is exactly the footprint the validator checks. A Playwright test asserts that the meshes stay inside it." |
| 2:30 | Checks tab + walkway overlay in plan view (`1`) | "The walkway check is a real connectivity test: erode the room by half the clearance, subtract dilated furniture, and check that the entrance connects to every item's usable side. It has documented limits." |
| 3:15 | Lock the sofa → chat: "Keep everything except the flooring and move the sofa a little" | "Edits are typed operations. The locked move is rejected and reported. I preview the result, with affected items in dashed green, and then apply it." |
| 4:00 | History → Compare; Summary page | "Every save is a revision. A late AI response based on an old revision gets a 409 instead of overwriting my work." |
| 4:30 | Presentation mode, save PNG | "This PNG is the actual rendered scene, not a generated image that might disagree with the model. The checks are concept-level aids, not code compliance." |
