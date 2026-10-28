import { languageCode, type Notice } from "./localize.ts";
import {
  type Action,
  type Axis,
  entityFor,
  reportedValue,
  type Snapshot,
  supports,
} from "./model.ts";

export const CONFIRMATION_MS = 120_000;
export const NEAR_POINTS = 2;
export const STABLE_MS = 2_000;
export type ProgressCode =
  | "sending"
  | "waiting"
  | "moving"
  | "reached"
  | "already"
  | "near"
  | "tolerated"
  | "unconfirmed"
  | "interrupted"
  | "failed"
  | "unknown"
  | "unavailable"
  | "unsupported"
  | "replaced"
  | "skipped";
export interface ProgressStatus {
  code: ProgressCode;
  target?: number;
  historical?: boolean;
  pending?: boolean;
  reason?: Notice;
}
interface Observation {
  value: number | null;
  state: string;
  problem?: "unknown" | "unavailable" | "unsupported";
  stamp?: string;
}
export interface Goal {
  readonly id: number;
  readonly axis: Axis;
  readonly action: Action;
  readonly target: number;
  readonly started: number;
  readonly initial: Observation;
  last: Observation;
  observed: boolean;
  axisObserved?: boolean;
  departed?: boolean;
  transport: "sending" | "accepted" | "failed";
  terminal?: "reached" | "already" | "tolerated" | "interrupted";
  stableSince?: number;
  historical?: boolean;
  reason?: Notice;
}
export interface StopAttempt {
  readonly id: number;
  readonly started: number;
  channels: Partial<
    Record<"stop" | "stopTilt", "sending" | "accepted" | "failed">
  >;
}
export interface Timing {
  now(): number;
  schedule(callback: () => void, delay: number): () => void;
}
const timing: Timing = {
  now: () => performance.now(),
  schedule(callback, delay) {
    const handle = setTimeout(callback, delay);
    // Node's existing controller tests must not wait for UI-only deadlines.
    (handle as unknown as { unref?: () => void }).unref?.();
    return () => clearTimeout(handle);
  },
};
function observe(
  snapshot: Snapshot,
  axis: Axis,
  action: Action = axis,
): Observation {
  const entity = entityFor(snapshot);
  const problem =
    !snapshot.hass?.connected || !entity || entity.state === "unavailable"
      ? "unavailable"
      : !["open", "closed", "opening", "closing"].includes(entity.state)
        ? "unknown"
        : !supports(snapshot, action)
          ? "unsupported"
          : reportedValue(snapshot, axis) === null
            ? "unknown"
            : undefined;
  const stamp = entity?.last_updated;
  return {
    value: reportedValue(snapshot, axis),
    state: entity?.state ?? "missing",
    problem,
    stamp:
      typeof stamp === "string" && Number.isFinite(Date.parse(stamp))
        ? stamp
        : undefined,
  };
}
function moving(observation: Observation) {
  return observation.state === "opening" || observation.state === "closing";
}
function changed(a: Observation, b: Observation) {
  return (
    a.value !== b.value ||
    a.state !== b.state ||
    a.problem !== b.problem ||
    a.stamp !== b.stamp
  );
}
function complete(goal: Goal, now: number) {
  if (
    goal.terminal ||
    goal.transport !== "accepted" ||
    goal.last.problem ||
    moving(goal.last)
  )
    return;
  if (goal.last.value === goal.target) {
    if (
      !goal.departed &&
      !goal.initial.problem &&
      goal.initial.value === goal.target &&
      !moving(goal.initial)
    )
      goal.terminal = "already";
    else if (goal.observed) goal.terminal = "reached";
  } else if (
    goal.stableSince !== undefined &&
    now - goal.stableSince >= STABLE_MS &&
    goal.last.value !== null &&
    Math.abs(goal.last.value - goal.target) <= NEAR_POINTS
  )
    goal.terminal = "tolerated";
}

