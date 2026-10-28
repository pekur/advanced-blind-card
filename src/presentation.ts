import { languageCode } from "./localize.ts";
import { type TiltVisual, tiltRotation } from "./model.ts";
import type { ProgressCode, ProgressStatus } from "./progress.ts";

const labels: Record<ProgressCode, [string, string]> = {
  sending: ["Odesílání", "Sending"],
  waiting: ["Čekání na HA", "Waiting for HA"],
  moving: ["Pohyb hlášen HA", "HA reports movement"],
  reached: ["Cíl hlášen HA", "HA reports target"],
  already: ["Již v cíli dle HA", "Already at target per HA"],
  near: ["Blízko · nepotvrzeno", "Near · unconfirmed"],
  unconfirmed: ["Výsledek nepotvrzen", "Result unconfirmed"],
  interrupted: ["Přerušeno · nepotvrzeno", "Interrupted · unconfirmed"],
  failed: ["Chyba příkazu", "Command failed"],
  unknown: ["Neznámý stav", "Unknown state"],
  unavailable: ["Nedostupné", "Unavailable"],
  unsupported: ["Nepodporováno", "Unsupported"],
  replaced: ["Cíl nahrazen", "Target replaced"],
  skipped: ["Vynecháno", "Skipped"],
};

export function compactProgress(status: ProgressStatus, language?: string) {
  const cs = languageCode(language) === "cs";
  return `${status.historical ? (cs ? "Dříve: " : "Earlier: ") : ""}${labels[status.code][cs ? 0 : 1]}${status.pending && status.code !== "sending" ? (cs ? " · odpověď čeká" : " · response pending") : ""}`;
}

export function quietResult(status: ProgressStatus) {
  return (
    !status.pending &&
    !status.reason &&
    ["reached", "already"].includes(status.code)
  );
}

export function failedResult(status: ProgressStatus) {
  return (
    status.code === "failed" ||
    (!!status.reason && ["reached", "already"].includes(status.code))
  );
}

export function routineProgress(status: ProgressStatus) {
  return (
    !failedResult(status) &&
    (["sending", "waiting", "moving"].includes(status.code) ||
      (!!status.pending && ["reached", "already"].includes(status.code)))
  );
}

// Illustrative front-view width, using the same configured angle as the SVG.
// It describes HA's report, never a preview or an estimated physical position.
export function lamellaWidth(
  value: number | null,
  visual: TiltVisual,
): number | null {
  const rotation = tiltRotation(value, visual);
  return rotation === null
    ? null
    : 8 * (0.16 + 0.76 * Math.min(1, Math.abs(rotation - 90) / 90));
}

// Presentation only: never infer physical completion or interpolate HA reports.
export function barPresentation(
  values: readonly (number | null)[],
  statuses: readonly ProgressStatus[],
  preview?: number,
) {
  const known = values.filter((value): value is number => value !== null);
  const min = known.length ? Math.min(...known) : 0;
  const max = known.length ? Math.max(...known) : 0;
  const uncertain = known.length !== values.length || !known.length;
  const common =
    statuses.length > 0 &&
    statuses.length === values.length &&
    statuses.some((status) => !quietResult(status)) &&
    statuses.every(
      (status) =>
        !status.historical &&
        !["replaced", "interrupted", "skipped"].includes(status.code) &&
        status.target !== undefined &&
        status.target === statuses[0]?.target,
    );
  const target = preview ?? (common ? statuses[0]?.target : undefined);
  const attention = statuses.filter((status) => !quietResult(status));
  const tone = attention.some(failedResult)
    ? "error"
    : uncertain ||
        (attention.length > 0 &&
          (statuses.length !== values.length || min !== max)) ||
        attention.some(
          (status) =>
            status.historical ||
            status.pending ||
            !["moving", "reached", "already"].includes(status.code),
        )
      ? "caution"
      : attention.some((status) => status.code === "moving")
        ? "moving"
        : "idle";
  return {
    min,
    max,
    uncertain,
    target,
    tone: preview !== undefined ? "preview" : tone,
  };
}
