import assert from "node:assert/strict";
import { test } from "node:test";
import { CoverController } from "../src/controller.ts";
import {
  actionReason,
  commandFor,
  parseConfig,
  percentage,
  reportedValue,
  tiltRotation,
} from "../src/model.ts";

const yaml = (entity = "cover.example", extra = {}) => ({
  type: "custom:advanced-blind-card",
  blinds: [{ entity }],
  ...extra,
});
const allActions = ["position", "tilt", "open", "close", "stop", "stopTilt"];
const defaultSettings = {
  showButtons: true,
  showName: true,
  showState: true,
  showValues: true,
  positionStep: 10,
  tiltStep: 10,
  tiltVisual: { mode: "single", minAngle: -90, maxAngle: 0, invert: false },
};

function fixture({
  features = 207,
  state = "open",
  handler = async () => {},
} = {}) {
  const calls = [];
  const entity = {
    entity_id: "cover.example",
    state,
    attributes: {
      supported_features: features,
      current_position: 30,
      current_tilt_position: 50,
    },
  };
  const hass = {
    connected: true,
    states: { "cover.example": entity },
    services: {
      cover: Object.fromEntries(
        [
          "set_cover_position",
          "set_cover_tilt_position",
          "open_cover",
          "close_cover",
          "stop_cover",
          "stop_cover_tilt",
        ].map((service) => [service, {}]),
      ),
    },
    callService: async (...args) => {
      calls.push(args);
      return handler(...args);
    },
  };
  const controller = new CoverController();
  controller.configure(yaml());
  controller.setHass(hass);
  controller.setAttached(true);
  return { controller, hass, entity, calls };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test("configuration retains a single cover, defaults buttons, and permits HA metadata", () => {
  assert.deepEqual(parseConfig(yaml()), {
    rows: [{ kind: "single", entity: "cover.example", ...defaultSettings }],
    ...defaultSettings,
  });
  assert.deepEqual(
    parseConfig({
      ...yaml("cover.test", {
        show_buttons: false,
        grid_options: {},
        visibility: [],
      }),
      blinds: [{ entity: "cover.test", name: " Office " }],
    }),
    {
      rows: [
        {
          ...defaultSettings,
          kind: "single",
          entity: "cover.test",
          name: "Office",
          showButtons: false,
        },
      ],
      ...defaultSettings,
      showButtons: false,
    },
  );
});

test("configuration rejects malformed options, aliases, and malformed groups", () => {
  const invalid = [
    null,
    [],
    {},
    { ...yaml(), type: "wrong" },
    { ...yaml(), blinds: [] },
    { ...yaml(), blinds: [null] },
    { ...yaml(), blinds: [{ entity: "light.test" }] },
    { ...yaml(), blinds: [{ entity: "cover.x invalid" }] },
    { ...yaml(), blinds: [{ entities: ["cover.a", "cover.b"] }] },
    { ...yaml(), blinds: [{ entity: "cover.a", name: " " }] },
    { ...yaml(), blinds: [{ entity: "cover.a", invert: true }] },
    yaml("cover.a", { entity: "cover.a" }),
    yaml("cover.a", { show_buttons: "false" }),
    yaml("cover.a", { tilt_visual: { maximum_angle: 90 } }),
  ];
  for (const config of invalid) assert.throws(() => parseConfig(config), Error);
});

test("reported percentages reject coercion, nonfinite values, and invalid ranges", () => {
  for (const value of [0, 50.5, 100]) assert.equal(percentage(value), value);
  for (const value of [undefined, null, "50", NaN, Infinity, -1, 101])
    assert.equal(percentage(value), null);
  assert.deepEqual(
    [0, 50, 100, undefined].map((value) => tiltRotation(value)),
    [0, 45, 90, null],
  );
});

test("each capability maps to its exact service, payload, and configured target", () => {
  const cases = [
    ["position", 4, "set_cover_position", { position: 75 }],
    ["tilt", 128, "set_cover_tilt_position", { tilt_position: 75 }],
    ["open", 1, "open_cover", {}],
    ["close", 2, "close_cover", {}],
    ["stop", 8, "stop_cover", {}],
    ["stopTilt", 64, "stop_cover_tilt", {}],
  ];
  for (const [action, features, service, data] of cases) {
    const { controller } = fixture({ features });
    assert.deepEqual(commandFor(controller.snapshot, action, 75), {
      service,
      data,
      target: { entity_id: "cover.example" },
    });
    for (const other of allActions.filter(
      (candidate) => candidate !== action,
    )) {
      assert.match(actionReason(controller.snapshot, other), /Not supported/);
    }
  }
});

test("attributes never imply capabilities and malformed feature masks are disabled", () => {
  for (const features of [undefined, null, "207", -1, 1.5, NaN, Infinity, 0]) {
    const { controller } = fixture({ features: 0 });
    controller.hass.states["cover.example"].attributes.supported_features =
      features;
    for (const action of allActions)
      assert.match(controller.reason(action), /Not supported/);
  }
});

test("missing attributes disable only the affected slider, without inventing a midpoint", () => {
  const { controller, entity } = fixture();
  delete entity.attributes.current_position;
  entity.attributes.current_tilt_position = "50";
  assert.equal(reportedValue(controller.snapshot, "position"), null);
  assert.equal(controller.value("tilt"), null);
  assert.match(controller.reason("position"), /unknown/);
  assert.match(controller.reason("tilt"), /unknown/);
  for (const action of ["open", "close", "stop", "stopTilt"])
    assert.equal(controller.reason(action), null);
});

test("unknown state permits supported STOP but no movement-starting command", () => {
  const { controller } = fixture({ state: "unknown" });
  for (const action of ["position", "tilt", "open", "close"])
    assert.match(controller.reason(action), /unknown/);
  assert.equal(controller.reason("stop"), null);
  assert.equal(controller.reason("stopTilt"), null);
});

test("missing, unavailable, disconnected, and detached entities block all commands", async () => {
  for (const condition of [
    "missing",
    "unavailable",
    "disconnected",
    "detached",
  ]) {
    const { controller, entity, hass, calls } = fixture();
    if (condition === "missing") delete hass.states["cover.example"];
    if (condition === "unavailable") entity.state = "unavailable";
    if (condition === "disconnected") hass.connected = false;
    if (condition === "detached") controller.setAttached(false);
    for (const action of allActions)
      assert.notEqual(controller.reason(action), null);
    await controller.perform("open");
    await controller.stop();
    assert.deepEqual(calls, []);
  }
});

test("service availability and integer target validity are checked at dispatch", () => {
  const { controller, hass } = fixture();
  for (const value of [undefined, null, "20", NaN, Infinity, -1, 101, 0.2]) {
    assert.throws(
      () => commandFor(controller.snapshot, "position", value),
      /integer/,
    );
  }
  for (const value of [0, 100])
    assert.equal(
      commandFor(controller.snapshot, "position", value).data.position,
      value,
    );
  delete hass.services.cover.set_cover_position;
  assert.throws(
    () => commandFor(controller.snapshot, "position", 50),
    /service is unavailable/,
  );
});

test("initialization and repeated hass updates never dispatch a service", () => {
  const { controller, hass, calls } = fixture();
  for (let index = 0; index < 10; index++) controller.setHass({ ...hass });
  controller.setAttached(false);
  controller.setAttached(true);
  controller.configure(yaml());
  assert.deepEqual(calls, []);
});

test("pointer preview survives HA updates and commits once after release", async () => {
  const { controller, hass, entity, calls } = fixture();
  assert.equal(controller.begin("position", "pointer"), true);
  controller.input("position", 40);
  controller.input("position", 65);
  entity.attributes.current_position = 42;
  controller.setHass({ ...hass });
  assert.equal(controller.value("position"), 65);
  assert.equal(reportedValue(controller.snapshot, "position"), 42);
  assert.deepEqual(calls, []);
  await controller.change("position", 65);
  assert.equal(calls.length, 0);
  await controller.finish("position", "pointer");
  await controller.change("position", 65);
  await controller.finish("position", "pointer");
  assert.deepEqual(calls, [
    [
      "cover",
      "set_cover_position",
      { position: 65 },
      { entity_id: "cover.example" },
    ],
  ]);
  assert.equal(controller.value("position"), 42);
});

test("unchanged and reversed gestures do not send commands", async () => {
  const { controller, calls } = fixture();
  controller.begin("position", "pointer");
  controller.input("position", 60);
  controller.input("position", 30);
  await controller.finish("position", "pointer");
  assert.deepEqual(calls, []);
});

test("keyboard repeated changes preview until one keyup or blur commit", async () => {
  const { controller, calls } = fixture();
  controller.begin("tilt", "keyboard");
  for (const value of [51, 52, 53, 54]) await controller.change("tilt", value);
  assert.deepEqual(calls, []);
  await controller.finish("tilt", "keyboard");
  await controller.finish("tilt", "keyboard");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][2], { tilt_position: 54 });
});

