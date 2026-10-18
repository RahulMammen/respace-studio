// Mirrors backend/app/scene.py. World units are metres; angles are degrees.
// World X = right on the plan image, world Y = down on the plan image.

export interface Point {
  x: number;
  y: number;
}

export interface PlanPoint {
  u: number;
  v: number;
}

export interface Calibration {
  a: PlanPoint;
  b: PlanPoint;
  length_m: number;
}

export type OpeningKind = "door" | "window" | "opening";

export interface Opening {
  id: string;
  kind: OpeningKind;
  wall_index: number;
  offset_m: number;
  width_m: number;
  height_m: number;
  sill_m: number;
  swing: "in" | "out" | "none";
  hinge: "start" | "end";
  is_entrance: boolean;
}

export interface Room {
  id: string;
  name: string;
  polygon: Point[];
  wall_height_m: number;
  wall_thickness_m: number;
  openings: Opening[];
}

export interface Geometry {
  schema_version: number;
  plan_asset_id: string | null;
  calibration: Calibration | null;
  rooms: Room[];
  confirmed: boolean;
}

export type Category =
  | "sofa"
  | "armchair"
  | "table"
  | "dining_chair"
  | "desk"
  | "bed"
  | "wardrobe"
  | "bookshelf"
  | "rug"
  | "lamp"
  | "wall_art";

export type LockableProperty = "position" | "rotation" | "size" | "material" | "presence";
export const LOCKABLE: LockableProperty[] = ["position", "rotation", "size", "material", "presence"];

export interface Size {
  w: number;
  d: number;
  h: number;
}

export interface Finish {
  material: string;
  color: string;
}

export interface SceneObject {
  id: string;
  category: Category;
  variant: string;
  room_id: string;
  requirement_id: string | null;
  label: string;
  position: Point;
  rotation_deg: number;
  size: Size;
  finish: Finish;
  accent: Finish | null;
  elevation_m: number;
  locks: LockableProperty[];
  existing: boolean;
}

export interface RoomFinish {
  room_id: string;
  floor: Finish;
  walls: Finish;
}

export type Mood = "daylight" | "overcast" | "evening" | "night";

export interface Lighting {
  mood: Mood;
  color_temperature_k: number;
  intensity: number;
  accent_lights: boolean;
}

export interface Scene {
  schema_version: number;
  objects: SceneObject[];
  finishes: RoomFinish[];
  lighting: Lighting;
  rationale: string;
  tradeoffs: string[];
  unresolved: string[];
}

export interface SizeRange {
  min: Size;
  max: Size;
}

export interface FurnitureRequirement {
  id: string;
  category: Category;
  variant: string | null;
  room_id: string | null;
  count: number;
  required: boolean;
  existing: boolean;
  size: SizeRange | null;
  finish: Finish | null;
  notes: string;
}

export interface Inventory {
  items: FurnitureRequirement[];
  walkway_clearance_m: number;
}

export interface Brief {
  text: string;
  priorities: string[];
  reference_asset_ids: string[];
}

export interface Asset {
  id: string;
  kind: "plan" | "reference";
  original_name: string;
  mime_type: string;
  width_px: number;
  height_px: number;
  source: string;
  url: string;
}

export type ValidationStatus = "valid" | "warnings" | "invalid" | "unchecked";

export interface Issue {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  object_ids: string[];
  check: string;
}

export interface WalkwayResult {
  room_id: string;
  clearance_m: number;
  entrance_id: string | null;
  reachable: number[][][][];
  unreachable: number[][][][];
  unreached_objects: string[];
  unreached_doors: string[];
}

export interface ValidationReport {
  status: ValidationStatus;
  issues: Issue[];
  checks: { id: string; label: string; status: ValidationStatus; count: number }[];
  derived: {
    footprints?: Record<string, number[][]>;
    door_swings?: { room_id: string; id: string; polygon: number[][] }[];
    openings?: { room_id: string; id: string; kind: OpeningKind; a: number[]; b: number[] }[];
    walkway?: WalkwayResult[];
    clearance_m?: number;
  };
}

export type Origin = "ai" | "sample" | "manual" | "import";

export interface AlternativeSummary {
  id: string;
  name: string;
  origin: Origin;
  revision: number;
  validation_status: ValidationStatus;
}

export interface Alternative extends AlternativeSummary {
  scene: Scene;
  validation?: ValidationReport;
  updated_at?: string | null;
  concept?: string;
  repair_rounds?: number;
  notes?: string[];
}

export interface ProjectSummary {
  id: string;
  name: string;
  is_sample: boolean;
  rooms: number;
  confirmed: boolean;
  alternatives: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectDetail extends Omit<ProjectSummary, "alternatives"> {
  geometry: Geometry;
  inventory: Inventory;
  brief: Brief;
  assets: Asset[];
  alternatives: AlternativeSummary[];
}

export interface Revision {
  id: string;
  number: number;
  label: string;
  source: string;
  summary: string;
  validation_status: ValidationStatus;
  created_at: string;
}

export interface SceneDiff {
  added: string[];
  removed: string[];
  changed: Record<string, string[]>;
  lighting_changed: boolean;
  finishes_changed: string[];
}

export interface ChangeProposal {
  id: string;
  status: "pending" | "applied" | "discarded" | "stale";
  source: "ai_edit" | "ai_review";
  base_revision: number;
  operations: Record<string, unknown>[];
  scene: Scene;
  report: ValidationReport & {
    diff: SceneDiff;
    affected_ids: string[];
    rejected: { index: number; op: string; target_id: string; reason: string }[];
    conflicts: string[];
    repair_rounds?: number;
  };
  summary: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  alternative_id: string | null;
  proposal_id: string | null;
  proposal_status: ChangeProposal["status"] | null;
  created_at: string;
}

export interface CatalogVariant {
  id: string;
  label: string;
  default: [number, number, number];
  collision: "floor" | "overlay" | "surface" | "ceiling" | "wall";
}

export interface CatalogCategory {
  id: Category;
  label: string;
  variants: CatalogVariant[];
  min_size: [number, number, number];
  max_size: [number, number, number];
  access_mode: "front" | "perimeter" | "back" | "none";
  access_depth_m: number;
  tuck_m: number;
  default_material: string;
  default_color: string;
  materials: string[];
}

export interface MaterialInfo {
  label: string;
  kind: string;
  color: string;
  roughness: number;
}

export interface Catalog {
  categories: CatalogCategory[];
  materials: Record<string, MaterialInfo>;
  floor_materials: string[];
  wall_materials: string[];
}

export interface AIStatus {
  provider: string;
  model: string;
  configured: boolean;
  test_double: boolean;
}
