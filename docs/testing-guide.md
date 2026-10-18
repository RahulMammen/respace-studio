# Architect testing guide

Use this guide for a 30–45 minute session with an architect or interior designer. Use only the synthetic sample plans or anonymised plans. With the free Gemini tier, uploaded content may be used by Google and read by human reviewers.

## Before the session (host)
1. Run setup once: `powershell -ExecutionPolicy Bypass -File scripts/setup.ps1`.
2. Optional: add `GEMINI_API_KEY` to `backend/.env`. Without it, AI buttons are disabled; manual editing and the rule-based sample layouts still work.
3. Start the app:
   - Tester on the same computer: `powershell -ExecutionPolicy Bypass -File scripts/start.ps1`, then open http://127.0.0.1:8000.
   - Tester on another device on the **same private network**: `powershell -ExecutionPolicy Bypass -File scripts/start.ps1 -Lan`. The console prints `http://<your-LAN-IP>:8000`; give the tester that address. If Windows asks whether Python may accept connections on private networks, the choice is yours. ReSpace never changes firewall settings. Never use LAN mode on public Wi-Fi, and never port-forward it.
4. Ask the tester to create their own account on the sign-in page. Projects are private to each account.
5. Ask them to click **Add sample projects** on the Projects page.

## Tasks
Give one task at a time. Avoid explaining the interface; note where they hesitate. After each task, the tester can use **Record feedback** (speech-bubble icon, top right). Feedback is saved with the current design revision.

| # | Task | What to observe |
|---|---|---|
| 1 | Open **Sample · Study to trace**. Set the plan scale using the 3600 dimension line, then trace the room and add the door and window. | Is the calibration step understood? Are tracing and snapping accurate? Are the edge-length labels readable? |
| 2 | Correct one wall length using the corner table or by dragging, set the wall height to 2.8 m, then confirm the geometry. | Is it clear that geometry stays a draft until confirmed? |
| 3 | In **Furnish**, add a desk, a tall bookshelf and a lounge chair. Give the desk a width range of 1.2–1.5 m and write a short brief. | Inventory clarity; size ranges; finishes. |
| 4 | In **Design**, generate proposals, or add a **Sample layout (not AI)** if AI is not configured. Compare two alternatives. | Do the origin and check labels make sense? Are the proposals usefully different? |
| 5 | Move and rotate furniture directly. Try the plan, orbit and walk views and the camera presets. Press `?` for shortcuts. | Camera comfort; snapping; whether the dimension readouts help. |
| 6 | Lock the desk's position, then ask the assistant: “Move only the desk nearer the window.” | Is the rejected-because-locked message clear? Are the preview and Apply/Discard clear? |
| 7 | Ask: “Keep everything except the flooring; make it pale oak” and “Make the lighting warmer.” Apply one and discard the other. Use undo and redo. | Trust in the preview; confidence that unrelated items stay put. |
| 8 | Open **History**, name a revision, compare it with the current one, open **Summary**, export a PNG and the project JSON. | Presentation value; whether the schedule is useful. |
| 9 | Open **Checks**. Explain one finding in your own words. Turn the walkway overlay on and off. | Are the checks understandable? Are they over-trusted? Remind the tester they are not code checks. |

## After the session
- Export all feedback as CSV: **Projects → Feedback CSV**, or **Settings → Export CSV** in a project.
- Ask: Which step was slowest? What would you need before using this with a client? Which check would you rely on, and which not?
- Do not treat a single session as evidence of satisfaction or of design quality.