test("completion must match the gesture's input mode and axis", async () => {
  const { controller, calls } = fixture();
  controller.begin("position", "pointer");
  controller.input("position", 82);
  await controller.finish("position", "keyboard");
  await controller.finish("tilt", "pointer");
  assert.deepEqual(calls, []);
  assert.equal(controller.draft.mode, "pointer");
  await controller.finish("position", "pointer");
  assert.deepEqual(
    calls.map((call) => call[2]),
    [{ position: 82 }],
  );

  controller.begin("tilt", "keyboard");
  controller.input("tilt", 75);
  await controller.finish("tilt", "pointer");
  assert.equal(calls.length, 1);
  await controller.finish("tilt", "keyboard");
  assert.deepEqual(calls[1][2], { tilt_position: 75 });
});

test("assistive input/change commits once and supports subsequent edits", async () => {
  const { controller, calls } = fixture();
  controller.input("position", 70);
  await controller.change("position", 70);
  await controller.change("position", 70);
  controller.input("position", 80);
  await controller.change("position", 80);
  assert.deepEqual(
    calls.map((call) => call[2]),
    [{ position: 70 }, { position: 80 }],
  );
});

test("change-only assistive edits work without duplicate dispatch", async () => {
  const { controller, calls } = fixture();
  await controller.change("position", 60);
  await controller.change("position", 60);
  await controller.change("position", 75);
  assert.deepEqual(
    calls.map((call) => call[2]),
    [{ position: 60 }, { position: 75 }],
  );
});

