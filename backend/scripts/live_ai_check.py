"""Bounded live AI verification on synthetic sample projects. Manual only; never run in CI.

Usage (from backend/):
    .venv\\Scripts\\python scripts\\live_ai_check.py [--reset] [--limit 7] [--total 8]

- One shared budget file caps every outbound model attempt (including repairs and
  retries) across this script and the browser review spec; SDK retries are disabled.
  This script may use at most ``--limit`` attempts so the browser review keeps one.
- Results are written after every check to data/live-run/results.json. Without
  --reset, checks that already PASSED are reused, not repeated.
- Quota or budget exhaustion marks the current and remaining checks INCOMPLETE.
- Exit code: 0 = all checks PASS, 1 = any FAIL, 3 = no FAIL but some INCOMPLETE.
Never prints the API key.
"""

from __future__ import annotations

import argparse
import colorsys
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

BACKEND = Path(__file__).resolve().parents[1]
RUN_DIR = BACKEND / "data" / "live-run"
RESULTS = RUN_DIR / "results.json"
BUDGET_FILE = RUN_DIR / "ai-budget.json"
CHECKS = ["smoke", "generate", "revision_with_locked_sofa", "warmer_lighting", "outline_extraction"]
STOP_CODES = {"ai_quota", "ai_budget"}
REVISION_REQUEST = (
    "Keep the arrangement and sofa. Make the chairs visually lighter, change the floor to pale oak, "
    "and add warm accent lighting."
)


class Incomplete(Exception):
    pass


class CheckFailed(Exception):
    pass


def expect(cond: bool, message: str) -> None:
    if not cond:
        raise CheckFailed(message)


