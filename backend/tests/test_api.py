import io

from api_helpers import INVENTORY, ROOM, make_confirmed_project, sofa_scene
from PIL import Image


def png_bytes(w=400, h=300, fmt="PNG"):
    buf = io.BytesIO()
    Image.new("RGB", (w, h), "#ffffff").save(buf, format=fmt)
    return buf.getvalue()


# ---------------------------------------------------------------- auth and CSRF


def test_requires_sign_in(client):
    assert client.get("/api/projects").status_code == 401


def test_register_login_logout(client):
    client.register("a@example.com")
    assert client.get("/api/auth/me").json()["user"]["email"] == "a@example.com"
    assert client.post("/api/auth/logout").status_code == 200
    assert client.get("/api/auth/me").status_code == 401
    bad = client.tc.post("/api/auth/login", json={"email": "a@example.com", "password": "wrong password"})
    assert bad.status_code == 401
    ok = client.tc.post("/api/auth/login", json={"email": "a@example.com", "password": "correct horse battery"})
    assert ok.status_code == 200


def test_short_password_and_duplicate_email(client):
    r = client.tc.post("/api/auth/register", json={"email": "x@example.com", "password": "short", "display_name": "X"})
    assert r.status_code == 422
    client.register("x@example.com")
    r = client.tc.post(
        "/api/auth/register", json={"email": "x@example.com", "password": "another long pass", "display_name": "X"}
    )
    assert r.status_code == 409


def test_csrf_token_required_for_writes(client):
    client.register("c@example.com")
    r = client.tc.post("/api/projects", json={"name": "No token"})
    assert r.status_code == 403
    r = client.tc.post("/api/projects", json={"name": "Bad token"}, headers={"X-CSRF-Token": "nope"})
    assert r.status_code == 403
    assert client.post("/api/projects", json={"name": "Good"}).status_code == 201


def test_cross_origin_writes_blocked(client):
    client.register("o@example.com")
    r = client.post("/api/projects", json={"name": "x"}, headers={"Origin": "http://evil.example"})
    assert r.status_code == 403
    r = client.post("/api/projects", json={"name": "x"}, headers={"Origin": "http://testserver"})
    assert r.status_code == 201


def test_login_rate_limited(client):
    client.register("r@example.com")
    for _ in range(10):
        client.tc.post("/api/auth/login", json={"email": "r@example.com", "password": "wrong password"})
    r = client.tc.post("/api/auth/login", json={"email": "r@example.com", "password": "correct horse battery"})
    assert r.status_code == 429


# ---------------------------------------------------------------- ownership


def test_other_users_cannot_access_project_assets_or_scenes(make_client):
    alice, bob = make_client(), make_client()
    alice.register("alice@example.com")
    bob.register("bob@example.com")
    pid = make_confirmed_project(alice)
    up = alice.post(
        f"/api/projects/{pid}/assets", files={"file": ("p.png", png_bytes(), "image/png")}, data={"kind": "plan"}
    )
    aid = up.json()["id"]
    alt = alice.post(f"/api/projects/{pid}/alternatives", json={"name": "A"}).json()
    alice.post(f"/api/projects/{pid}/feedback", json={"text": "fine"})
    urls_get = [
        f"/api/projects/{pid}",
        f"/api/projects/{pid}/assets/{aid}/file",
        f"/api/projects/{pid}/alternatives",
        f"/api/projects/{pid}/alternatives/{alt['id']}",
        f"/api/projects/{pid}/alternatives/{alt['id']}/revisions",
        f"/api/projects/{pid}/alternatives/{alt['id']}/schedule.csv",
        f"/api/projects/{pid}/feedback",
        f"/api/projects/{pid}/export",
        f"/api/projects/{pid}/chat",
    ]
    for url in urls_get:
        assert bob.get(url).status_code == 404, url
    writes = [
        ("patch", f"/api/projects/{pid}", {"name": "pwned"}),
        ("put", f"/api/projects/{pid}/geometry", {"geometry": {"rooms": [ROOM]}}),
        ("put", f"/api/projects/{pid}/inventory", INVENTORY),
        ("put", f"/api/projects/{pid}/alternatives/{alt['id']}/scene", {"base_revision": 1, "scene": sofa_scene()}),
        ("post", f"/api/projects/{pid}/feedback", {"text": "x"}),
        ("post", f"/api/projects/{pid}/ai/generate", {}),
        ("delete", f"/api/projects/{pid}", None),
    ]
    for method, url, body in writes:
        kw = {"json": body} if body is not None else {}
        assert getattr(bob, method)(url, **kw).status_code == 404, url
    assert bob.get("/api/projects").json() == []
    assert alice.get(f"/api/projects/{pid}").json()["name"] == "P"
    csv_text = bob.get("/api/feedback/export.csv").text
    assert "fine" not in csv_text


