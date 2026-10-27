import assert from "node:assert/strict";
import { test } from "node:test";
import { CoverController } from "../src/controller.ts";
import { GroupController } from "../src/group.ts";
import {
  parseConfig,
  sharedTiltVisual,
  sliderSteps,
  snapTarget,
  tiltRotation,
} from "../src/model.ts";

const yaml = (extra = {}, blinds = [{ entity: "cover.a" }]) => ({
  type: "custom:advanced-blind-card",
  ...extra,
  blinds,
});
const grouped = (root = {}, row = {}, member = {}) =>
  yaml(root, [
    {
      name: "Pair",
      ...row,
      entities: [{ entity: "cover.a", ...member }, { entity: "cover.b" }],
    },
  ]);
const options = (row) => [
  row.showButtons,
  row.showName,
  row.showState,
  row.showValues,
];

test("legacy YAML gets immutable display defaults and preserves the original default geometry", () => {
  const parsed = parseConfig(grouped());
  const group = parsed.rows[0];
  for (const scope of [parsed, group, ...group.members]) {
    assert.deepEqual(options(scope), [true, true, true, true]);
    assert.equal(scope.positionStep, 10);
    assert.equal(scope.layout, "detailed");
    assert.equal(scope.tiltStep, 10);
    assert.deepEqual(scope.tiltVisual, {
      mode: "single",
      minAngle: -90,
      maxAngle: 0,
      invert: false,
    });
    assert.equal(Object.isFrozen(scope), true);
    assert.equal(Object.isFrozen(scope.tiltVisual), true);
  }
  for (let p = 0; p <= 100; p++)
    assert.ok(Math.abs(tiltRotation(p, group.tiltVisual) - p * 0.9) < 1e-10);
});

test("layout inherits card to group to member with an explicit detailed override", () => {
  const input = grouped({ layout: "inline" }, {}, { layout: "detailed" });
  const before = structuredClone(input);
  const parsed = parseConfig(input),
    group = parsed.rows[0];
  assert.equal(parsed.layout, "inline");
  assert.equal(group.layout, "inline");
  assert.equal(group.members[0].layout, "detailed");
  assert.equal(group.members[1].layout, "inline");
  assert.deepEqual(input, before);
  const overridden = parseConfig(
    grouped({ layout: "inline" }, { layout: "detailed" }, { layout: "inline" }),
  ).rows[0];
  assert.equal(overridden.layout, "detailed");
  assert.equal(overridden.members[0].layout, "inline");
  assert.equal(overridden.members[1].layout, "detailed");
});

test("invalid layouts at every scope are rejected without accepting aliases or coerced values", () => {
  for (const layout of [null, true, 1, "", "compact", "INLINE", {}, []]) {
    for (const [input, path] of [
      [grouped({ layout }), "card.layout"],
      [grouped({}, { layout }), "blinds[0].layout"],
      [grouped({}, {}, { layout }), "blinds[0].entities[0].layout"],
    ]) {
      assert.throws(
        () => parseConfig(input),
        (error) => error.detail?.params?.path === path,
      );
    }
  }
});

test("all display fields inherit root to row to member with explicit false overrides", () => {
  const parsed = parseConfig(
    grouped(
      {
        show_buttons: false,
        show_name: false,
        show_state: false,
        show_values: false,
        visibility: [],
        grid_options: {},
      },
      { show_buttons: true, show_name: true },
      { show_buttons: false, show_state: true },
    ),
  );
  const group = parsed.rows[0],
    [a, b] = group.members;
  assert.deepEqual(options(parsed), [false, false, false, false]);
  assert.deepEqual(options(group), [true, true, false, false]);
  assert.deepEqual(options(a), [false, true, true, false]);
  assert.deepEqual(options(b), [true, true, false, false]);
  assert.equal(a.name, undefined, "group name must not become a member name");
  assert.equal(group.expandable, true);
});

