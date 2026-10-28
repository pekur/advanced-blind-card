import assert from "node:assert/strict";
import test from "node:test";
import { defaultTiltVisual } from "../src/model.ts";
import {
  barPresentation,
  compactProgress,
  failedResult,
  lamellaWidth,
  quietResult,
  routineProgress,
} from "../src/presentation.ts";

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
    "idle",
  );
  assert.equal(
    barPresentation(
      [50, 70],
      [
        { code: "reached", target: 50 },
        { code: "reached", target: 70 },
      ],
    ).tone,
    "idle",
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

test("successful and historical goals become quiet without losing unresolved or rejected results", () => {
  for (const code of ["reached", "already"] as const) {
    for (const historical of [false, true]) {
      const status = { code, historical, target: 50 };
      assert.equal(quietResult(status), true);
      assert.equal(barPresentation([50], [status]).target, undefined);
      assert.equal(barPresentation([47], [status]).tone, "idle");
    }
    assert.equal(quietResult({ code, pending: true, target: 50 }), false);
    const status = { code, target: 50, reason: { key: "waiting" as const } };
    assert.equal(quietResult(status), false);
    assert.equal(failedResult(status), true);
    assert.equal(barPresentation([50], [status]).tone, "error");
  }
  for (const code of [
    "near",
    "unconfirmed",
    "failed",
    "interrupted",
    "skipped",
    "unsupported",
    "unavailable",
    "unknown",
  ] as const)
    assert.equal(quietResult({ code }), false);
});

test("mixed completion retains a shared target until all responses and results settle", () => {
  assert.equal(
    barPresentation(
      [50, 30],
      [
        { code: "reached", target: 50 },
        { code: "waiting", target: 50 },
      ],
    ).target,
    50,
  );
  assert.equal(
    barPresentation([50], [{ code: "reached", target: 50, pending: true }])
      .target,
    50,
  );
});

test("lamella widths follow configured report angles, including inverse and bidirectional mapping", () => {
  const widths = [0, 50, 100].map((value) =>
    lamellaWidth(value, defaultTiltVisual),
  );
  assert.ok(widths[0] > widths[1] && widths[1] > widths[2]);
  assert.equal(
    lamellaWidth(0, { ...defaultTiltVisual, invert: true }),
    widths[2],
  );
  const visual = {
    mode: "bidirectional" as const,
    invert: false,
    minAngle: -90,
    maxAngle: 90,
  };
  assert.equal(lamellaWidth(0, visual), lamellaWidth(100, visual));
  assert.ok(lamellaWidth(50, visual) < lamellaWidth(0, visual));
  assert.equal(lamellaWidth(null, visual), null);
});

test("pending responses cannot demote timeouts, interruption or other warnings to routine waiting", () => {
  for (const code of [
    "sending",
    "waiting",
    "moving",
    "reached",
    "already",
  ] as const)
    assert.equal(routineProgress({ code, pending: true }), true);
  for (const code of [
    "unconfirmed",
    "interrupted",
    "near",
    "failed",
    "unknown",
    "unavailable",
    "unsupported",
    "skipped",
    "replaced",
  ] as const)
    assert.equal(routineProgress({ code, pending: true }), false);
  assert.equal(routineProgress({ code: "reached" }), false);
});