def lightness(hex_color: str) -> float:
    r, g, b = (int(hex_color[i : i + 2], 16) / 255 for i in (1, 3, 5))
    return colorsys.rgb_to_hls(r, g, b)[1]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--reset", action="store_true", help="start a fresh run (new data, budget and results)")
    ap.add_argument("--limit", type=int, default=7, help="attempts this script may use")
    ap.add_argument("--total", type=int, default=8, help="shared budget including the browser review")
    ap.add_argument("--self-test", action="store_true", help="exercise the script with the test double (no live calls)")
    args = ap.parse_args()
    limit = min(args.limit, args.total)

    if args.reset and RUN_DIR.exists():
        for p in sorted(RUN_DIR.rglob("*"), reverse=True):
            p.unlink() if p.is_file() else p.rmdir()
    RUN_DIR.mkdir(parents=True, exist_ok=True)
    os.environ.update(
        {
            "DATA_DIR": str(RUN_DIR / "data"),
            "DATABASE_URL": f"sqlite:///{(RUN_DIR / 'live.sqlite3').as_posix()}",
            "AI_PROVIDER": "mock" if args.self_test else "gemini",
            "AI_CALL_BUDGET": str(limit),
            "AI_BUDGET_FILE": str(BUDGET_FILE),
            # One repair round keeps the whole verification inside the shared budget.
            "AI_MAX_REPAIR_ROUNDS": "1",
        }
    )
    sys.path.insert(0, str(BACKEND))
    from fastapi.testclient import TestClient

    from app.ai import smoke as smoke_mod
    from app.ai.budget import CallBudget
    from app.ai.provider import AIError, StructuredRequest, inline_json_schema
    from app.ai.registry import get_provider
    from app.config import get_settings
    from app.main import create_app

    settings = get_settings()
    if not args.self_test and not settings.ai_configured:
        print("GEMINI_API_KEY is not configured")
        return 2
    budget = CallBudget(BUDGET_FILE, args.total)
    state: dict[str, Any] = json.loads(RESULTS.read_text(encoding="utf-8")) if RESULTS.exists() else {}
    state.setdefault("checks", {})
    state.setdefault("context", {})
    state.update(
        {"model": settings.gemini_model, "repair_rounds": 1, "total_budget": args.total, "script_limit": limit}
    )

    def save() -> None:
        state["budget_used"] = budget.used()
        RESULTS.write_text(json.dumps(state, indent=1, default=str), encoding="utf-8")

    tc = TestClient(create_app(), base_url="http://testserver")
    ctx = state["context"]
    creds = {"email": "live@respace.test", "password": "live-check-password-2026"}
    r = tc.post("/api/auth/login", json=creds)
    if r.status_code != 200:
        r = tc.post("/api/auth/register", json={**creds, "display_name": "Live"})
    headers = {"X-CSRF-Token": r.json()["csrf_token"]}
    if "living" not in ctx:
        made = tc.post("/api/samples", headers=headers).json()["projects"]
        ctx["living"] = next(p["id"] for p in made if "living room" in p["name"])
        ctx["study"] = next(p["id"] for p in made if "Study" in p["name"])
        save()

    def api_error(resp: Any) -> None:
        if resp.status_code >= 400:
            detail = resp.json().get("detail")
            code = detail.get("code") if isinstance(detail, dict) else ""
            if code in STOP_CODES:
                raise Incomplete(detail.get("message", code))
            raise CheckFailed(f"HTTP {resp.status_code}: {detail}")

    # ------------------------------------------------------------------ checks
    def check_smoke() -> dict[str, Any]:
        import asyncio

        async def call() -> Any:
            return await get_provider().generate_structured(
                StructuredRequest(
                    task="smoke",
                    system=smoke_mod.SYSTEM,
                    text=smoke_mod.TEXT,
                    schema=inline_json_schema(smoke_mod.SmokePlacement.model_json_schema()),
                    max_output_tokens=2048,
                    temperature=0.2,
                    thinking="low",
                    max_retries=0,
                )
            )

        try:
            resp = asyncio.run(call())
        except AIError as err:
            if err.code in STOP_CODES:
                raise Incomplete(err.user_message) from None
            raise CheckFailed(f"{err.code}: {err.detail}") from None
        placement = smoke_mod.SmokePlacement.model_validate_json(resp.text)
        problems = smoke_mod.check(placement)
        expect(not problems, "; ".join(problems))
        return {"placement": placement.model_dump(), "usage": resp.usage}

    def check_generate() -> dict[str, Any]:
        t0 = time.perf_counter()
        resp = tc.post(f"/api/projects/{ctx['living']}/ai/generate", json={"count": 3}, headers=headers)
        api_error(resp)
        body = resp.json()
        alts = body["alternatives"]
        summary = [
            {
                "id": a["id"],
                "name": a["name"],
                "status": a["validation_status"],
                "repair_rounds": a["repair_rounds"],
                "objects": len(a["scene"]["objects"]),
                "errors": [i["message"] for i in a["validation"]["issues"] if i["severity"] == "error"],
                "notes": a["notes"],
            }
            for a in alts
        ]
        ok = [a for a in alts if a["validation_status"] in ("valid", "warnings")]
        result = {
            "seconds": round(time.perf_counter() - t0, 1),
            "calls": body["calls"],
            "conflicts": body["conflicts"],
            "proposals": summary,
        }
        expect(len(alts) >= 1, "no proposals returned")
        expect(bool(ok), f"no proposal passed the required checks: {summary}")
        best = sorted(ok, key=lambda a: a["validation_status"] != "valid")[0]
        ctx["alternative"] = best["id"]
        result["selected"] = best["name"]
        return result

    def scene_now() -> dict[str, Any]:
        return tc.get(f"/api/projects/{ctx['living']}/alternatives/{ctx['alternative']}").json()

    def check_revision() -> dict[str, Any]:
        expect("alternative" in ctx, "generation did not produce a usable alternative")
        base = f"/api/projects/{ctx['living']}/alternatives/{ctx['alternative']}"
        cur = scene_now()
        sofa = next(o for o in cur["scene"]["objects"] if o["category"] == "sofa")
        if set(sofa["locks"]) != {"position", "rotation", "size", "presence"}:
            resp = tc.post(
                f"{base}/ops",
                headers=headers,
                json={
                    "base_revision": cur["revision"],
                    "operations": [
                        {
                            "op": "lock",
                            "target_id": sofa["id"],
                            "properties": ["position", "rotation", "size", "presence"],
                        }
                    ],
                },
            )
            api_error(resp)
            cur = resp.json()
            sofa = next(o for o in cur["scene"]["objects"] if o["id"] == sofa["id"])
        chairs_before = {o["id"]: o for o in cur["scene"]["objects"] if o["category"] == "armchair"}
        resp = tc.post(
            f"{base}/chat",
            headers=headers,
            json={
                "message": REVISION_REQUEST,
                "base_revision": cur["revision"],
                "selected_ids": [],
            },
        )
        api_error(resp)
        body = resp.json()
        p = body["proposal"]
        expect(p is not None, f"no proposal; reply: {body['reply'][:200]}")
        out: dict[str, Any] = {
            "intent": body["intent"],
            "reply": body["reply"][:300],
            "diff": p["report"]["diff"],
            "rejected": p["report"]["rejected"],
            "conflicts": p["report"]["conflicts"],
        }
        new = {o["id"]: o for o in p["scene"]["objects"]}
        keys = ("position", "rotation_deg", "size", "locks")
        expect(sofa["id"] in new and all(new[sofa["id"]][k] == sofa[k] for k in keys), "locked sofa changed")
        floors = [f["floor"]["material"] for f in p["scene"]["finishes"]]
        expect(all(m == "pale_oak" for m in floors), f"floor not pale oak: {floors}")
        expect(p["scene"]["lighting"]["accent_lights"] is True, "accent lighting not enabled")
        lighter = []
        for cid, before in chairs_before.items():
            after = new.get(cid)
            if after is None:
                continue
            lighter.append(
                lightness(after["finish"]["color"]) > lightness(before["finish"]["color"]) + 0.02
                or after["size"]["w"] * after["size"]["d"] < before["size"]["w"] * before["size"]["d"] - 1e-6
                or (after["variant"] == "slim" and before["variant"] != "slim")
            )
        out["chairs_lighter"] = lighter
        expect(bool(lighter) and all(lighter), "chairs were not made visually lighter (colour, size or slimmer model)")
        moved = [cid for cid, props in p["report"]["diff"]["changed"].items() if "position" in props]
        out["moved"] = moved
        expect(not moved, f"arrangement changed although asked to keep it: {moved}")
        before_err = {
            (i["code"], tuple(i["object_ids"])) for i in cur["validation"]["issues"] if i["severity"] == "error"
        }
        new_err = [
            i["message"]
            for i in p["report"]["issues"]
            if i["severity"] == "error" and (i["code"], tuple(i["object_ids"])) not in before_err
        ]
        expect(not new_err, f"proposal introduces validation errors: {new_err}")
        applied = tc.post(f"/api/projects/{ctx['living']}/proposals/{p['id']}/apply", headers=headers)
        api_error(applied)
        after_sofa = next(o for o in applied.json()["scene"]["objects"] if o["id"] == sofa["id"])
        expect(all(after_sofa[k] == sofa[k] for k in keys), "locked sofa changed after apply")
        out["applied_revision"] = applied.json()["revision"]
        return out

    def check_lighting() -> dict[str, Any]:
        expect("alternative" in ctx, "no alternative to edit")
        base = f"/api/projects/{ctx['living']}/alternatives/{ctx['alternative']}"
        cur = scene_now()
        before = cur["scene"]["lighting"]
        resp = tc.post(
            f"{base}/chat",
            headers=headers,
            json={"message": "Make the lighting warmer.", "base_revision": cur["revision"], "selected_ids": []},
        )
        api_error(resp)
        p = resp.json()["proposal"]
        expect(p is not None, "no proposal")
        after = p["scene"]["lighting"]
        diff = p["report"]["diff"]
        out = {"before": before, "after": after, "diff": diff}
        expect(diff["lighting_changed"], "lighting unchanged")
        expect(
            after["color_temperature_k"] < before["color_temperature_k"]
            or (
                after["color_temperature_k"] <= before["color_temperature_k"]
                and after["mood"] in ("evening", "night")
                and before["mood"] not in ("evening", "night")
            ),
            "lighting did not become warmer",
        )
        expect(not diff["changed"] and not diff["added"] and not diff["removed"], f"furniture changed: {diff}")
        expect(not diff["finishes_changed"], "finishes changed")
        tc.post(f"/api/projects/{ctx['living']}/proposals/{p['id']}/discard", headers=headers)
        return out

    def check_extract() -> dict[str, Any]:
        proj = tc.get(f"/api/projects/{ctx['study']}").json()
        plan = proj["assets"][0]["id"]
        cal = {"a": {"u": 90, "v": 45}, "b": {"u": 450, "v": 45}, "length_m": 3.6}
        resp = tc.post(
            f"/api/projects/{ctx['study']}/ai/extract-geometry",
            headers=headers,
            json={"asset_id": plan, "calibration": cal},
        )
        api_error(resp)
        body = resp.json()
        rooms = body["rooms"]
        expect(bool(rooms), "no room proposed")
        xs = [p["x"] for p in rooms[0]["polygon"]]
        ys = [p["y"] for p in rooms[0]["polygon"]]
        bbox = [round(min(xs), 2), round(min(ys), 2), round(max(xs), 2), round(max(ys), 2)]
        expected = [0.9, 0.9, 4.5, 4.1]
        out = {
            "bbox": bbox,
            "expected_bbox": expected,
            "corners": len(xs),
            "confidence": rooms[0].get("confidence"),
            "openings": [(o["kind"], o["wall_index"], o["width_m"]) for o in rooms[0]["openings"]],
            "uncertain": body["uncertain"],
            "dimension_labels": body["dimension_labels"],
        }
        err = max(abs(a - b) for a, b in zip(bbox, expected, strict=True))
        out["max_corner_error_m"] = round(err, 3)
        expect(err <= 0.2, f"outline differs from the drawn room by {err:.2f} m")
        expect(bool(rooms[0]["openings"]), "no doors or windows proposed")
        expect(
            tc.get(f"/api/projects/{ctx['study']}").json()["geometry"]["rooms"] == [],
            "geometry was changed automatically",
        )
        return out

    runners = {
        "smoke": check_smoke,
        "generate": check_generate,
        "revision_with_locked_sofa": check_revision,
        "warmer_lighting": check_lighting,
        "outline_extraction": check_extract,
    }
    stopped = ""
    for name in CHECKS:
        prev = state["checks"].get(name, {})
        if prev.get("status") == "PASS":
            print(f"{name}: PASS (reused from earlier run)")
            continue
        if stopped:
            state["checks"][name] = {"status": "INCOMPLETE", "reason": f"not run: {stopped}"}
            save()
            print(f"{name}: INCOMPLETE (not run)")
            continue
        used_before = budget.used()
        t0 = time.perf_counter()
        try:
            detail = runners[name]()
            state["checks"][name] = {"status": "PASS", **detail}
        except Incomplete as exc:
            stopped = str(exc)
            state["checks"][name] = {"status": "INCOMPLETE", "reason": stopped}
        except CheckFailed as exc:
            state["checks"][name] = {"status": "FAIL", "reason": str(exc)}
        state["checks"][name]["calls_used"] = budget.used() - used_before
        state["checks"][name]["seconds"] = round(time.perf_counter() - t0, 1)
        state["checks"][name]["date"] = time.strftime("%Y-%m-%dT%H:%MZ", time.gmtime())
        save()
        print(f"{name}: {state['checks'][name]['status']} ({state['checks'][name].get('reason', '')[:160]})")

    statuses = [state["checks"].get(n, {}).get("status") for n in CHECKS]
    print(f"budget used {budget.used()}/{args.total}; results in {RESULTS}")
    if "FAIL" in statuses:
        return 1
    if any(s != "PASS" for s in statuses):
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