# ---------------------------------------------------------------- projects and uploads


def test_project_crud(client):
    client.register("p@example.com")
    pid = client.post("/api/projects", json={"name": "Flat"}).json()["id"]
    assert client.patch(f"/api/projects/{pid}", json={"name": "Flat 2"}).json()["name"] == "Flat 2"
    assert [p["name"] for p in client.get("/api/projects").json()] == ["Flat 2"]
    assert client.delete(f"/api/projects/{pid}").status_code == 204
    assert client.get(f"/api/projects/{pid}").status_code == 404


def test_upload_validation(client, app_env):
    client.register("u@example.com")
    pid = client.post("/api/projects", json={"name": "U"}).json()["id"]
    url = f"/api/projects/{pid}/assets"
    ok = client.post(url, files={"file": ("plan.jpg", png_bytes(fmt="JPEG"), "image/jpeg")}, data={"kind": "plan"})
    assert ok.status_code == 201 and ok.json()["mime_type"] == "image/jpeg"
    fake = client.post(url, files={"file": ("plan.png", b"<script>alert(1)</script>", "image/png")})
    assert fake.status_code == 415
    pdf = client.post(url, files={"file": ("plan.pdf", b"%PDF-1.4 fake", "application/pdf")})
    assert pdf.status_code == 415
    gif = io.BytesIO()
    Image.new("RGB", (100, 100)).save(gif, format="GIF")
    assert client.post(url, files={"file": ("a.gif", gif.getvalue(), "image/gif")}).status_code == 415
    tiny = client.post(url, files={"file": ("t.png", png_bytes(20, 20), "image/png")})
    assert tiny.status_code == 422
    big = b"\x89PNG" + b"0" * (15 * 1024 * 1024 + 10)
    assert client.post(url, files={"file": ("big.png", big, "image/png")}).status_code == 413
    # stored under ignored data dir with a generated name, never the user's
    files = list((app_env / "data" / "uploads").iterdir())
    assert len(files) == 1 and "plan" not in files[0].name


def test_geometry_confirmation_flow(client):
    client.register("g@example.com")
    pid = client.post("/api/projects", json={"name": "G"}).json()["id"]
    bow = {**ROOM, "polygon": [{"x": 0, "y": 0}, {"x": 4, "y": 4}, {"x": 4, "y": 0}, {"x": 0, "y": 4}], "openings": []}
    r = client.put(f"/api/projects/{pid}/geometry", json={"geometry": {"rooms": [bow]}, "confirm": True})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "invalid_geometry"
    # Draft save with errors is allowed but never confirmed
    r = client.put(f"/api/projects/{pid}/geometry", json={"geometry": {"rooms": [bow]}, "confirm": False})
    assert r.status_code == 200 and r.json()["geometry"]["confirmed"] is False
    assert client.post(f"/api/projects/{pid}/alternatives", json={"name": "x"}).status_code == 409
    r = client.put(f"/api/projects/{pid}/geometry", json={"geometry": {"rooms": [ROOM]}, "confirm": True})
    assert r.json()["geometry"]["confirmed"] is True
    # client cannot sneak confirmed=true through a draft save
    r = client.put(f"/api/projects/{pid}/geometry", json={"geometry": {"rooms": [ROOM], "confirmed": True}})
    assert r.json()["geometry"]["confirmed"] is False


