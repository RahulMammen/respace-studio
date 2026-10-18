import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Alternative, Scene } from "../api/types";
import { useWorkspace } from "./workspace";

const scene = (x: number): Scene => ({
  schema_version: 1,
  objects: [
    {
      id: "sofa",
      category: "sofa",
      variant: "three_seat",
      room_id: "living",
      requirement_id: "sofa",
      label: "",
      position: { x, y: 3 },
      rotation_deg: 0,
      size: { w: 2.2, d: 0.9, h: 0.8 },
      finish: { material: "linen", color: "#d8d0c2" },
      accent: null,
      elevation_m: 0,
      locks: [],
      existing: false,
    },
  ],
  finishes: [],
  lighting: { mood: "daylight", color_temperature_k: 4000, intensity: 1, accent_lights: false },
  rationale: "",
  tradeoffs: [],
  unresolved: [],
});

describe("workspace undo/redo and saving", () => {
  let calls: { url: string; body: { base_revision: number; source: string; scene: Scene } }[];

  beforeEach(() => {
    vi.useFakeTimers();
    calls = [];
    let revision = 1;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        calls.push({ url, body });
        revision = body.base_revision + 1;
        return new Response(JSON.stringify({ revision, validation_status: "valid", scene: body.scene, validation: null }), { status: 200 });
      }),
    );
    const alt: Alternative = { id: "a1", name: "A", origin: "manual", revision: 1, validation_status: "valid", scene: scene(1) };
    useWorkspace.setState({
      project: { id: "p1" } as never,
      alt,
      scene: scene(1),
      undoStack: [],
      redoStack: [],
      sceneSave: "saved",
      alternatives: [alt],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("commits edits, undoes and redoes, saving each as a new revision with the right base", async () => {
    const ws = useWorkspace.getState();
    ws.updateObject("sofa", { position: { x: 2, y: 3 } });
    expect(useWorkspace.getState().sceneSave).toBe("unsaved");
    await vi.advanceTimersByTimeAsync(600);
    expect(calls).toHaveLength(1);
    expect(calls[0].body.base_revision).toBe(1);
    expect(calls[0].body.source).toBe("manual");
    expect(useWorkspace.getState().alt!.revision).toBe(2);

    useWorkspace.getState().undo();
    expect(useWorkspace.getState().scene!.objects[0].position.x).toBe(1);
    await vi.advanceTimersByTimeAsync(300);
    expect(calls[1].body.source).toBe("undo");
    expect(calls[1].body.base_revision).toBe(2);

    useWorkspace.getState().redo();
    expect(useWorkspace.getState().scene!.objects[0].position.x).toBe(2);
    await vi.advanceTimersByTimeAsync(300);
    expect(calls[2].body.source).toBe("redo");
    expect(useWorkspace.getState().sceneSave).toBe("saved");
    expect(useWorkspace.getState().redoStack).toHaveLength(0);
  });

  it("marks the design stale when the server reports a newer revision", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ detail: { code: "stale_revision", message: "changed" } }), { status: 409 })),
    );
    useWorkspace.getState().updateObject("sofa", { position: { x: 5, y: 3 } });
    await vi.advanceTimersByTimeAsync(600);
    expect(useWorkspace.getState().sceneSave).toBe("stale");
  });
});
