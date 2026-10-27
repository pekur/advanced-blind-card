import { MessageError, type MessageKey, text } from "./localize.ts";

export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_updated?: string;
}

export interface HomeAssistant {
  connected: boolean;
  language?: string;
  states: Record<string, HassEntity | undefined>;
  services: Record<string, Record<string, unknown> | undefined>;
  callService(
    domain: string,
    service: string,
    data: Record<string, unknown>,
    target: { entity_id: string },
  ): Promise<unknown>;
  formatEntityState?(entity: HassEntity): string;
  formatEntityName?(entity: HassEntity): string;
}

export interface TiltVisual {
  readonly mode: "single" | "bidirectional";
  readonly minAngle: number;
  readonly maxAngle: number;
  readonly invert: boolean;
}
export const defaultTiltVisual: TiltVisual = Object.freeze({
  mode: "single",
  minAngle: -90,
  maxAngle: 0,
  invert: false,
});
export interface RowSettings {
  readonly layout: "detailed" | "inline";
  readonly showButtons: boolean;
  readonly showName: boolean;
  readonly showState: boolean;
  readonly showValues: boolean;
  readonly positionStep: number;
  readonly tiltStep: number;
  readonly tiltVisual: TiltVisual;
}
export const sliderSteps = Object.freeze([1, 2, 4, 5, 10, 20, 25, 50, 100]);
// Only target selection uses this grid; HA readings and service payloads do not.
export function snapTarget(value: number, step: number): number {
  return Math.round(value / step) * step;
}
export interface CoverConfig extends RowSettings {
  readonly entity: string;
  readonly name?: string;
}

export interface SingleRow extends CoverConfig {
  readonly kind: "single";
}
export interface GroupRow extends RowSettings {
  readonly kind: "group";
  readonly name?: string;
  readonly members: readonly CoverConfig[];
  readonly expandable: boolean;
}
export type RowConfig = SingleRow | GroupRow;
export interface CardConfig extends RowSettings {
  readonly rows: readonly RowConfig[];
}

export type Axis = "position" | "tilt";
export type Action = Axis | "open" | "close" | "stop" | "stopTilt";
export interface Snapshot {
  config: CoverConfig | undefined;
  hass: HomeAssistant | undefined;
  attached: boolean;
}

