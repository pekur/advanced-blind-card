import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigDraft } from "../src/editor-model.ts";
import { noticeText } from "../src/localize.ts";
import { parseConfig } from "../src/model.ts";

const config = () => ({
  type: "custom:advanced-blind-card",
  blinds: [
    {
      name: "Pair",
      show_buttons: false,
      entities: [
        { entity: "cover.a", tilt_visual: { invert: true } },
        { entity: "cover.b", show_values: false },
      ],
    },
  ],
  view_layout: { grid_area: "main" },
  grid_options: { columns: 12 },
  layout_options: { grid_columns: 2 },
  visibility: [{ condition: "user", users: ["owner"] }],
});
const fixture = (value = config()) => {
  const draft = new ConfigDraft();
  draft.setConfig(value);
  return draft;
};

const aliasedConfig = () => {
  const visual = {
    mode: "single",
    min_angle: -90,
    max_angle: 0,
    invert: false,
  };
  const value = config();
  value.tilt_visual = visual;
  value.blinds[0].tilt_visual = visual;
  value.blinds[0].entities[0].tilt_visual = visual;
  value.view_layout.visual = visual;
  return value;
};

for (const [field, value] of [
  ["invert", "true"],
  ["mode", "bidirectional"],
  ["min_angle", "-80"],
  ["max_angle", "-10"],
  ["invert", ""],
  ["mode", ""],
  ["min_angle", ""],
  ["max_angle", ""],
]) {
  test(`shared tilt object: global ${field}=${value || "default"} preserves row, member and metadata`, () => {
    const input = aliasedConfig();
    const before = structuredClone(input);
    const draft = fixture(input);
    const next = draft.update(field, value);
    assert.ok(next, "a valid global change must be emitted");
    const expected = { ...before.tilt_visual };
    if (!value) delete expected[field];
    else
      expected[field] = field.endsWith("angle")
        ? Number(value)
        : field === "invert"
          ? true
          : value;
    assert.deepEqual(next.tilt_visual, expected);
    assert.deepEqual(next.blinds, before.blinds);
    assert.deepEqual(next.view_layout, before.view_layout);
    assert.deepEqual(input, before);
    assert.notEqual(next.tilt_visual, next.blinds[0].tilt_visual);
    assert.deepEqual(
      parseConfig(next).rows[0].members[0].tiltVisual,
      parseConfig(before).rows[0].members[0].tiltVisual,
    );
  });
}

test("shared tilt object stays isolated through invalid drafts, echo and repeated edits", () => {
  const input = aliasedConfig();
  const before = structuredClone(input);
  const draft = fixture(input);
  const first = draft.update("max_angle", "20");
  const firstSnapshot = structuredClone(first);
  draft.setConfig(first);
  assert.equal(draft.update("min_angle", "-"), undefined);
  assert.equal(draft.update("invert", "true"), undefined);
  const second = draft.update("min_angle", "-80");
  assert.deepEqual(second.tilt_visual, {
    mode: "single",
    min_angle: -80,
    max_angle: 20,
    invert: true,
  });
  assert.deepEqual(second.blinds, before.blinds);
  assert.deepEqual(second.view_layout, before.view_layout);
  assert.deepEqual(first, firstSnapshot);
  assert.deepEqual(input, before);
});

test("removing all shared global visual fields keeps explicit row and member settings", () => {
  const input = aliasedConfig();
  const before = structuredClone(input);
  const draft = fixture(input);
  let next;
  for (const field of ["invert", "mode", "min_angle", "max_angle"]) {
    next = draft.update(field, "");
    assert.ok(next);
    assert.deepEqual(next.blinds, before.blinds);
    assert.deepEqual(next.view_layout, before.view_layout);
  }
  assert.equal(Object.hasOwn(next, "tilt_visual"), false);
  assert.deepEqual(input, before);
});

test("out-of-order echoes of earlier emissions preserve newer choices and invalid drafts", () => {
  const draft = fixture();
  const first = draft.update("show_name", "false");
  const second = draft.update("show_values", "false");
  draft.update("min_angle", "-");
  draft.setConfig(first);
  assert.equal(draft.value("show_values"), "false");
  assert.equal(draft.value("min_angle"), "-");
  draft.setConfig(second);
  assert.equal(draft.value("min_angle"), "-");
  assert.ok(draft.error);
  const next = draft.update("min_angle", "-30");
  assert.equal(next.show_values, false);
  assert.equal(next.show_name, false);
  assert.equal(next.tilt_visual.min_angle, -30);
});

test("editor changes only the requested global field and never mutates inputs or prior emissions", () => {
  const input = config(),
    before = structuredClone(input),
    draft = fixture(input);
  const first = draft.update("show_values", "false");
  assert.deepEqual(first, { ...before, show_values: false });
  assert.deepEqual(input, before);
  first.blinds[0].entities[0].entity = "cover.changed";
  const second = draft.update("show_state", "false");
  assert.deepEqual(second, {
    ...before,
    show_values: false,
    show_state: false,
  });
  assert.equal(draft.value("show_buttons"), "");
});

test("default removes a field, preserves explicit false and cleans an empty visual object", () => {
  const draft = fixture({
    ...config(),
    show_buttons: false,
    tilt_visual: { invert: false },
  });
  assert.equal(draft.value("show_buttons"), "false");
  const one = draft.update("show_buttons", "");
  assert.equal(Object.hasOwn(one, "show_buttons"), false);
  assert.deepEqual(one.tilt_visual, { invert: false });
  const two = draft.update("invert", "");
  assert.equal(Object.hasOwn(two, "tilt_visual"), false);
  assert.equal(parseConfig(two).rows[0].members[0].showButtons, false);
});

