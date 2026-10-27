import { languageCode } from "./localize.ts";
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
    statuses.every(
      (status) =>
        !status.historical &&
        !["replaced", "interrupted", "skipped"].includes(status.code) &&
        status.target !== undefined &&
        status.target === statuses[0]?.target,
    );
  const target = preview ?? (common ? statuses[0]?.target : undefined);
  const tone = statuses.some((status) => status.code === "failed")
    ? "error"
    : uncertain ||
        (statuses.length > 0 &&
          (statuses.length !== values.length || min !== max)) ||
        statuses.some(
          (status) =>
            status.historical ||
            status.pending ||
            !["moving", "reached", "already"].includes(status.code),
        )
      ? "caution"
      : statuses.some((status) => status.code === "moving")
        ? "moving"
        : statuses.length
          ? "reached"
          : "idle";
  return {
    min,
    max,
    uncertain,
    target,
    tone: preview !== undefined ? "preview" : tone,
  };
}