const actions = {
  position: { feature: 4, service: "set_cover_position" },
  tilt: { feature: 128, service: "set_cover_tilt_position" },
  open: { feature: 1, service: "open_cover" },
  close: { feature: 2, service: "close_cover" },
  stop: { feature: 8, service: "stop_cover" },
  stopTilt: { feature: 64, service: "stop_cover_tilt" },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const booleanOptions = {
  show_buttons: "showButtons",
  show_name: "showName",
  show_state: "showState",
  show_values: "showValues",
} as const;
const stepOptions = {
  position_step: "positionStep",
  tilt_step: "tiltStep",
} as const;
const optionKeys = [
  ...Object.keys(booleanOptions),
  ...Object.keys(stepOptions),
  "tilt_visual",
  "layout",
];
type ExplicitSettings = {
  -readonly [K in Exclude<keyof RowSettings, "tiltVisual">]?: RowSettings[K];
} & {
  tiltVisual: { -readonly [K in keyof TiltVisual]?: TiltVisual[K] };
};
function settingsFor(
  value: Record<string, unknown>,
  parent: ExplicitSettings,
  path: string,
): { explicit: ExplicitSettings; resolved: RowSettings } {
  const explicit: ExplicitSettings = {
    ...parent,
    tiltVisual: { ...parent.tiltVisual },
  };
  if (value.layout !== undefined) {
    if (value.layout !== "detailed" && value.layout !== "inline")
      throw new MessageError("layoutInvalid", { path: `${path}.layout` });
    explicit.layout = value.layout;
  }
  for (const [key, field] of Object.entries(booleanOptions)) {
    const raw = value[key];
    if (raw === undefined) continue;
    if (typeof raw !== "boolean")
      throw new MessageError("boolean", { path: `${path}.${key}` });
    explicit[field] = raw;
  }
  for (const [key, field] of Object.entries(stepOptions)) {
    const raw = value[key];
    if (raw === undefined) continue;
    if (typeof raw !== "number" || !sliderSteps.includes(raw))
      throw new MessageError("stepInvalid", { path: `${path}.${key}` });
    explicit[field] = raw;
  }
  const visual = value.tilt_visual;
  if (visual !== undefined) {
    const visualPath = `${path}.tilt_visual`;
    if (!isRecord(visual))
      throw new MessageError("object", { path: visualPath });
    for (const key of Object.keys(visual))
      if (!["mode", "min_angle", "max_angle", "invert"].includes(key))
        throw new MessageError("option", { path: visualPath, key });
    if (visual.mode !== undefined) {
      if (visual.mode !== "single" && visual.mode !== "bidirectional")
        throw new MessageError("mode", { path: visualPath });
      explicit.tiltVisual.mode = visual.mode;
    }
    for (const [key, field] of [
      ["min_angle", "minAngle"],
      ["max_angle", "maxAngle"],
    ] as const) {
      const raw = visual[key];
      if (raw === undefined) continue;
      if (
        typeof raw !== "number" ||
        !Number.isFinite(raw) ||
        raw < -90 ||
        raw > 90
      )
        throw new MessageError("angle", { path: `${visualPath}.${key}` });
      explicit.tiltVisual[field] = raw;
    }
    if (visual.invert !== undefined) {
      if (typeof visual.invert !== "boolean")
        throw new MessageError("boolean", { path: `${visualPath}.invert` });
      explicit.tiltVisual.invert = visual.invert;
    }
  }
  const mode = explicit.tiltVisual.mode ?? "single";
  const minAngle = explicit.tiltVisual.minAngle ?? -90;
  const maxAngle = explicit.tiltVisual.maxAngle ?? (mode === "single" ? 0 : 90);
  if (minAngle >= maxAngle) throw new MessageError("bounds", { path });
  return {
    explicit,
    resolved: Object.freeze({
      layout: explicit.layout ?? "detailed",
      showButtons: explicit.showButtons ?? true,
      showName: explicit.showName ?? true,
      showState: explicit.showState ?? true,
      showValues: explicit.showValues ?? true,
      positionStep: explicit.positionStep ?? 10,
      tiltStep: explicit.tiltStep ?? 10,
      tiltVisual: Object.freeze({
        mode,
        minAngle,
        maxAngle,
        invert: explicit.tiltVisual.invert ?? false,
      }),
    }),
  };
}

export function parseConfig(value: unknown): CardConfig {
  if (!isRecord(value) || value.type !== "custom:advanced-blind-card") {
    throw new MessageError("type");
  }
  const allowed = new Set([
    "type",
    "blinds",
    ...optionKeys,
    "view_layout",
    "grid_options",
    "layout_options",
    "visibility",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key))
      throw new MessageError("option", { path: "card", key });
  }
  if (!Array.isArray(value.blinds) || value.blinds.length === 0)
    throw new MessageError("rows");
  const root = settingsFor(value, { tiltVisual: {} }, "card");
  const seen = new Set<string>();
  const nameFor = (row: Record<string, unknown>, path: string) => {
    if (row.name === undefined) return {};
    if (typeof row.name !== "string" || !row.name.trim())
      throw new MessageError("name", { path });
    return { name: row.name.trim() };
  };
  const coverFor = (
    row: unknown,
    path: string,
    parent: ExplicitSettings,
  ): CoverConfig => {
    if (!isRecord(row)) throw new MessageError("object", { path });
    for (const key of Object.keys(row))
      if (key !== "entity" && key !== "name" && !optionKeys.includes(key))
        throw new MessageError("option", { path, key });
    if (
      typeof row.entity !== "string" ||
      !/^cover\.[a-z0-9_]+$/.test(row.entity)
    )
      throw new MessageError("entity", { path });
    if (seen.has(row.entity))
      throw new MessageError("duplicate", { path, entity: row.entity });
    seen.add(row.entity);
    return Object.freeze({
      entity: row.entity,
      ...nameFor(row, path),
      ...settingsFor(row, parent, path).resolved,
    });
  };
  const rows = value.blinds.map((row: unknown, index: number): RowConfig => {
    const path = `blinds[${index}]`;
    if (!isRecord(row)) throw new MessageError("object", { path });
    if (Object.hasOwn(row, "entity") && Object.hasOwn(row, "entities"))
      throw new MessageError("both", { path });
    if (!Object.hasOwn(row, "entities"))
      return Object.freeze({
        kind: "single",
        ...coverFor(row, path, root.explicit),
      });
    for (const key of Object.keys(row))
      if (!["entities", "name", "expandable", ...optionKeys].includes(key))
        throw new MessageError("option", { path, key });
    if (!Array.isArray(row.entities) || row.entities.length < 2)
      throw new MessageError("members", { path });
    if (row.expandable !== undefined && typeof row.expandable !== "boolean")
      throw new MessageError("boolean", { path: `${path}.expandable` });
    const settings = settingsFor(row, root.explicit, path);
    return Object.freeze({
      kind: "group",
      ...settings.resolved,
      ...nameFor(row, path),
      expandable: row.expandable !== false,
      members: Object.freeze(
        row.entities.map((member, memberIndex) =>
          coverFor(
            member,
            `${path}.entities[${memberIndex}]`,
            settings.explicit,
          ),
        ),
      ),
    });
  });
  return Object.freeze({ rows: Object.freeze(rows), ...root.resolved });
}