def test_inventory_validation(client):
    client.register("i@example.com")
    pid = client.post("/api/projects", json={"name": "I"}).json()["id"]
    bad = {"items": [{"id": "a", "category": "sofa"}, {"id": "a", "category": "bed"}]}
    assert client.put(f"/api/projects/{pid}/inventory", json=bad).status_code == 422
    rng = {
        "items": [
            {"id": "a", "category": "sofa", "size": {"min": {"w": 2, "d": 1, "h": 1}, "max": {"w": 1, "d": 1, "h": 1}}}
        ]
    }
    assert client.put(f"/api/projects/{pid}/inventory", json=rng).status_code == 422
    assert (
        client.put(f"/api/projects/{pid}/inventory", json={"items": [{"id": "a", "category": "spaceship"}]}).status_code
        == 422
    )


# ---------------------------------------------------------------- scenes, revisions, locks, stale writes


def test_revisions_undo_redo_and_stale_write(client):
    client.register("s@example.com")
    pid = make_confirmed_project(client)
    alt = client.post(f"/api/projects/{pid}/alternatives", json={"name": "A"}).json()
    base = f"/api/projects/{pid}/alternatives/{alt['id']}"
    r1 = client.put(f"{base}/scene", json={"base_revision": 1, "scene": sofa_scene(2.5)})
    assert r1.status_code == 200 and r1.json()["revision"] == 2
    r2 = client.put(f"{base}/scene", json={"base_revision": 2, "scene": sofa_scene(2.6)})
    assert r2.json()["revision"] == 3
    # stale: another tab still on revision 2
    stale = client.put(f"{base}/scene", json={"base_revision": 2, "scene": sofa_scene(1.0)})
    assert stale.status_code == 409 and stale.json()["detail"]["code"] == "stale_revision"
    # undo = save the previous snapshot as a new revision
    prev = client.get(f"{base}/revisions/2").json()["scene"]
    undo = client.put(f"{base}/scene", json={"base_revision": 3, "scene": prev, "source": "undo"})
    assert undo.json()["revision"] == 4
    assert undo.json()["scene"]["objects"][0]["position"]["x"] == 2.5
    redo = client.put(
        f"{base}/scene",
        json={"base_revision": 4, "scene": client.get(f"{base}/revisions/3").json()["scene"], "source": "redo"},
    )
    assert redo.json()["scene"]["objects"][0]["position"]["x"] == 2.6
    revs = client.get(f"{base}/revisions").json()
    assert [r["number"] for r in revs] == [5, 4, 3, 2, 1]
    assert client.put(f"{base}/revisions/3/label", json={"label": "Client review"}).status_code == 200
    # persisted: a fresh read returns the same scene and validation
    fresh = client.get(base).json()
    assert fresh["revision"] == 5 and fresh["validation"]["status"] in ("valid", "warnings")


def test_locked_properties_enforced_on_save_and_ops(client):
    client.register("l@example.com")
    pid = make_confirmed_project(client)
    alt = client.post(f"/api/projects/{pid}/alternatives", json={"name": "A"}).json()
    base = f"/api/projects/{pid}/alternatives/{alt['id']}"
    client.put(f"{base}/scene", json={"base_revision": 1, "scene": sofa_scene(locks=["position", "presence"])})
    moved = client.put(
        f"{base}/scene", json={"base_revision": 2, "scene": sofa_scene(x=1.5, locks=["position", "presence"])}
    )
    assert moved.status_code == 409 and moved.json()["detail"]["code"] == "locked"
    removed = sofa_scene(locks=["position"])
    removed["objects"] = removed["objects"][1:]
    assert client.put(f"{base}/scene", json={"base_revision": 2, "scene": removed}).status_code == 409
    op = client.post(
        f"{base}/ops", json={"base_revision": 2, "operations": [{"op": "move", "target_id": "sofa", "x": 1, "y": 3}]}
    )
    assert op.status_code == 409
    # material is not locked: allowed, and position preserved exactly
    ok = client.post(
        f"{base}/ops",
        json={
            "base_revision": 2,
            "operations": [{"op": "set_finish", "target_id": "sofa", "material": "velvet", "color": "#6b7c65"}],
        },
    )
    assert ok.status_code == 200
    sofa = next(o for o in ok.json()["scene"]["objects"] if o["id"] == "sofa")
    assert sofa["finish"]["material"] == "velvet" and sofa["position"] == {"x": 2.5, "y": 3.5}
    # architect unlocks explicitly, then may move
    un = client.post(
        f"{base}/ops",
        json={
            "base_revision": 3,
            "operations": [
                {"op": "unlock", "target_id": "sofa", "properties": ["position"]},
                {"op": "move", "target_id": "sofa", "x": 2.4, "y": 3.5},
            ],
        },
    )
    assert un.status_code == 200
    assert next(o for o in un.json()["scene"]["objects"] if o["id"] == "sofa")["position"]["x"] == 2.4