test("changing mode leaves generated bounds absent and explicit bounds intact", () => {
  let draft = fixture();
  let next = draft.update("mode", "bidirectional");
  assert.deepEqual(next.tilt_visual, { mode: "bidirectional" });
  assert.equal(parseConfig(next).tiltVisual.maxAngle, 90);
  draft = fixture({
    ...config(),
    tilt_visual: { min_angle: -30, max_angle: 40 },
  });
  next = draft.update("mode", "bidirectional");
  assert.deepEqual(next.tilt_visual, {
    mode: "bidirectional",
    min_angle: -30,
    max_angle: 40,
  });
});

test("partial numbers and invalid angle pairs remain local until the whole draft validates", () => {
  const draft = fixture();
  for (const value of ["-", "1e", "NaN", "Infinity", "0x10", "91"]) {
    assert.equal(draft.update("min_angle", value), undefined);
    assert.ok(draft.error);
    assert.equal(draft.value("min_angle"), value);
  }
  assert.equal(draft.update("min_angle", "20"), undefined);
  assert.equal(
    draft.update("show_values", "false"),
    undefined,
    "another field must not leak invalid numbers",
  );
  const valid = draft.update("max_angle", "40");
  assert.deepEqual(valid.tilt_visual, { min_angle: 20, max_angle: 40 });
  assert.equal(valid.show_values, false);
  assert.equal(draft.error, "");
  assert.equal(
    draft.update("max_angle", "40"),
    undefined,
    "no duplicate event",
  );
});

test("clearing numeric overrides restores defaults without serializing null or zero", () => {
  const draft = fixture({
    ...config(),
    tilt_visual: { min_angle: -30, max_angle: 40 },
  });
  let next = draft.update("min_angle", "");
  assert.deepEqual(next.tilt_visual, { max_angle: 40 });
  next = draft.update("max_angle", "");
  assert.equal(Object.hasOwn(next, "tilt_visual"), false);
});

test("HA echoes preserve newer invalid drafts; external configurations replace them", () => {
  const draft = fixture();
  const emitted = draft.update("show_name", "false");
  draft.update("max_angle", "-");
  draft.setConfig(structuredClone(emitted));
  assert.equal(draft.value("max_angle"), "-");
  assert.ok(draft.error);
  draft.setConfig({ ...config(), show_values: false });
  assert.equal(draft.value("max_angle"), "");
  assert.equal(draft.value("show_values"), "false");
  assert.equal(draft.error, "");
});

test("unsupported or invalid source YAML is reported without emission or repair", () => {
  for (const input of [
    null,
    { ...config(), new_option: true },
    { ...config(), blinds: [] },
    { ...config(), tilt_visual: { mode: "bad" } },
  ]) {
    const draft = fixture(input);
    assert.equal(draft.editable, false);
    assert.ok(draft.error);
    assert.equal(draft.update("show_values", "false"), undefined);
    assert.notEqual(
      noticeText(draft.error, "cs"),
      noticeText(draft.error, "en"),
    );
  }
});

test("valid numbers support decimals and scientific notation within the same parser rules", () => {
  const draft = fixture();
  const next = draft.update("min_angle", " -2.5e1 ");
  assert.equal(next.tilt_visual.min_angle, -25);
  const emitted = draft.update("max_angle", "1.5");
  assert.equal(emitted.tilt_visual.max_angle, 1.5);
});

for (const field of ["position_step", "tilt_step"]) {
  test(`editor ${field} emits numeric choices, preserves overrides/aliases/metadata, and default removes the key`, () => {
    const input = aliasedConfig();
    input.position_step = 20;
    input.tilt_step = 25;
    input.blinds[0].position_step = 5;
    input.blinds[0].entities[0].tilt_step = 1;
    const before = structuredClone(input),
      draft = fixture(input);
    assert.equal(draft.value(field), String(input[field]));
    const first = draft.update(field, "10");
    assert.deepEqual(first, { ...before, [field]: 10 });
    assert.equal(typeof first[field], "number");
    draft.setConfig(first);
    assert.equal(draft.value(field), "10");
    const intermediate = draft.update("show_state", "false");
    draft.update("min_angle", "-");
    assert.equal(draft.update(field, "4"), undefined);
    const next = draft.update("min_angle", "-80");
    assert.equal(next[field], 4);
    assert.deepEqual(next.blinds, before.blinds);
    assert.deepEqual(next.view_layout, before.view_layout);
    draft.setConfig(intermediate);
    assert.equal(
      draft.value(field),
      "4",
      "older echo must not erase newer step choice",
    );
    const reset = draft.update(field, "");
    assert.equal(Object.hasOwn(reset, field), false);
    assert.deepEqual(reset.blinds, before.blinds);
    assert.deepEqual(input, before);
    assert.deepEqual(first, { ...before, [field]: 10 });
  });
}

test("editor rejects invalid step source/config without silently repairing it", () => {
  for (const field of ["position_step", "tilt_step"]) {
    const source = fixture({ ...config(), [field]: 3 });
    assert.equal(source.editable, false);
    assert.equal(source.update(field, "10"), undefined);
    const draft = fixture();
    assert.equal(draft.update(field, "3"), undefined);
    assert.ok(draft.error);
    const next = draft.update(field, "1");
    assert.equal(next[field], 1);
    assert.equal(draft.error, "");
  }
});