test("idle cancellation preserves completed history and accepts a distinct assistive edit", async () => {
  for (const mode of ["pointer", "keyboard", "assistive"]) {
    const { controller, calls } = fixture();
    controller.begin("position", mode);
    controller.input("position", 60);
    await controller.finish("position", mode);
    controller.cancel();
    controller.cancel();
    await controller.change("position", 60);
    await controller.change("position", 70);
    await controller.change("position", 70);
    assert.deepEqual(
      calls.map((call) => call[2]),
      [{ position: 60 }, { position: 70 }],
      mode,
    );
  }
});

test("a distinct assistive edit works after a pointer gesture, ignoring trailing values", async () => {
  const { controller, calls } = fixture();
  controller.begin("position", "pointer");
  controller.input("position", 60);
  await controller.finish("position", "pointer");
  await controller.change("position", 60);
  await controller.change("position", 30);
  await controller.change("position", 75);
  assert.deepEqual(
    calls.map((call) => call[2]),
    [{ position: 60 }, { position: 75 }],
  );
});

test("STOP cannot retarget its second channel after synchronous reconfiguration", async () => {
  const { controller, hass, calls } = fixture();
  hass.states["cover.other"] = {
    ...hass.states["cover.example"],
    entity_id: "cover.other",
  };
  hass.callService = async (...args) => {
    calls.push(args);
    controller.configure(yaml("cover.other"));
  };
  await controller.stop();
  assert.deepEqual(calls, [
    ["cover", "stop_cover", {}, { entity_id: "cover.example" }],
  ]);
  assert.equal(controller.error, "");
});