def test_compare_and_schedule(client):
    client.register("cmp@example.com")
    pid = make_confirmed_project(client)
    alt = client.post(f"/api/projects/{pid}/alternatives", json={"name": "A"}).json()
    base = f"/api/projects/{pid}/alternatives/{alt['id']}"
    client.put(f"{base}/scene", json={"base_revision": 1, "scene": sofa_scene(2.5)})
    client.put(f"{base}/scene", json={"base_revision": 2, "scene": sofa_scene(2.7)})
    cmp = client.get(f"/api/projects/{pid}/compare", params={"a": f"{alt['id']}@2", "b": f"{alt['id']}@3"}).json()
    assert cmp["diff"]["changed"] == {"sofa": ["position"]}
    csv_text = client.get(f"{base}/schedule.csv").text
    assert "Three-seater" in csv_text and "Approximate concept envelope" in csv_text


def test_rule_based_alternative_is_labelled_not_ai(client):
    client.register("rb@example.com")
    pid = make_confirmed_project(client)
    alt = client.post(f"/api/projects/{pid}/alternatives", json={"name": "Demo", "mode": "rule_based"}).json()
    assert alt["origin"] == "sample"
    assert "not AI" in client.get(f"/api/projects/{pid}/alternatives/{alt['id']}/revisions").json()[0]["summary"]


# ---------------------------------------------------------------- export / import


def test_export_import_round_trip(make_client):
    a, b = make_client(), make_client()
    a.register("ex@example.com")
    b.register("im@example.com")
    pid = make_confirmed_project(a, "Round trip")
    a.post(f"/api/projects/{pid}/assets", files={"file": ("p.png", png_bytes(), "image/png")}, data={"kind": "plan"})
    alt = a.post(f"/api/projects/{pid}/alternatives", json={"name": "Scheme"}).json()
    scene = sofa_scene(locks=["position"])
    scene["lighting"] = {"mood": "evening", "color_temperature_k": 2700, "intensity": 0.8, "accent_lights": True}
    a.put(f"/api/projects/{pid}/alternatives/{alt['id']}/scene", json={"base_revision": 1, "scene": scene})
    doc = a.get(f"/api/projects/{pid}/export").json()
    assert doc["format"] == "respace-project" and doc["format_version"] == 1
    imported = b.post("/api/projects/import", json={"document": doc}).json()
    assert imported["geometry"]["rooms"] == a.get(f"/api/projects/{pid}").json()["geometry"]["rooms"]
    assert imported["geometry"]["confirmed"] is True
    alt_b = b.get(f"/api/projects/{imported['id']}/alternatives").json()[0]
    exported_scene = doc["alternatives"][0]["scene"]
    assert alt_b["scene"] == exported_scene
    sofa = next(o for o in alt_b["scene"]["objects"] if o["id"] == "sofa")
    assert sofa["locks"] == ["position"] and alt_b["scene"]["lighting"]["mood"] == "evening"
    assert len(imported["assets"]) == 1
    # import is owned by the importer only
    assert a.get(f"/api/projects/{imported['id']}").status_code == 404


def test_import_rejects_bad_documents(client):
    client.register("bad@example.com")
    assert client.post("/api/projects/import", json={"document": {"format": "other"}}).status_code == 422
    newer = {"format": "respace-project", "format_version": 99}
    assert client.post("/api/projects/import", json={"document": newer}).status_code == 422
    broken = {"format": "respace-project", "format_version": 1, "project": {"geometry": {"rooms": [{"id": "x"}]}}}
    assert client.post("/api/projects/import", json={"document": broken}).status_code == 422


# ---------------------------------------------------------------- feedback and samples