// Observation only: no service calls, gesture changes, polling, retries or persistence.
export class ProgressTracker {
  private goals: Partial<Record<Axis, Goal>> = {};
  private cancelTimer: (() => void) | undefined;
  stopAttempt: StopAttempt | undefined;
  private notify: () => void;
  private clock: Timing;
  constructor(notify: () => void, clock: Timing = timing) {
    this.notify = notify;
    this.clock = clock;
  }
  get(axis: Axis) {
    return this.goals[axis];
  }
  start(
    id: number,
    action: Action,
    value: number | undefined,
    snapshot: Snapshot,
  ) {
    const axis = action === "tilt" ? "tilt" : "position";
    const initial = observe(snapshot, axis, action);
    const goal: Goal = {
      id,
      axis,
      action,
      target:
        action === "open" ? 100 : action === "close" ? 0 : (value as number),
      started: this.clock.now(),
      initial,
      last: initial,
      observed: false,
      transport: "sending",
    };
    this.goals[axis] = goal;
    this.stopAttempt = undefined;
    this.arm();
    return goal;
  }
  update(snapshot: Snapshot) {
    for (const axis of ["position", "tilt"] as const) {
      const goal = this.goals[axis];
      if (!goal) continue;
      const next = observe(snapshot, axis, goal.action);
      const relevantChange =
        next.value !== goal.last.value ||
        next.state !== goal.last.state ||
        next.problem !== goal.last.problem;
      if (changed(goal.last, next)) goal.observed = true;
      if (next.problem) goal.axisObserved = false;
      if (
        next.value !== goal.last.value &&
        next.value !== null &&
        !next.problem
      )
        goal.axisObserved = true;
      if (relevantChange) {
        const freshAxis =
          next.value !== goal.last.value ||
          (goal.axisObserved && next.state !== goal.last.state);
        goal.stableSince =
          freshAxis &&
          !next.problem &&
          !moving(next) &&
          next.value !== null &&
          Math.abs(next.value - goal.target) <= NEAR_POINTS
            ? this.clock.now()
            : undefined;
      }
      if (!next.problem && (next.value !== goal.target || moving(next)))
        goal.departed = true;
      if (
        (goal.terminal === "reached" ||
          goal.terminal === "already" ||
          goal.terminal === "tolerated") &&
        (next.problem ||
          moving(next) ||
          next.value === null ||
          (goal.terminal === "tolerated"
            ? Math.abs(next.value - goal.target) > NEAR_POINTS
            : next.value !== goal.target))
      )
        goal.historical = true;
      goal.last = next;
      if (
        goal.terminal === "tolerated" &&
        !goal.historical &&
        !next.problem &&
        !moving(next) &&
        next.value === goal.target
      )
        goal.terminal = "reached";
      complete(goal, this.clock.now());
    }
    this.arm();
  }
  settle(goal: Goal, failed?: Notice) {
    if (this.goals[goal.axis] !== goal) return;
    goal.transport = failed === undefined ? "accepted" : "failed";
    goal.reason = failed;
    complete(goal, this.clock.now());
    this.arm();
  }
  interrupt(id: number, channels: readonly ("stop" | "stopTilt")[]) {
    for (const goal of Object.values(this.goals))
      if (!goal.terminal && goal.transport !== "failed")
        goal.terminal = "interrupted";
    this.stopAttempt = {
      id,
      started: this.clock.now(),
      channels: Object.fromEntries(
        channels.map((channel) => [channel, "sending"]),
      ),
    };
    this.arm();
    return this.stopAttempt;
  }
  settleStop(
    attempt: StopAttempt,
    channel: "stop" | "stopTilt",
    failed: boolean,
  ) {
    if (this.stopAttempt !== attempt) return;
    attempt.channels[channel] = failed ? "failed" : "accepted";
    this.arm();
  }
  status(axis: Axis): ProgressStatus | undefined {
    const goal = this.goals[axis];
    if (!goal) return undefined;
    const base = {
      target: goal.target,
      pending: goal.transport === "sending",
      historical: goal.historical,
      reason: goal.reason,
    };
    if (goal.terminal) return { ...base, code: goal.terminal };
    if (goal.transport === "failed") return { ...base, code: "failed" };
    const expired = this.clock.now() - goal.started >= CONFIRMATION_MS;
    if (goal.transport === "sending")
      return { ...base, code: expired ? "unconfirmed" : "sending" };
    if (goal.last.problem) return { ...base, code: goal.last.problem };
    if (
      !moving(goal.last) &&
      goal.stableSince !== undefined &&
      goal.last.value !== null &&
      Math.abs(goal.last.value - goal.target) <= NEAR_POINTS
    )
      return { ...base, code: "near" };
    if (expired) return { ...base, code: "unconfirmed" };
    return {
      ...base,
      code:
        goal.axis === "position" && moving(goal.last) ? "moving" : "waiting",
    };
  }
  stopStatus(): "sending" | "accepted" | "failed" | "unconfirmed" | undefined {
    if (!this.stopAttempt) return undefined;
    const values = Object.values(this.stopAttempt.channels);
    if (values.includes("sending"))
      return this.clock.now() - this.stopAttempt.started >= CONFIRMATION_MS
        ? "unconfirmed"
        : "sending";
    return values.includes("failed") ? "failed" : "accepted";
  }
  stopFailed() {
    return (
      this.stopAttempt !== undefined &&
      Object.values(this.stopAttempt.channels).includes("failed")
    );
  }
  reset() {
    this.cancelTimer?.();
    this.cancelTimer = undefined;
    this.goals = {};
    this.stopAttempt = undefined;
  }
  private arm() {
    this.cancelTimer?.();
    this.cancelTimer = undefined;
    const now = this.clock.now();
    const deadlines = Object.values(this.goals)
      .filter((goal) => !goal.terminal && goal.transport !== "failed")
      .map((goal) => goal.started + CONFIRMATION_MS);
    for (const goal of Object.values(this.goals))
      if (
        !goal.terminal &&
        goal.transport === "accepted" &&
        goal.stableSince !== undefined
      )
        deadlines.push(goal.stableSince + STABLE_MS);
    if (
      this.stopAttempt &&
      Object.values(this.stopAttempt.channels).includes("sending")
    )
      deadlines.push(this.stopAttempt.started + CONFIRMATION_MS);
    const future = deadlines.filter((deadline) => deadline > now);
    if (future.length)
      this.cancelTimer = this.clock.schedule(
        () => {
          this.cancelTimer = undefined;
          for (const goal of Object.values(this.goals))
            complete(goal, this.clock.now());
          this.notify();
          this.arm();
        },
        Math.max(1, Math.min(...future) - now),
      );
  }
}