test("cancelled gestures ignore late changes and allow a fresh explicit gesture", async () => {
  const { controller, calls } = fixture();
  controller.begin("position", "pointer");
  controller.input("position", 75);
  controller.cancel();
  controller.input("position", 80);
  await controller.finish("position", "pointer");
  await controller.change("position", 80);
  assert.equal(calls.length, 0);
  controller.begin("position", "pointer");
  controller.input("position", 50);
  await controller.finish("position", "pointer");
  assert.equal(calls.length, 1);
});

test("a cancelled pointer blocks stale events until termination, then accepts fresh assistive input", async () => {
  const { controller, calls } = fixture();
  controller.begin("position", "pointer");
  controller.input("position", 82);
  controller.cancel();
  controller.input("position", 90);
  await controller.change("position", 90);
  await controller.finish("position", "keyboard");
  assert.deepEqual(calls, []);

  await controller.finish("position", "pointer");
  await controller.change("position", 90);
  assert.deepEqual(calls, []);
  controller.input("position", 70);
  await controller.change("position", 70);
  assert.deepEqual(
    calls.map((call) => call[2]),
    [{ position: 70 }],
  );
});

test("retired controls release cancelled history for a fresh change-only assistive edit", async () => {
  const { controller, calls } = fixture();
  controller.begin("position", "pointer");
  controller.input("position", 82);
  controller.cancel();
  controller.retireGesture();
  await controller.finish("position", "pointer");
  assert.deepEqual(calls, []);
  await controller.change("position", 70);
  await controller.change("position", 70);
  assert.deepEqual(
    calls.map((call) => call[2]),
    [{ position: 70 }],
  );
});

test("availability loss cancels a gesture even if the cover returns before release", async () => {
  const { controller, hass, entity, calls } = fixture();
  controller.begin("tilt", "pointer");
  controller.input("tilt", 90);
  entity.state = "unavailable";
  controller.setHass({ ...hass });
  entity.state = "open";
  controller.setHass({ ...hass });
  await controller.finish("tilt", "pointer");
  await controller.change("tilt", 90);
  assert.deepEqual(calls, []);
});

test("capability and service changes between preview and commit prevent dispatch", async () => {
  for (const condition of ["feature", "service", "attribute", "connection"]) {
    const { controller, hass, entity, calls } = fixture();
    controller.begin("position", "pointer");
    controller.input("position", 90);
    if (condition === "feature") entity.attributes.supported_features = 128;
    if (condition === "service") delete hass.services.cover.set_cover_position;
    if (condition === "attribute") delete entity.attributes.current_position;
    if (condition === "connection") hass.connected = false;
    await controller.finish("position", "pointer");
    assert.equal(calls.length, 0);
    assert.notEqual(controller.error, "");
  }
});

test("invalid input cancels instead of clamping or coercing a target", async () => {
  const { controller, calls } = fixture();
  controller.begin("position", "pointer");
  controller.input("position", NaN);
  await controller.finish("position", "pointer");
  assert.deepEqual(calls, []);
});

test("reconfiguration and disconnection discard old gestures", async () => {
  const { controller, calls } = fixture();
  controller.begin("position", "pointer");
  controller.input("position", 85);
  controller.configure(yaml("cover.other"));
  await controller.finish("position", "pointer");
  controller.configure(yaml());
  controller.begin("position", "pointer");
  controller.input("position", 85);
  controller.setAttached(false);
  controller.setAttached(true);
  await controller.finish("position", "pointer");
  assert.deepEqual(calls, []);
});

