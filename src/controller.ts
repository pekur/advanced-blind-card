import {
  type CommandResult,
  type InputMode,
  SliderController,
} from "./gesture.ts";
import {
  errorNotice,
  MessageError,
  type MessageKey,
  type Notice,
  notice,
  noticeText,
  text,
} from "./localize.ts";
import {
  type Action,
  type Axis,
  actionReasonKey,
  type CoverConfig,
  commandFor,
  type HomeAssistant,
  parseConfig,
  reportedValue,
  type Snapshot,
} from "./model.ts";
import { type Goal, ProgressTracker, type Timing } from "./progress.ts";

export class CoverController extends SliderController {
  readonly progress: ProgressTracker;
  constructor(notify: () => void = () => {}, timing?: Timing) {
    super(notify);
    this.progress = new ProgressTracker(notify, timing);
  }
  private _config: CoverConfig | undefined;
  private _hass: HomeAssistant | undefined;
  private attached = false;
  private requests = new Map<number, "move" | "stop">();
  private sequence = 0;
  private latestRequest = 0;
  private epoch = 0;
  commandVersion = 0;
  private failure: Notice = "";
  private stopFailures: CommandResult[] = [];
  get error() {
    return this.errorText();
  }
  errorText(language?: string) {
    return (
      noticeText(this.failure, language) ||
      this.stopFailures
        .map(
          (r) =>
            `${text(r.action === "stopTilt" ? "tilt" : "position", language)} / ${text("stop", language)}: ${noticeText(r.reason ?? "", language)}`,
        )
        .join(" ")
    );
  }
  get config() {
    return this._config;
  }
  get hass() {
    return this._hass;
  }
  get revision() {
    return this.epoch;
  }
  get pending() {
    return this.requests.size > 0;
  }
  get snapshot(): Snapshot {
    return { config: this._config, hass: this._hass, attached: this.attached };
  }
  configure(value: unknown) {
    this.reset();
    this._config = undefined;
    try {
      const config = parseConfig(value);
      const row = config.rows[0];
      if (config.rows.length !== 1 || row?.kind !== "single")
        throw new MessageError("singleRequired");
      this._config = row;
    } finally {
      this.notify();
    }
  }
  configureCover(config: CoverConfig) {
    this.reset();
    this._config = config;
    this.notify();
  }
  setHass(hass: HomeAssistant) {
    this._hass = hass;
    this.progress.update(this.snapshot);
    if (this.draft && actionReasonKey(this.snapshot, this.draft.axis))
      this.cancel();
    this.notify();
  }
  setAttached(attached: boolean) {
    this.attached = attached;
    if (!attached) this.reset();
    this.notify();
  }
  private reset() {
    this.progress.reset();
    this.epoch++;
    this.commandVersion++;
    this.gesture = undefined;
    this.requests.clear();
    this.requested = undefined;
    this.failure = "";
    this.stopFailures = [];
  }
  reported(axis: Axis) {
    return reportedValue(this.snapshot, axis);
  }
  override begin(axis: Axis, mode: InputMode): boolean {
    // A new member intent supersedes a group start that has not been sent yet.
    this.commandVersion++;
    return super.begin(axis, mode);
  }
  reasonKey(action: Action): MessageKey | null {
    const reason = actionReasonKey(this.snapshot, action);
    if (reason) return reason;
    if (action === "stop" || action === "stopTilt")
      return [...this.requests.values()].includes("stop")
        ? "stopSending"
        : null;
    return this.pending ? "waiting" : null;
  }
  async perform(
    action: Action,
    value?: number,
    guard: () => boolean = () => true,
    coordinated = false,
  ): Promise<CommandResult[]> {
    if (!coordinated) {
      this.commandVersion++;
      this.onIntent?.();
    }
    if (!guard()) return [this.result(action, "skipped", notice("cancelled"))];
    const reason = this.reasonKey(action);
    if (reason) {
      this.failure = notice(reason);
      this.notify();
      return [this.result(action, "skipped", this.failure)];
    }
    const epoch = this.epoch;
    const id = ++this.sequence;
    this.latestRequest = id;
    this.requests.set(id, "move");
    if (this.draft) this.cancel();
    this.failure = "";
    this.stopFailures = [];
    if ((action === "position" || action === "tilt") && value !== undefined)
      this.requested = { axis: action, value, id };
    this.notify();
    const result = this.result(action, "accepted");
    let goal: Goal | undefined;
    try {
      await this.send(action, value, epoch, guard, () => {
        if (action !== "stop" && action !== "stopTilt")
          goal = this.progress.start(id, action, value, this.snapshot);
      });
      if (goal) this.progress.settle(goal);
    } catch (error) {
      result.status = "failed";
      result.reason = errorNotice(error);
      if (goal) this.progress.settle(goal, result.reason);
      if (epoch === this.epoch && id === this.latestRequest)
        this.failure = result.reason;
    } finally {
      if (epoch === this.epoch) {
        this.requests.delete(id);
        if (this.requested?.id === id) this.requested = undefined;
        this.notify();
      }
    }
    return [result];
  }
  async stop(
    guard: () => boolean = () => true,
    coordinated = false,
  ): Promise<CommandResult[]> {
    this.commandVersion++;
    if (!coordinated) this.onIntent?.();
    this.cancel();
    this.requested = undefined;
    const supported = (["stop", "stopTilt"] as const).filter(
      (action) => !this.reason(action),
    );
    if (!guard() || supported.length === 0) {
      this.failure = notice(
        !guard()
          ? "cancelled"
          : (this.reasonKey("stop") ??
              this.reasonKey("stopTilt") ??
              "stopUnavailable"),
      );
      this.notify();
      return [this.result("stop", "skipped", this.failure)];
    }
    const epoch = this.epoch;
    const id = ++this.sequence;
    this.latestRequest = id;
    this.requests.set(id, "stop");
    const stopAttempt = this.progress.interrupt(id, supported);
    this.failure = "";
    this.stopFailures = [];
    const entity = this.config?.entity ?? "";
    this.notify();
    const results = await Promise.all(
      supported.map(async (action) => {
        try {
          await this.send(action, undefined, epoch, guard);
          this.progress.settleStop(stopAttempt, action, false);
          if (epoch === this.epoch) this.notify();
          return { entity, action, status: "accepted" } as CommandResult;
        } catch (error) {
          this.progress.settleStop(stopAttempt, action, true);
          if (epoch === this.epoch) this.notify();
          return {
            entity,
            action,
            status: "failed",
            reason: errorNotice(error),
          } as CommandResult;
        }
      }),
    );
    if (epoch === this.epoch) {
      this.requests.delete(id);
      if (id === this.latestRequest)
        this.stopFailures = results.filter((r) => r.status === "failed");
      this.notify();
    }
    return results;
  }
  private result(
    action: Action,
    status: CommandResult["status"],
    reason?: Notice,
  ): CommandResult {
    return {
      entity: this.config?.entity ?? "",
      action,
      status,
      ...(reason ? { reason } : {}),
    };
  }
  private async send(
    action: Action,
    value: number | undefined,
    epoch: number,
    guard: () => boolean,
    onDispatch?: () => void,
  ) {
    if (epoch !== this.epoch || !guard()) throw new MessageError("changed");
    const snapshot = this.snapshot;
    const command = commandFor(snapshot, action, value);
    if (!snapshot.hass) throw new MessageError("haDisconnected");
    onDispatch?.();
    await snapshot.hass.callService(
      "cover",
      command.service,
      command.data,
      command.target,
    );
  }
}