const labels = {
  en: {
    sending: "Sending command",
    waiting: "Waiting for HA state",
    moving: "HA reports movement",
    reached: "Target reported by HA",
    already: "Target already reported before command",
    near: "Near target — exact result unconfirmed",
    tolerated: "Within tolerance — reported by HA",
    unconfirmed: "Result unconfirmed",
    interrupted: "Target interrupted — physical stop unconfirmed",
    failed: "Command failed",
    unknown: "State or value unknown",
    unavailable: "Entity missing, unavailable or disconnected",
    unsupported: "Axis not supported",
    replaced: "Replaced by a new target",
    skipped: "Skipped",
    historical: "Last result",
    pending: "Waiting for service response",
    reported: "Reported",
    target: "Target",
    groupTarget: "Last common target",
    individualTargets: "Individual targets",
    unknownValue: "Unknown",
    opening: "HA reports opening",
    closing: "HA reports closing",
    preview: "Preview — not sent",
    stopSending: "Sending STOP — physical stop unconfirmed",
    stopAccepted: "STOP accepted by HA — physical stop unconfirmed",
    stopFailed: "STOP failed on at least one channel",
    stopUnconfirmed: "STOP response unconfirmed",
  },
  cs: {
    sending: "Odesílání příkazu",
    waiting: "Čekání na stav z HA",
    moving: "HA hlásí pohyb",
    reached: "Cíl hlášený HA",
    already: "Cíl byl hlášený již před příkazem",
    near: "Blízko cíle — přesně nepotvrzeno",
    tolerated: "Dosaženo v toleranci dle HA",
    unconfirmed: "Výsledek nepotvrzen",
    interrupted: "Cíl přerušen — fyzické zastavení nepotvrzeno",
    failed: "Příkaz selhal",
    unknown: "Stav nebo hodnota neznámá",
    unavailable: "Entita chybí, je nedostupná nebo odpojená",
    unsupported: "Osa není podporovaná",
    replaced: "Nahrazeno novým cílem",
    skipped: "Vynecháno",
    historical: "Poslední výsledek",
    pending: "Čekání na odpověď služby",
    reported: "Hlášeno",
    target: "Cíl",
    groupTarget: "Poslední společný cíl",
    individualTargets: "Individuální cíle",
    unknownValue: "Neznámé",
    opening: "HA hlásí otevírání",
    closing: "HA hlásí zavírání",
    preview: "Náhled — neodesláno",
    stopSending: "Odesílání STOP — fyzické zastavení nepotvrzeno",
    stopAccepted: "STOP přijato HA — fyzické zastavení nepotvrzeno",
    stopFailed: "STOP selhalo alespoň na jednom kanálu",
    stopUnconfirmed: "Odpověď na STOP nepotvrzena",
  },
};
export function progressLabels(language?: string) {
  return labels[languageCode(language)];
}
export function progressText(status: ProgressStatus, language?: string) {
  const text = progressLabels(language);
  return `${status.historical ? `${text.historical}: ` : ""}${text[status.code]}${status.pending && status.code !== "sending" ? ` · ${text.pending}` : ""}`;
}
export function progressSymbol(status: ProgressStatus) {
  return status.historical
    ? "◷"
    : status.code === "near"
      ? "≈"
      : status.code === "moving"
        ? "↕"
        : status.code === "reached" ||
            status.code === "already" ||
            status.code === "tolerated"
          ? "✓"
          : status.code === "sending" || status.code === "waiting"
            ? "◷"
            : status.code === "interrupted"
              ? "■"
              : "!";
}