test("invalid replacement configuration cannot leave the old entity actionable", async () => {
  const { controller, calls } = fixture();
  assert.throws(() => controller.configure({}), /Expected type/);
  await controller.perform("open");
  assert.deepEqual(calls, []);
  assert.equal(controller.config, undefined);
});

test("a pending request blocks further movement but STOP remains immediate", async () => {
  const waiting = deferred();
  const { controller, calls } = fixture({
    handler: (_domain, service) =>
      service === "set_cover_position" ? waiting.promise : Promise.resolve(),
  });
  const move = controller.perform("position", 80);
  assert.equal(controller.pending, true);
  assert.equal(controller.requested.value, 80);
  await controller.perform("close");
  assert.equal(calls.length, 1);
  await controller.stop();
  assert.deepEqual(
    calls.map((call) => call[1]),
    ["set_cover_position", "stop_cover", "stop_cover_tilt"],
  );
  assert.equal(controller.requested, undefined);
  waiting.reject(new Error("Old movement failed"));
  await move;
  assert.equal(controller.error, "");
  assert.equal(controller.pending, false);
});

test("STOP cancels a draft and trailing release cannot restart the motor", async () => {
  const { controller, calls } = fixture();
  controller.begin("position", "pointer");
  controller.input("position", 85);
  await controller.stop();
  controller.input("position", 90);
  await controller.finish("position", "pointer");
  await controller.change("position", 90);
  assert.deepEqual(
    calls.map((call) => call[1]),
    ["stop_cover", "stop_cover_tilt"],
  );
});

test("STOP attempts both supported channels even if lift stop throws synchronously", async () => {
  const { controller, hass, calls } = fixture();
  hass.callService = (...args) => {
    calls.push(args);
    if (args[1] === "stop_cover") throw new Error("lift refused");
    return Promise.resolve();
  };
  await controller.stop();
  assert.deepEqual(
    calls.map((call) => call[1]),
    ["stop_cover", "stop_cover_tilt"],
  );
  assert.match(controller.error, /lift refused/);
  assert.equal(controller.pending, false);
});

test("STOP invokes only independently supported lift or tilt channels", async () => {
  for (const [features, service] of [
    [8, "stop_cover"],
    [64, "stop_cover_tilt"],
  ]) {
    const { controller, calls } = fixture({ features, state: "unknown" });
    await controller.stop();
    assert.deepEqual(calls, [
      ["cover", service, {}, { entity_id: "cover.example" }],
    ]);
  }
});

test("failed commands show HA errors without retrying or changing reported state", async () => {
  const { controller, entity, calls } = fixture({
    handler: async () => {
      throw { message: "Device refused" };
    },
  });
  await controller.perform("position", 90);
  assert.equal(controller.error, "Device refused");
  assert.equal(
    controller.value("position"),
    entity.attributes.current_position,
  );
  assert.equal(controller.requested, undefined);
  assert.equal(controller.pending, false);
  assert.equal(calls.length, 1);
});

test("old async completion cannot clear a new entity's pending state or errors", async () => {
  const first = deferred();
  const second = deferred();
  const { controller, hass } = fixture({ handler: () => first.promise });
  const oldRequest = controller.perform("open");
  hass.states["cover.other"] = {
    ...hass.states["cover.example"],
    entity_id: "cover.other",
  };
  controller.configure(yaml("cover.other"));
  hass.callService = () => second.promise;
  const newRequest = controller.perform("close");
  first.reject(new Error("Stale failure"));
  await oldRequest;
  assert.equal(controller.pending, true);
  assert.equal(controller.error, "");
  second.reject(new Error("Current failure"));
  await newRequest;
  assert.equal(controller.pending, false);
  assert.equal(controller.error, "Current failure");
});