test("changing only mode fills preset bounds instead of inheriting generated parent defaults", () => {
  const group = parseConfig(
    grouped(
      { tilt_visual: { mode: "single" } },
      { tilt_visual: { mode: "bidirectional" } },
      { tilt_visual: { mode: "single" } },
    ),
  ).rows[0];
  assert.deepEqual(group.tiltVisual, {
    mode: "bidirectional",
    minAngle: -90,
    maxAngle: 90,
    invert: false,
  });
  assert.deepEqual(group.members[0].tiltVisual, {
    mode: "single",
    minAngle: -90,
    maxAngle: 0,
    invert: false,
  });
  assert.deepEqual(group.members[1].tiltVisual, group.tiltVisual);
});

test("explicit visual bounds remain inherited across mode changes and invert false is a real override", () => {
  const parsed = parseConfig(
    grouped(
      { tilt_visual: { min_angle: -70, max_angle: -10, invert: true } },
      { tilt_visual: { mode: "bidirectional" } },
      { tilt_visual: { max_angle: 60, invert: false } },
    ),
  );
  const group = parsed.rows[0];
  assert.deepEqual(group.tiltVisual, {
    mode: "bidirectional",
    minAngle: -70,
    maxAngle: -10,
    invert: true,
  });
  assert.deepEqual(group.members[0].tiltVisual, {
    mode: "bidirectional",
    minAngle: -70,
    maxAngle: 60,
    invert: false,
  });
  assert.deepEqual(group.members[1].tiltVisual, group.tiltVisual);
  assert.equal(
    parseConfig(
      grouped(
        { tilt_visual: { max_angle: 0 } },
        { tilt_visual: { mode: "bidirectional" } },
      ),
    ).rows[0].tiltVisual.maxAngle,
    0,
  );
});

test("empty partial options do not erase parents, mutate YAML, or share mutable visual state", () => {
  const input = grouped(
    { tilt_visual: { mode: "bidirectional", invert: true } },
    { tilt_visual: {} },
    { tilt_visual: {}, show_name: false },
  );
  const before = structuredClone(input);
  const parsed = parseConfig(input),
    group = parsed.rows[0];
  assert.deepEqual(input, before);
  input.tilt_visual.invert = false;
  input.blinds[0].entities[0].tilt_visual.min_angle = -30;
  assert.equal(group.members[0].tiltVisual.invert, true);
  assert.equal(group.members[0].tiltVisual.minAngle, -90);
  assert.equal(group.members[1].showName, true);
  assert.throws(() => {
    group.members[0].tiltVisual.minAngle = 0;
  }, TypeError);
});

test("malformed settings are rejected at every scope with an exact field path", () => {
  const invalidVisual = [
    null,
    [],
    false,
    1,
    "single",
    { mode: "double" },
    { mode: null },
    { invert: 1 },
    { min_angle: "-90" },
    { max_angle: NaN },
    { max_angle: Infinity },
    { min_angle: -91 },
    { max_angle: 91 },
    { min_angle: 0, max_angle: 0 },
    { unknown: true },
  ];
  const scopes = [
    [(value) => yaml({ tilt_visual: value }), /card\.tilt_visual/],
    [
      (value) => yaml({}, [{ entity: "cover.a", tilt_visual: value }]),
      /blinds\[0\]\.tilt_visual/,
    ],
    [
      (value) => grouped({}, { tilt_visual: value }),
      /blinds\[0\]\.tilt_visual/,
    ],
    [
      (value) => grouped({}, {}, { tilt_visual: value }),
      /blinds\[0\]\.entities\[0\]\.tilt_visual/,
    ],
  ];
  for (const [config, path] of scopes)
    for (const visual of invalidVisual)
      assert.throws(() => parseConfig(config(visual)), path);
  for (const key of ["show_buttons", "show_name", "show_state", "show_values"])
    for (const value of [null, 0, 1, [], {}, "false"]) {
      assert.throws(
        () => parseConfig(grouped({ [key]: value })),
        new RegExp(`card\\.${key}`),
      );
      assert.throws(
        () => parseConfig(grouped({}, { [key]: value })),
        new RegExp(`blinds\\[0\\]\\.${key}`),
      );
      assert.throws(
        () => parseConfig(grouped({}, {}, { [key]: value })),
        new RegExp(`entities\\[0\\]\\.${key}`),
      );
    }
});

