import { type MessageKey, type Notice, text } from "./localize.ts";
import { type Action, type Axis, percentage } from "./model.ts";

export type InputMode = "pointer" | "keyboard" | "assistive";
interface Gesture {
  axis: Axis;
  mode: InputMode;
  initial: number | null;
  value: number;
  touched: boolean;
  cancelled: boolean;
  ended: boolean;
}
export interface CommandResult {
  entity: string;
  action: Action;
  status: "accepted" | "failed" | "skipped";
  reason?: Notice;
}

// One gesture lifecycle for single covers and group targets.
export abstract class SliderController {
  protected gesture: Gesture | undefined;
  protected notify: () => void;
  onIntent: (() => void) | undefined;
  requested: { axis: Axis; value: number; id: number } | undefined;

  constructor(notify: () => void = () => {}) {
    this.notify = notify;
  }
  abstract reasonKey(action: Action): MessageKey | null;
  reason(action: Action, language?: string): string | null {
    const key = this.reasonKey(action);
    return key ? text(key, language) : null;
  }
  abstract reported(axis: Axis): number | null;
  abstract perform(action: Action, value?: number): Promise<CommandResult[]>;
  abstract get pending(): boolean;
  abstract get revision(): number;
  abstract get error(): string;
  abstract errorText(language?: string): string;
  abstract stop(): Promise<CommandResult[]>;

  get draft() {
    return this.gesture && !this.gesture.ended && !this.gesture.cancelled
      ? this.gesture
      : undefined;
  }
  value(axis: Axis): number | null {
    if (this.draft?.axis === axis) return this.draft.value;
    if (this.requested?.axis === axis) return this.requested.value;
    return this.reported(axis);
  }
  begin(axis: Axis, mode: InputMode): boolean {
    this.onIntent?.();
    if (this.reason(axis)) return false;
    const initial = this.reported(axis);
    this.gesture = {
      axis,
      mode,
      initial,
      value: initial ?? 0,
      touched: false,
      cancelled: false,
      ended: false,
    };
    this.notify();
    return true;
  }
  input(axis: Axis, value: number) {
    if (
      this.gesture?.axis === axis &&
      this.gesture.cancelled &&
      !this.gesture.ended
    ) {
      this.notify();
      return;
    }
    if (!this.gesture || this.gesture.ended || this.gesture.axis !== axis)
      if (!this.begin(axis, "assistive")) return;
    if (
      this.reason(axis) ||
      percentage(value) === null ||
      !Number.isInteger(value)
    ) {
      this.cancel();
      return;
    }
    if (this.gesture) {
      this.gesture.value = value;
      this.gesture.touched = true;
    }
    this.notify();
  }
  change(axis: Axis, value: number): Promise<void> {
    if (
      this.gesture?.axis === axis &&
      (this.gesture.ended || this.gesture.cancelled)
    ) {
      if (
        this.gesture.cancelled ||
        value === this.gesture.value ||
        value === this.reported(axis)
      )
        return Promise.resolve();
      if (!this.begin(axis, "assistive")) return Promise.resolve();
    }
    this.input(axis, value);
    return this.gesture?.mode === "assistive"
      ? this.finish(axis, "assistive")
      : Promise.resolve();
  }
  async finish(axis: Axis, mode: InputMode): Promise<void> {
    const gesture = this.gesture;
    if (
      !gesture ||
      gesture.axis !== axis ||
      gesture.mode !== mode ||
      gesture.ended
    )
      return;
    gesture.ended = true;
    this.notify();
    if (
      gesture.cancelled ||
      !gesture.touched ||
      gesture.initial === gesture.value
    )
      return;
    await this.perform(axis, gesture.value);
  }
  cancel() {
    if (this.gesture && !this.gesture.ended) this.gesture.cancelled = true;
    this.notify();
  }
  retireGesture() {
    this.gesture = undefined;
    this.notify();
  }
}