export function supports(snapshot: Snapshot, action: Action): boolean {
  const features = entityFor(snapshot)?.attributes.supported_features;
  return (
    typeof features === "number" &&
    Number.isSafeInteger(features) &&
    features >= 0 &&
    (features & actions[action].feature) !== 0
  );
}

export function percentage(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100
    ? value
    : null;
}

export function entityFor({ hass, config }: Snapshot): HassEntity | undefined {
  return config ? hass?.states[config.entity] : undefined;
}

export function reportedValue(snapshot: Snapshot, axis: Axis): number | null {
  return percentage(
    entityFor(snapshot)?.attributes[
      axis === "position" ? "current_position" : "current_tilt_position"
    ],
  );
}

export function actionReason(
  snapshot: Snapshot,
  action: Action,
  language?: string,
): string | null {
  const key = actionReasonKey(snapshot, action);
  return key ? text(key, language) : null;
}
export function actionReasonKey(
  snapshot: Snapshot,
  action: Action,
): MessageKey | null {
  const { hass, config, attached } = snapshot;
  if (!config) return "notConfigured";
  if (!attached) return "notAttached";
  if (!hass?.connected) return "haDisconnected";
  const entity = entityFor(snapshot);
  if (!entity) return "entityMissing";
  if (entity.state === "unavailable") return "entityUnavailable";
  const stopping = action === "stop" || action === "stopTilt";
  if (
    !stopping &&
    !["open", "closed", "opening", "closing"].includes(entity.state)
  ) {
    return "stateUnknown";
  }
  const features = entity.attributes.supported_features;
  if (
    typeof features !== "number" ||
    !Number.isSafeInteger(features) ||
    features < 0 ||
    (features & actions[action].feature) === 0
  ) {
    return "unsupported";
  }
  if (
    !Object.hasOwn(hass.services.cover ?? {}, actions[action].service) ||
    hass.services.cover?.[actions[action].service] == null
  ) {
    return "serviceUnavailable";
  }
  if (
    (action === "position" || action === "tilt") &&
    reportedValue(snapshot, action) === null
  ) {
    return "valueUnknown";
  }
  return null;
}

export function commandFor(snapshot: Snapshot, action: Action, value?: number) {
  const reason = actionReasonKey(snapshot, action);
  if (reason) throw new MessageError(reason);
  const data: Record<string, unknown> = {};
  if (action === "position" || action === "tilt") {
    if (percentage(value) === null || !Number.isInteger(value)) {
      throw new MessageError("targetInvalid");
    }
    data[action === "position" ? "position" : "tilt_position"] = value;
  }
  if (!snapshot.config) throw new MessageError("notConfigured");
  return {
    service: actions[action].service,
    data,
    target: { entity_id: snapshot.config.entity },
  };
}

export function tiltRotation(
  value: unknown,
  visual: TiltVisual = defaultTiltVisual,
): number | null {
  const valid = percentage(value);
  if (valid === null) return null;
  const t = visual.invert ? 1 - valid / 100 : valid / 100;
  return 90 + visual.minAngle + (visual.maxAngle - visual.minAngle) * t;
}

export function sharedTiltVisual(
  visuals: readonly TiltVisual[],
): TiltVisual | null {
  const first = visuals[0];
  if (!first) return null;
  return visuals.every(
    (visual) =>
      tiltRotation(0, visual) === tiltRotation(0, first) &&
      tiltRotation(100, visual) === tiltRotation(100, first),
  )
    ? first
    : null;
}