test("descendants cannot hide invalid ancestors and inherited conflicting bounds identify the child", () => {
  assert.throws(
    () =>
      parseConfig(
        grouped(
          { tilt_visual: { min_angle: 10 } },
          { tilt_visual: { mode: "bidirectional" } },
        ),
      ),
    /card\.tilt_visual.max_angle/,
  );
  assert.throws(
    () =>
      parseConfig(
        grouped(
          { tilt_visual: { min_angle: -70 } },
          { tilt_visual: { max_angle: -80 } },
          { tilt_visual: { min_angle: -90 } },
        ),
      ),
    /blinds\[0\]\.tilt_visual.max_angle/,
  );
  assert.throws(
    () =>
      parseConfig(
        grouped(
          { tilt_visual: { min_angle: -70 } },
          {},
          { tilt_visual: { max_angle: -80 } },
        ),
      ),
    /entities\[0\]\.tilt_visual.max_angle/,
  );
  for (const extra of [
    { show_stop: false },
    { invert: true },
    { tilt_visual: { minAngle: -90 } },
  ])
    assert.throws(() => parseConfig(yaml(extra)), /Unsupported/);
});

test("both presets, custom bounds and inversion map geometry without changing raw percentage interpretation", () => {
  const visual = (extra) =>
    parseConfig(yaml({ tilt_visual: extra })).rows[0].tiltVisual;
  const samples = [0, 25, 50, 75, 100];
  assert.deepEqual(
    samples.map((p) => tiltRotation(p, visual({ mode: "single" }))),
    [0, 22.5, 45, 67.5, 90],
  );
  assert.deepEqual(
    samples.map((p) => tiltRotation(p, visual({ mode: "bidirectional" }))),
    [0, 45, 90, 135, 180],
  );
  assert.deepEqual(
    samples.map((p) =>
      tiltRotation(p, visual({ mode: "bidirectional", invert: true })),
    ),
    [180, 135, 90, 45, 0],
  );
  assert.deepEqual(
    [0, 50, 100].map((p) =>
      tiltRotation(p, visual({ min_angle: -30, max_angle: 60 })),
    ),
    [60, 105, 150],
  );
  assert.deepEqual(
    [0, 50, 100].map((p) =>
      tiltRotation(p, visual({ min_angle: -30, max_angle: 60, invert: true })),
    ),
    [150, 105, 60],
  );
  for (const bad of [null, undefined, "50", NaN, Infinity, -1, 101])
    assert.equal(tiltRotation(bad, visual({})), null);
  const decimal = visual({ min_angle: -45.5, max_angle: 17.25 });
  assert.equal(tiltRotation(0, decimal), 44.5);
  assert.equal(tiltRotation(100, decimal), 107.25);
});

test("a group compares full effective maps, not modes, first member, or a coincident middle angle", () => {
  const visual = (extra) =>
    parseConfig(yaml({ tilt_visual: extra })).rows[0].tiltVisual;
  const a = visual({ mode: "bidirectional" }),
    b = visual({ mode: "single", min_angle: -90, max_angle: 90 });
  assert.equal(sharedTiltVisual([a, b]), a);
  const c = visual({ min_angle: -60, max_angle: 60 });
  assert.equal(tiltRotation(50, a), tiltRotation(50, c));
  assert.equal(sharedTiltVisual([a, c]), null);
  assert.equal(
    sharedTiltVisual([a, visual({ mode: "bidirectional", invert: true })]),
    null,
  );
  assert.equal(sharedTiltVisual([]), null);
});

