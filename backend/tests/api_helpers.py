"""Test client helpers: isolated data directory, signed-in users with CSRF."""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient


class Client:
    def __init__(self, tc: TestClient) -> None:
        self.tc = tc
        self.csrf = ""

    def register(self, email: str, password: str = "correct horse battery", name: str = "Tester") -> dict[str, Any]:  # noqa: S107
        r = self.tc.post("/api/auth/register", json={"email": email, "password": password, "display_name": name})
        assert r.status_code == 201, r.text
        self.csrf = r.json()["csrf_token"]
        return r.json()

    def _h(self) -> dict[str, str]:
        return {"X-CSRF-Token": self.csrf} if self.csrf else {}

    def get(self, url: str, **kw: Any):
        return self.tc.get(url, **kw)

    def post(self, url: str, **kw: Any):
        return self.tc.post(url, headers={**self._h(), **kw.pop("headers", {})}, **kw)

    def put(self, url: str, **kw: Any):
        return self.tc.put(url, headers={**self._h(), **kw.pop("headers", {})}, **kw)

    def patch(self, url: str, **kw: Any):
        return self.tc.patch(url, headers={**self._h(), **kw.pop("headers", {})}, **kw)

    def delete(self, url: str, **kw: Any):
        return self.tc.delete(url, headers={**self._h(), **kw.pop("headers", {})}, **kw)


ROOM = {
    "id": "living",
    "name": "Living",
    "polygon": [{"x": 0, "y": 0}, {"x": 5.0, "y": 0}, {"x": 5.0, "y": 4.0}, {"x": 0, "y": 4.0}],
    "wall_height_m": 2.7,
    "openings": [
        {"id": "door-1", "kind": "door", "wall_index": 0, "offset_m": 1.0, "width_m": 0.9, "is_entrance": True}
    ],
}

INVENTORY = {
    "items": [
        {"id": "sofa", "category": "sofa", "variant": "three_seat", "count": 1},
        {"id": "coffee", "category": "table", "variant": "coffee", "count": 1},
    ],
    "walkway_clearance_m": 0.9,
}


def make_confirmed_project(c: Client, name: str = "P") -> str:
    pid = c.post("/api/projects", json={"name": name}).json()["id"]
    r = c.put(f"/api/projects/{pid}/geometry", json={"geometry": {"rooms": [ROOM]}, "confirm": True})
    assert r.status_code == 200, r.text
    assert c.put(f"/api/projects/{pid}/inventory", json=INVENTORY).status_code == 200
    return pid


def sofa_scene(x: float = 2.5, y: float = 3.5, locks: list[str] | None = None) -> dict[str, Any]:
    return {
        "objects": [
            {
                "id": "sofa",
                "category": "sofa",
                "variant": "three_seat",
                "room_id": "living",
                "requirement_id": "sofa",
                "position": {"x": x, "y": y},
                "rotation_deg": 180,
                "size": {"w": 2.2, "d": 0.92, "h": 0.8},
                "finish": {"material": "linen", "color": "#d8d0c2"},
                "locks": locks or [],
            },
            {
                "id": "coffee",
                "category": "table",
                "variant": "coffee",
                "room_id": "living",
                "requirement_id": "coffee",
                "position": {"x": 2.5, "y": 2.3},
                "rotation_deg": 0,
                "size": {"w": 1.1, "d": 0.6, "h": 0.4},
                "finish": {"material": "oak", "color": "#c9a27a"},
            },
        ],
        "finishes": [
            {
                "room_id": "living",
                "floor": {"material": "oak", "color": "#c9a27a"},
                "walls": {"material": "plaster", "color": "#efe9df"},
            }
        ],
    }
