import assert from "node:assert/strict";
import test from "node:test";
import { barPresentation, compactProgress } from "../src/presentation.ts";

test("bar uses raw HA bounds, never an average or the requested target", () => {
  const bar = barPresentation(
    [9, 21],
    [
      { code: "waiting", target: 50 },
      { code: "waiting", target: 50 },
    ],
  );
  assert.deepEqual(bar, {
    min: 9,
    max: 21,
    uncertain: false,
    target: 50,
    tone: "caution",
  });
  assert.equal(barPresentation([null, 9], []).uncertain, true);
  assert.equal(barPresentation([null], []).tone, "caution");
});
test("historical, interrupted and replaced goals cannot become an active common target", () => {
  assert.equal(
    barPresentation([30, 40], [{ code: "waiting", target: 50 }]).target,
    undefined,
  );
  for (const status of [
    { code: "reached" as const, historical: true, target: 50 },
    { code: "interrupted" as const, target: 50 },
    { code: "replaced" as const, target: 50 },
  ])
    assert.equal(barPresentation([30], [status]).target, undefined);
  assert.equal(
    barPresentation(
      [30, 40],
      [
        { code: "waiting", target: 50 },
        { code: "waiting", target: 60 },
      ],
    ).target,
    undefined,
  );
});
test("partial and pending results never use success coloring", () => {
  assert.equal(
    barPresentation([50, 30], [{ code: "reached", target: 50 }]).tone,
    "caution",
  );
  assert.equal(
    barPresentation(
      [50, 70],
      [
        { code: "reached", target: 50 },
        { code: "reached", target: 70 },
      ],
    ).tone,
    "caution",
  );
  assert.equal(
    barPresentation(
      [50, 49],
      [
        { code: "reached", target: 50 },
        { code: "near", target: 50 },
      ],
    ).tone,
    "caution",
  );
  assert.equal(
    barPresentation([50], [{ code: "reached", target: 50, pending: true }])
      .tone,
    "caution",
  );
  assert.equal(
    barPresentation([50], [{ code: "failed", target: 50 }]).tone,
    "error",
  );
  assert.equal(
    barPresentation([30], [{ code: "waiting", target: 50 }], 70).target,
    70,
  );
});
test("compact text keeps uncertainty, history and pending response explicit", () => {
  assert.match(compactProgress({ code: "near" }, "cs"), /nepotvrzeno/);
  assert.match(
    compactProgress({ code: "reached", historical: true, pending: true }, "en"),
    /Earlier:.*response pending/,
  );
});