test("visual inversion and member-specific maps never change the outgoing HA command", async () => {
  const config = parseConfig(
    grouped(
      { tilt_visual: { mode: "bidirectional" } },
      {},
      { tilt_visual: { invert: true, min_angle: -40, max_angle: 80 } },
    ),
  );
  const calls = [];
  const hass = {
    connected: true,
    states: Object.fromEntries(
      ["a", "b"].map((id) => [
        `cover.${id}`,
        {
          entity_id: `cover.${id}`,
          state: "open",
          attributes: {
            current_position: 30,
            current_tilt_position: 30,
            supported_features: 255,
          },
        },
      ]),
    ),
    services: {
      cover: { set_cover_tilt_position: {}, set_cover_position: {} },
    },
    callService: async (...args) => calls.push(args),
  };
  const members = config.rows[0].members.map((row) => {
    const c = new CoverController();
    c.configureCover(row);
    c.setHass(hass);
    c.setAttached(true);
    return c;
  });
  const group = new GroupController(members);
  group.begin("tilt", "pointer");
  group.input("tilt", 37);
  assert.deepEqual(calls, []);
  await group.finish("tilt", "pointer");
  assert.deepEqual(
    calls.map((call) => [call[1], call[2], call[3]]),
    [
      [
        "set_cover_tilt_position",
        { tilt_position: 37 },
        { entity_id: "cover.a" },
      ],
      [
        "set_cover_tilt_position",
        { tilt_position: 37 },
        { entity_id: "cover.b" },
      ],
    ],
  );
  await members[0].perform("position", 63);
  assert.deepEqual(calls[2][2], { position: 63 });
  for (const member of members) member.setAttached(false);
});

test("independent target steps inherit at root, single row, group and member without mutating YAML", () => {
  const input = grouped(
    { position_step: 5, tilt_step: 20 },
    { position_step: 25 },
    { position_step: 1, tilt_step: 4 },
  );
  const before = structuredClone(input);
  const parsed = parseConfig(input),
    group = parsed.rows[0];
  assert.deepEqual([parsed.positionStep, parsed.tiltStep], [5, 20]);
  assert.deepEqual([group.positionStep, group.tiltStep], [25, 20]);
  assert.deepEqual(
    group.members.map((m) => [m.positionStep, m.tiltStep]),
    [
      [1, 4],
      [25, 20],
    ],
  );
  assert.deepEqual(input, before);
  const single = parseConfig(
    yaml({ position_step: 2, tilt_step: 50 }, [
      { entity: "cover.a", tilt_step: 100 },
    ]),
  ).rows[0];
  assert.deepEqual([single.positionStep, single.tiltStep], [2, 100]);
  assert.equal(Object.isFrozen(single), true);
});

test("every target grid reaches 0/100 and never changes the original off-grid report", () => {
  assert.deepEqual(sliderSteps, [1, 2, 4, 5, 10, 20, 25, 50, 100]);
  assert.equal(Object.isFrozen(sliderSteps), true);
  for (const step of sliderSteps) {
    const row = parseConfig(yaml({ position_step: step, tilt_step: step }))
      .rows[0];
    assert.equal(row.positionStep, step);
    assert.equal(row.tiltStep, step);
    assert.equal(snapTarget(0, step), 0);
    assert.equal(snapTarget(100, step), 100);
    for (let report = 0; report <= 100; report += 0.5) {
      const target = snapTarget(report, step);
      assert.ok(target >= 0 && target <= 100 && target % step === 0);
      assert.ok(Math.abs(target - report) <= step / 2);
    }
  }
  assert.deepEqual(
    [9, 19, 21, 91].map((n) => snapTarget(n, 10)),
    [10, 20, 20, 90],
  );
});

test("invalid target step values identify the exact key at every configuration scope", () => {
  for (const key of ["position_step", "tilt_step"])
    for (const value of [
      null,
      true,
      false,
      "10",
      0,
      -1,
      3,
      7,
      9,
      11,
      101,
      1.5,
      NaN,
      Infinity,
      {},
      [],
    ]) {
      for (const [config, path] of [
        [yaml({ [key]: value }), `card.${key}`],
        [yaml({}, [{ entity: "cover.a", [key]: value }]), `blinds[0].${key}`],
        [grouped({}, { [key]: value }), `blinds[0].${key}`],
        [grouped({}, {}, { [key]: value }), `blinds[0].entities[0].${key}`],
      ])
        assert.throws(
          () => parseConfig(config),
          (error) =>
            error.detail.params.path === path &&
            error.detail.key === "stepInvalid",
        );
    }
});
