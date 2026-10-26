import type { CoverController } from "./controller.ts";
import {
  type CommandResult,
  type InputMode,
  SliderController,
} from "./gesture.ts";
import {
  type MessageKey,
  type Notice,
  notice,
  noticeText,
  stateText,
  text,
} from "./localize.ts";
import { type Action, type Axis, entityFor, supports } from "./model.ts";
import type { Goal, ProgressStatus, StopAttempt } from "./progress.ts";

interface MemberProgress {
  member: CoverController;
  goal?: Goal;
  skipped?: Notice;
}
interface GroupProgress {
  target?: number;
  members: MemberProgress[];
}

export interface Aggregate {
  value: number | null;
  text: string;
}

export class GroupController extends SliderController {
  readonly members: readonly CoverController[];
  private epoch = 0;
  private operation = 0;
  private gestureEligibility: string | undefined;
  results: CommandResult[] = [];
  private goals = new Map<Axis, GroupProgress>();
  private stops: { member: CoverController; attempt?: StopAttempt }[] = [];
  individualProgressFor(axis: Axis): {
    entity: string;
    reported: number | null;
    status: ProgressStatus;
  }[] {
    const group = this.goals.get(axis);
    return this.members.flatMap((member) => {
      const goal = member.progress.get(axis);
      if (
        !goal ||
        group?.members.some(
          (entry) => entry.member === member && entry.goal === goal,
        )
      )
        return [];
      const status = member.progress.status(axis);
      return status
        ? [
            {
              entity: member.config?.entity ?? "",
              reported: member.reported(axis),
              status,
            },
          ]
        : [];
    });
  }
  progressFor(
    axis: Axis,
  ):
    | { target?: number; members: { entity: string; status: ProgressStatus }[] }
    | undefined {
    const group = this.goals.get(axis);
    if (!group) return undefined;
    return {
      target: group.target,
      members: group.members.map(({ member, goal, skipped }) => ({
        entity: member.config?.entity ?? "",
        status:
          skipped || !goal
            ? { code: "skipped", reason: skipped }
            : member.progress.get(axis) !== goal
              ? { code: "replaced", target: member.progress.get(axis)?.target }
              : (member.progress.status(axis) ?? { code: "skipped" }),
      })),
    };
  }
  stopProgress() {
    return this.stops.map(({ member, attempt }) => ({
      entity: member.config?.entity ?? "",
      failed:
        member.progress.stopAttempt === attempt && member.progress.stopFailed(),
      status: !attempt
        ? "skipped"
        : member.progress.stopAttempt !== attempt
          ? "replaced"
          : (member.progress.stopStatus() ?? "skipped"),
    }));
  }
  constructor(
    members: readonly CoverController[],
    notify: () => void = () => {},
  ) {
    super(notify);
    this.members = members;
    for (const member of members)
      member.onIntent = () => {
        this.cancel();
        this.notify();
      };
  }
  get revision() {
    return this.epoch;
  }
  get pending() {
    return this.members.some((member) => member.pending);
  }
  get error() {
    return this.errorText();
  }
  errorText(language?: string) {
    return this.results
      .filter((r) => r.status !== "accepted")
      .map(
        (r) =>
          `${r.entity} (${text(r.action === "stopTilt" ? "stop" : r.action, language)}): ${noticeText(r.reason ?? "", language)}`,
      )
      .join(" ");
  }
  aggregate(axis: Axis, language?: string, compact = false): Aggregate {
    const values: number[] = [];
    let unavailable = 0,
      unknown = 0,
      unsupported = 0;
    for (const member of this.members) {
      const entity = entityFor(member.snapshot);
      if (!member.hass?.connected || !entity || entity.state === "unavailable")
        unavailable++;
      else {
        const value = member.reported(axis);
        if (
          !["open", "closed", "opening", "closing"].includes(entity.state) ||
          value === null
        )
          unknown++;
        else values.push(value);
        if (!supports(member.snapshot, axis)) unsupported++;
      }
    }
    const min = values.length ? Math.min(...values) : null;
    const max = values.length ? Math.max(...values) : null;
    const value =
      min !== null && min === max && values.length === this.members.length
        ? min
        : null;
    const range =
      min === null
        ? text("unknown", language)
        : min === max
          ? `${min}%`
          : `${min}–${max}%`;
    const notes = [
      unknown && text("unknownCount", language, { count: unknown }),
      unavailable && text("unavailableCount", language, { count: unavailable }),
      unsupported && text("unsupportedCount", language, { count: unsupported }),
    ].filter(Boolean);
    return {
      value,
      text: compact
        ? `${range}${min !== null && (unknown || unavailable) ? " + ?" : ""}`
        : [range, ...notes].join(" · "),
    };
  }
  reported(axis: Axis) {
    return this.aggregate(axis).value;
  }
  state(language?: string): string {
    const counts = new Map<string, number>();
    for (const member of this.members) {
      const entity = entityFor(member.snapshot);
      const state = !member.hass?.connected
        ? text("disconnected", language)
        : !entity
          ? text("missing", language)
          : (member.hass.formatEntityState?.(entity) ??
            stateText(entity.state, language));
      counts.set(state, (counts.get(state) ?? 0) + 1);
    }
    return [...counts].map(([state, count]) => `${count} ${state}`).join(" · ");
  }
  eligibility(action: Action): string {
    return this.members
      .map(
        (member) =>
          `${member.config?.entity}: ${member.reasonKey(action) ?? "ready"}`,
      )
      .join("; ");
  }
  coverage(action: Action, language?: string): string {
    const eligible = this.members.filter(
      (member) => !member.reason(action),
    ).length;
    const skipped = this.members
      .filter((member) => member.reason(action))
      .map(
        (member) =>
          `${member.config?.name ?? member.config?.entity}: ${member.reason(action, language)}`,
      );
    return [
      text("coverage", language, { eligible, total: this.members.length }),
      ...skipped,
    ].join(". ");
  }
  reasonKey(action: Action): MessageKey | null {
    const stopping = action === "stop" || action === "stopTilt";
    if (!stopping && this.pending) return "groupWaiting";
    return this.members.some((member) => !member.reason(action))
      ? null
      : "noMembers";
  }
  override begin(axis: Axis, mode: InputMode): boolean {
    for (const member of this.members) member.cancel();
    if (!super.begin(axis, mode)) return false;
    this.gestureEligibility = this.eligibility(axis);
    return true;
  }
  refresh() {
    if (
      this.draft &&
      this.eligibility(this.draft.axis) !== this.gestureEligibility
    )
      this.cancel();
    this.notify();
  }
  override finish(axis: Axis, mode: InputMode): Promise<void> {
    if (
      this.draft?.axis === axis &&
      this.draft.mode === mode &&
      this.eligibility(axis) !== this.gestureEligibility
    )
      this.cancel();
    return super.finish(axis, mode);
  }
  dispose() {
    this.epoch++;
    this.operation++;
    this.cancel();
    this.retireGesture();
    this.requested = undefined;
    this.goals.clear();
    this.stops = [];
  }
  async perform(action: Action, value?: number): Promise<CommandResult[]> {
    this.onIntent?.();
    if (this.draft) this.cancel();
    const axis = action === "tilt" ? "tilt" : "position";
    const attempt: GroupProgress = {
      target: action === "open" ? 100 : action === "close" ? 0 : value,
      members: this.members.map((member) => ({ member })),
    };
    const key = this.reasonKey(action);
    const reason = key ? notice(key) : null;
    if (reason) {
      for (const entry of attempt.members) entry.skipped = reason;
      if (!this.goals.has(axis)) this.goals.set(axis, attempt);
      this.results = this.members.map((member) => ({
        entity: member.config?.entity ?? "",
        action,
        status: "skipped",
        reason,
      }));
      this.notify();
      return this.results;
    }
    this.goals.set(axis, attempt);
    this.stops = [];
    const operation = ++this.operation;
    const epoch = this.epoch;
    const snapshot = this.members.map((member) => ({
      member,
      reason: member.reasonKey(action),
      version: member.commandVersion,
      revision: member.revision,
    }));
    for (const { member } of snapshot) member.cancel();
    this.results = [];
    if ((action === "position" || action === "tilt") && value !== undefined)
      this.requested = { axis: action, value, id: operation };
    const results = (
      await Promise.all(
        snapshot.map(({ member, reason, version, revision }, index) => {
          const entry = attempt.members[index];
          const guard = () =>
            epoch === this.epoch &&
            operation === this.operation &&
            member.commandVersion === version &&
            member.revision === revision;
          if (reason) {
            if (entry) entry.skipped = notice(reason);
            return Promise.resolve<CommandResult[]>([
              {
                entity: member.config?.entity ?? "",
                action,
                status: "skipped",
                reason: notice(reason),
              },
            ]);
          }
          const previous = member.progress.get(axis);
          const response = member.perform(action, value, guard, true);
          const goal = member.progress.get(axis);
          if (entry) {
            if (goal !== previous) entry.goal = goal;
            else entry.skipped = notice("notDispatched");
          }
          return response;
        }),
      )
    ).flat();
    if (epoch === this.epoch && operation === this.operation) {
      this.results = results;
      if (this.requested?.id === operation) this.requested = undefined;
      this.notify();
    }
    return results;
  }
  async stop(): Promise<CommandResult[]> {
    this.onIntent?.();
    const operation = ++this.operation;
    const epoch = this.epoch;
    this.cancel();
    this.requested = undefined;
    this.results = [];
    this.stops = [];
    for (const member of this.members) member.cancel();
    const snapshot = this.members.map((member) => ({
      member,
      revision: member.revision,
    }));
    const results = (
      await Promise.all(
        snapshot.map(({ member, revision }) => {
          const previous = member.progress.stopAttempt;
          const response = member.stop(
            () =>
              epoch === this.epoch &&
              operation === this.operation &&
              member.revision === revision,
            true,
          );
          const attempt = member.progress.stopAttempt;
          this.stops.push({
            member,
            attempt: attempt !== previous ? attempt : undefined,
          });
          return response;
        }),
      )
    ).flat();
    if (epoch === this.epoch && operation === this.operation) {
      this.results = results;
      this.notify();
    }
    return results;
  }
}
