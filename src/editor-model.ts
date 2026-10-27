import { errorNotice, MessageError, type Notice } from "./localize.ts";
import { parseConfig } from "./model.ts";

export type EditorField =
  | "layout"
  | "show_buttons"
  | "show_name"
  | "show_state"
  | "show_values"
  | "position_step"
  | "tilt_step"
  | "mode"
  | "invert"
  | "min_angle"
  | "max_angle";
const globalFields = new Set([
  "layout",
  "show_buttons",
  "show_name",
  "show_state",
  "show_values",
  "position_step",
  "tilt_step",
]);
const numericFields = ["min_angle", "max_angle"] as const;

// Keeps the original YAML shape and local invalid drafts out of HA's config.
export class ConfigDraft {
  private raw: Record<string, unknown> = {};
  private numbers: Partial<Record<(typeof numericFields)[number], string>> = {};
  private emitted = "";
  private pending = new Set<string>();
  editable = false;
  error: Notice = "";
  setConfig(value: unknown) {
    // HA echoes valid changes. Keep any newer local invalid edit on that echo.
    const encoded = JSON.stringify(value);
    const echoed = this.pending.delete(encoded);
    if (this.editable && (echoed || encoded === this.emitted)) return;
    this.pending.clear();
    this.editable = false;
    this.raw = {};
    this.numbers = {};
    this.error = "";
    try {
      parseConfig(value);
      this.raw = structuredClone(value) as Record<string, unknown>;
      this.emitted = JSON.stringify(value);
      this.editable = true;
    } catch (error) {
      this.error = errorNotice(error);
    }
  }
  value(field: EditorField): string {
    const visual = this.raw.tilt_visual as Record<string, unknown> | undefined;
    if (field === "min_angle" || field === "max_angle")
      return this.numbers[field] ?? String(visual?.[field] ?? "");
    return String(
      (globalFields.has(field) ? this.raw[field] : visual?.[field]) ?? "",
    );
  }
  update(
    field: EditorField,
    value: string,
  ): Record<string, unknown> | undefined {
    if (!this.editable) return;
    if (field === "min_angle" || field === "max_angle")
      this.numbers[field] = value;
    else {
      // YAML aliases may share this object with row/member overrides or metadata.
      if (!globalFields.has(field))
        this.raw.tilt_visual = {
          ...((this.raw.tilt_visual ?? {}) as Record<string, unknown>),
        };
      const target = globalFields.has(field)
        ? this.raw
        : (this.raw.tilt_visual as Record<string, unknown>);
      if (value === "") delete target[field];
      else if (field === "position_step" || field === "tilt_step")
        target[field] = Number(value);
      else if (field === "mode" || field === "layout") target[field] = value;
      else
        target[field] =
          value === "true" ? true : value === "false" ? false : value;
    }
    try {
      const next = structuredClone(this.raw);
      const visual = {
        ...((next.tilt_visual ?? {}) as Record<string, unknown>),
      };
      for (const key of numericFields) {
        const draft = this.numbers[key];
        if (draft === undefined) continue;
        if (!draft.trim()) delete visual[key];
        else {
          if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(draft.trim()))
            throw new MessageError("numeric", {
              path: `card.tilt_visual.${key}`,
            });
          visual[key] = Number(draft);
        }
      }
      if (Object.keys(visual).length) next.tilt_visual = visual;
      else delete next.tilt_visual;
      parseConfig(next);
      this.error = "";
      const encoded = JSON.stringify(next);
      if (encoded === this.emitted) return;
      this.emitted = encoded;
      this.pending.add(encoded);
      return next;
    } catch (error) {
      this.error = errorNotice(error);
      return;
    }
  }
}
