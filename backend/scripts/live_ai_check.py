"""Bounded live AI verification on synthetic sample projects. Never run in CI.

Usage (from backend/):  .venv\\Scripts\\python scripts\\live_ai_check.py
Uses a throwaway data directory, the real configured provider, and at most
~16 model calls. Prints a JSON summary; never prints the API key.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
TMP = tempfile.mkdtemp(prefix="respace-live-")
os.environ["DATA_DIR"] = TMP
os.environ["DATABASE_URL"] = f"sqlite:///{Path(TMP, 'live.sqlite3').as_posix()}"
os.environ["AI_PROVIDER"] = "gemini"

from fastapi.testclient import TestClient  # noqa: E402

from app.ai import registry  # noqa: E402
from app.ai.provider import StructuredRequest  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.main import create_app  # noqa: E402

CALLS: list[dict[str, object]] = []


class CountingProvider:
    """Wraps the real provider to count and time calls (no content logged)."""

    def __init__(self, inner):
        self.inner = inner
        self.name = inner.name
        self.model = inner.model
        self.is_test_double = inner.is_test_double

    async def generate_structured(self, request: StructuredRequest):
        t0 = time.perf_counter()
        try:
            r = await self.inner.generate_structured(request)
            CALLS.append({"task": request.task, "ok": True, "s": round(time.perf_counter() - t0, 1), "usage": r.usage})
            return r
        except Exception as exc:
            CALLS.append(
                {
                    "task": request.task,
                    "ok": False,
                    "s": round(time.perf_counter() - t0, 1),
                    "error": getattr(exc, "code", type(exc).__name__),
                    "detail": getattr(exc, "detail", ""),
                }
            )
            raise


def main() -> int:
    settings = get_settings()
    if not settings.ai_configured:
        print("GEMINI_API_KEY is not configured")
        return 2
    real = registry.get_provider()
    registry.set_provider_override(CountingProvider(real))
    out: dict[str, object] = {"model": settings.gemini_model, "date": time.strftime("%Y-%m-%d")}
    tc = TestClient(create_app(), base_url="http://testserver")
    r = tc.post(
        "/api/auth/register",
        json={"email": "live@respace.test", "password": "live-check-password", "display_name": "Live"},
    )
    h = {"X-CSRF-Token": r.json()["csrf_token"]}
    projects = tc.post("/api/samples", headers=h).json()["projects"]
    living = next(p for p in projects if "living room" in p["name"])["id"]
    study = next(p for p in projects if "Study" in p["name"])["id"]

    # ---- 1. generation
    t0 = time.perf_counter()
    g = tc.post(f"/api/projects/{living}/ai/generate", json={"count": 3}, headers=h)
    gen = g.json()
    out["generate"] = {
        "http": g.status_code,
        "seconds": round(time.perf_counter() - t0, 1),
        "detail": gen.get("detail") if g.status_code != 200 else None,
        "calls": gen.get("calls"),
        "conflicts": gen.get("conflicts"),
        "proposals": [
            {
                "name": a["name"],
                "status": a["validation_status"],
                "repair_rounds": a["repair_rounds"],
                "objects": len(a["scene"]["objects"]),
                "errors": [i["code"] for i in a["validation"]["issues"] if i["severity"] == "error"],
                "warnings": [i["code"] for i in a["validation"]["issues"] if i["severity"] == "warning"],
                "conversion_errors": a["conversion_errors"],
                "rationale": a["scene"]["rationale"][:200],
            }
            for a in gen.get("alternatives", [])
        ],
    }
    alts = gen.get("alternatives", [])
    if not alts:
        out["calls"] = CALLS
        print(json.dumps(out, indent=1))
        return 1
    best = sorted(alts, key=lambda a: ({"valid": 0, "warnings": 1, "invalid": 2}[a["validation_status"]], 0))[0]
    aid = best["id"]
    base = f"/api/projects/{living}/alternatives/{aid}"
    cur = tc.get(base).json()
    sofa = next((o for o in cur["scene"]["objects"] if o["category"] == "sofa"), None)
    out["edit_target"] = {"alternative": best["name"], "status": cur["validation"]["status"]}

    # ---- 2. lock the sofa (architect action)
    lock = tc.post(
        f"{base}/ops",
        headers=h,
        json={
            "base_revision": cur["revision"],
            "operations": [
                {"op": "lock", "target_id": sofa["id"], "properties": ["position", "rotation", "size", "presence"]}
            ],
        },
    )
    rev = lock.json()["revision"]
    sofa_before = next(o for o in lock.json()["scene"]["objects"] if o["id"] == sofa["id"])

    def chat(message: str, revision: int):
        t1 = time.perf_counter()
        resp = tc.post(
            f"{base}/chat", headers=h, json={"message": message, "base_revision": revision, "selected_ids": []}
        )
        body = resp.json()
        p = body.get("proposal")
        summary = {
            "http": resp.status_code,
            "seconds": round(time.perf_counter() - t1, 1),
            "intent": body.get("intent"),
            "reply": (body.get("reply") or "")[:240],
            "conflicts": body.get("conflicts"),
            "detail": body.get("detail") if resp.status_code != 200 else None,
        }
        if p:
            summary.update(
                {
                    "proposal_status": p["status"],
                    "validation": p["report"]["status"],
                    "diff": p["report"]["diff"],
                    "rejected": p["report"]["rejected"],
                    "repair_rounds": p["report"].get("repair_rounds"),
                    "new_errors": [i["code"] for i in p["report"]["issues"] if i["severity"] == "error"],
                }
            )
            psofa = next((o for o in p["scene"]["objects"] if o["id"] == sofa["id"]), None)
            summary["sofa_preserved"] = bool(psofa) and all(
                psofa[k] == sofa_before[k] for k in ("position", "rotation_deg", "size", "locks")
            )
        return summary, p

    # ---- 3. the spec's revision request with a locked sofa
    s1, p1 = chat(
        "Keep the arrangement and sofa. Make the chairs visually lighter, change the floor to pale oak, "
        "and add warm accent lighting.",
        rev,
    )
    if p1 and p1["status"] == "pending":
        ap = tc.post(f"/api/projects/{living}/proposals/{p1['id']}/apply", headers=h)
        s1["apply_http"] = ap.status_code
        if ap.status_code == 200:
            rev = ap.json()["revision"]
            after = next(o for o in ap.json()["scene"]["objects"] if o["id"] == sofa["id"])
            s1["sofa_preserved_after_apply"] = all(
                after[k] == sofa_before[k] for k in ("position", "rotation_deg", "size", "locks")
            )
    out["edit_revision_request"] = s1

    # ---- 4. targeted: lock respected even when asked to move it
    s2, _ = chat("Move the sofa 50 cm towards the window.", rev)
    out["edit_move_locked_sofa"] = s2

    # ---- 5. lighting only
    s3, _ = chat("Make the lighting warmer.", rev)
    out["edit_lighting"] = s3

    # ---- 6. rearrangement with locks
    s4, _ = chat("Try another arrangement using the same required inventory.", rev)
    out["edit_rearrange"] = s4

    # ---- 7. outline extraction (study sample: 3.6 m x 3.2 m room at plan origin offset 0.9 m)
    proj = tc.get(f"/api/projects/{study}").json()
    plan = proj["assets"][0]["id"]
    cal = {"a": {"u": 90, "v": 45}, "b": {"u": 450, "v": 45}, "length_m": 3.6}
    t2 = time.perf_counter()
    ex = tc.post(f"/api/projects/{study}/ai/extract-geometry", headers=h, json={"asset_id": plan, "calibration": cal})
    exb = ex.json()
    rooms = exb.get("rooms", [])
    summary_ex: dict[str, object] = {
        "http": ex.status_code,
        "seconds": round(time.perf_counter() - t2, 1),
        "detail": exb.get("detail") if ex.status_code != 200 else None,
        "rooms": len(rooms),
        "uncertain": exb.get("uncertain"),
        "dimension_labels": exb.get("dimension_labels"),
        "issues": exb.get("issues"),
    }
    if rooms:
        xs = [p["x"] for p in rooms[0]["polygon"]]
        ys = [p["y"] for p in rooms[0]["polygon"]]
        summary_ex["room0"] = {
            "corners": len(xs),
            "bbox": [round(min(xs), 2), round(min(ys), 2), round(max(xs), 2), round(max(ys), 2)],
            "expected_bbox": [0.9, 0.9, 4.5, 4.1],
            "openings": [(o["kind"], o["wall_index"], o["width_m"]) for o in rooms[0]["openings"]],
            "confidence": rooms[0].get("confidence"),
        }
    out["extract"] = summary_ex
    out["geometry_unchanged"] = tc.get(f"/api/projects/{study}").json()["geometry"]["rooms"] == []
    out["calls"] = CALLS
    out["total_calls"] = len(CALLS)
    print(json.dumps(out, indent=1, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
