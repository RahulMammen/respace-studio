import { describe, expect, it } from "vitest";
import * as THREE from "three";
import fixtures from "../../../shared/geometry_fixtures.json";
import type { Calibration, Opening } from "../api/types";
import {
  bounds,
  convexOverlap,
  doorSwing,
  footprint,
  openingSegment,
  planToWorld,
  rotationToThreeY,
  selfIntersects,
  worldToPlan,
  worldToThree,
} from "./shapes";

const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe("shared fixtures (same numbers as the backend validator)", () => {
  it("footprints match for rotated objects", () => {
    for (const f of fixtures.footprints) {
      const corners = footprint({ position: { x: f.x, y: f.y }, rotation_deg: f.rotation_deg, size: { w: f.w, d: f.d, h: 1 } });
      corners.forEach((c, i) => {
        close(c[0], f.corners[i][0]);
        close(c[1], f.corners[i][1]);
      });
    }
  });

  it("opening segments and door swings match for both winding orders", () => {
    for (const o of fixtures.openings) {
      const room = { polygon: o.polygon.map(([x, y]) => ({ x, y })) };
      const op = o.opening as Opening;
      const [a, b] = openingSegment(room, op);
      close(a[0], o.a[0]);
      close(a[1], o.a[1]);
      close(b[0], o.b[0]);
      close(b[1], o.b[1]);
      const swing = doorSwing(room, op);
      if (o.swing_bounds === null) {
        expect(swing).toBeNull();
      } else {
        bounds(swing!).forEach((v, i) => close(v, o.swing_bounds![i], 1e-5));
      }
    }
  });

  it("plan pixels convert to world metres and back", () => {
    for (const c of fixtures.calibration) {
      const cal = c.calibration as Calibration;
      const p = planToWorld({ u: c.u, v: c.v }, cal);
      close(p.x, c.x);
      close(p.y, c.y);
      const back = worldToPlan(p, cal);
      close(back.u, c.u);
      close(back.v, c.v);
    }
  });

  it("world maps to Three.js with matching rotation", () => {
    for (const t of fixtures.three) {
      expect(worldToThree(t.x, t.y, t.elevation)).toEqual(t.position);
      close(rotationToThreeY(t.rotation_deg), t.rotation_y, 1e-9);
    }
  });
});

describe("rendered object matches its validated footprint", () => {
  it("a Three.js box placed with our transform covers exactly the footprint corners", () => {
    for (const rot of [0, 30, 90, 145, 270]) {
      const obj = { position: { x: 1.7, y: 2.4 }, rotation_deg: rot, size: { w: 1.6, d: 0.7, h: 0.8 } };
      const group = new THREE.Group();
      group.position.set(...worldToThree(obj.position.x, obj.position.y, 0));
      group.rotation.y = rotationToThreeY(rot);
      group.updateMatrixWorld();
      // local corners (x = width axis, z = depth axis; +z is the object's front)
      const local = [
        [-0.8, -0.35],
        [0.8, -0.35],
        [0.8, 0.35],
        [-0.8, 0.35],
      ];
      const expected = footprint(obj);
      local.forEach(([lx, lz], i) => {
        const v = new THREE.Vector3(lx, 0, lz).applyMatrix4(group.matrixWorld);
        close(v.x, expected[i][0], 1e-9);
        close(v.z, expected[i][1], 1e-9);
      });
    }
  });
});

describe("quick client checks", () => {
  it("detects overlap and touching", () => {
    const a = footprint({ position: { x: 0, y: 0 }, rotation_deg: 0, size: { w: 2, d: 1, h: 1 } });
    const b = footprint({ position: { x: 1.2, y: 0 }, rotation_deg: 0, size: { w: 1, d: 1, h: 1 } });
    const c = footprint({ position: { x: 1.5, y: 0 }, rotation_deg: 0, size: { w: 1, d: 1, h: 1 } }).map(
      ([x, y]) => [x + 0.5, y] as [number, number],
    );
    expect(convexOverlap(a, b)).toBe(true);
    expect(convexOverlap(a, c)).toBe(false);
  });

  it("flags a bow-tie boundary", () => {
    expect(selfIntersects([{ x: 0, y: 0 }, { x: 4, y: 4 }, { x: 4, y: 0 }, { x: 0, y: 4 }])).toBe(true);
    expect(selfIntersects([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }])).toBe(false);
  });
});