def test_feedback_linked_to_revision(client):
    client.register("fb@example.com")
    pid = make_confirmed_project(client)
    alt = client.post(f"/api/projects/{pid}/alternatives", json={"name": "A"}).json()
    r = client.post(
        f"/api/projects/{pid}/feedback",
        json={"alternative_id": alt["id"], "revision": 1, "task": "Lock sofa", "rating": 4, "text": "Clear"},
    )
    assert r.status_code == 201 and r.json()["revision"] == 1
    bad = client.post(f"/api/projects/{pid}/feedback", json={"alternative_id": alt["id"], "revision": 9, "text": "x"})
    assert bad.status_code == 422
    assert "Lock sofa" in client.get("/api/feedback/export.csv").text


def test_samples_created_and_valid(client):
    client.register("smp@example.com")
    made = client.post("/api/samples").json()["projects"]
    assert len(made) == 3
    living = client.get(f"/api/projects/{made[0]['id']}").json()
    assert living["geometry"]["confirmed"] and living["assets"][0]["source"] == "synthetic sample"
    for alt in client.get(f"/api/projects/{made[0]['id']}/alternatives").json():
        full = client.get(f"/api/projects/{made[0]['id']}/alternatives/{alt['id']}").json()
        assert full["validation"]["status"] in ("valid", "warnings"), full["validation"]["issues"]
    two = client.get(f"/api/projects/{made[1]['id']}/alternatives").json()[0]
    full = client.get(f"/api/projects/{made[1]['id']}/alternatives/{two['id']}").json()
    assert {o["room_id"] for o in full["scene"]["objects"]} == {"living", "bedroom"}
    assert full["validation"]["status"] in ("valid", "warnings"), full["validation"]["issues"]


def test_lan_same_origin_allowed_and_cross_origin_blocked(client):
    """LAN testers reach the app at the host's network address; same-origin must work."""

    lan = {"Host": "192.168.1.50:8000"}
    r = client.tc.post(
        "/api/auth/register",
        json={"email": "lan@example.com", "password": "correct horse battery", "display_name": "LAN"},
        headers={**lan, "Origin": "http://192.168.1.50:8000"},
    )
    assert r.status_code == 201
    r = client.tc.post(
        "/api/auth/login",
        json={"email": "lan@example.com", "password": "correct horse battery"},
        headers={**lan, "Origin": "http://192.168.1.51:8000"},
    )
    assert r.status_code == 403
    r = client.tc.post(
        "/api/auth/login",
        json={"email": "lan@example.com", "password": "correct horse battery"},
        headers={**lan, "Origin": "null"},
    )
    assert r.status_code == 403


def test_security_headers_present(client):
    r = client.get("/api/health")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"
    assert r.headers["cache-control"] == "no-store"


def test_saved_circulation_settings_are_never_overwritten(client):
    """Legacy inventories without access_clearance_m read as the default without being rewritten."""

    from sqlalchemy.orm import Session

    from app.db import Project, get_engine

    client.register("circ@example.com")
    pid = make_confirmed_project(client)
    legacy = {"items": INVENTORY["items"], "walkway_clearance_m": 1.1}
    with Session(get_engine()) as db:
        db.get(Project, pid).inventory = legacy
        db.commit()
    detail = client.get(f"/api/projects/{pid}").json()
    assert detail["inventory"]["walkway_clearance_m"] == 1.1
    assert detail["inventory"]["access_clearance_m"] == 0.6  # default shown, not stored
    client.put(f"/api/projects/{pid}/brief", json={"text": "unrelated edit"})
    client.post(f"/api/projects/{pid}/alternatives", json={"name": "A"})
    with Session(get_engine()) as db:
        assert db.get(Project, pid).inventory == legacy  # untouched by other actions
    saved = client.put(
        f"/api/projects/{pid}/inventory", json={**INVENTORY, "walkway_clearance_m": 1.0, "access_clearance_m": 0.75}
    )
    assert saved.json()["access_clearance_m"] == 0.75
    alt = client.post(f"/api/projects/{pid}/alternatives", json={"name": "B"}).json()
    assert alt["validation"]["derived"]["access_clearance_m"] == 0.75
    assert alt["validation"]["derived"]["clearance_m"] == 1.0
