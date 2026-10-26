import assert from "node:assert/strict";
import { test } from "node:test";
import { CoverController } from "../src/controller.ts";
import { GroupController } from "../src/group.ts";
import { parseConfig } from "../src/model.ts";

const yaml = (blinds) => ({ type: "custom:advanced-blind-card", blinds });
const singles = [{ entity: "cover.a" }, { entity: "cover.b" }];
const grouped = (extra = {}) => yaml([{ entities: singles, ...extra }]);
function fixture(handler = () => {}) {
  const calls = [];
  const hass = {
    connected: true,
    states: Object.fromEntries(
      ["a", "b", "c"].map((id, index) => [
        `cover.${id}`,
        {
          entity_id: `cover.${id}`,
          state: "open",
          attributes: {
            current_position: 40 + index * 20,
            current_tilt_position: 20,
            supported_features: 255,
            friendly_name: id.toUpperCase(),
          },
        },
      ]),
    ),
    services: {
      cover: Object.fromEntries(
        [
          "set_cover_position",
          "set_cover_tilt_position",
          "open_cover",
          "close_cover",
          "stop_cover",
          "stop_cover_tilt",
        ].map((key) => [key, {}]),
      ),
    },
    callService: (...args) => {
      calls.push(args);
      return handler(...args);
    },
  };
  const members = singles.map((config) => {
    const member = new CoverController();
    member.configureCover({ ...config, showButtons: true });
    member.setHass(hass);
    member.setAttached(true);
    return member;
  });
  const group = new GroupController(members);
  const refresh = () => {
    for (const member of members) member.setHass({ ...hass });
    group.refresh();
  };
  return { members, group, hass, calls, refresh };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test("multiple rows and groups normalize without changing the single-cover contract", () => {
  const config = parseConfig(
    yaml([
      { entity: "cover.c", name: " C " },
      { name: " Pair ", entities: singles },
      {
        entities: [{ entity: "cover.d" }, { entity: "cover.e" }],
        expandable: false,
      },
    ]),
  );
  assert.equal(config.rows.length, 3);
  assert.equal(config.rows[0].name, "C");
  assert.equal(config.rows[1].name, "Pair");
  assert.equal(config.rows[1].expandable, true);
  assert.equal(config.rows[2].expandable, false);
  assert.deepEqual(
    config.rows[1].members.map((member) => member.entity),
    ["cover.a", "cover.b"],
  );
  assert.ok(Object.isFrozen(config.rows[1].members[0]));
  assert.ok(Object.isFrozen(config.rows));
});

test("ambiguous, nested, singleton and duplicate configurations identify the offending path", () => {
  for (const config of [
    grouped({ entity: "cover.c" }),
    grouped({ entities: [] }),
    grouped({ entities: [{ entity: "cover.a" }] }),
    grouped({ expandable: "true" }),
    grouped({ entities: [{ entities: singles }, { entity: "cover.c" }] }),
    grouped({ entities: [{ entity: "cover.a" }, { entity: "cover.a" }] }),
    yaml([{ entity: "cover.a" }, { entities: singles }]),
    yaml([{ entity: "cover.a", expandable: true }]),
  ])
    assert.throws(() => parseConfig(config), /blinds\[/);
  assert.throws(
    () => parseConfig(yaml([{ entity: "cover.a" }, { entities: singles }])),
    /blinds\[1\].entities\[0\].entity duplicates/,
  );
});

test("aggregate values expose ranges, axis-specific uncertainty and unavailable members", () => {
  const { group, hass, calls, refresh } = fixture();
  assert.deepEqual(group.aggregate("position"), {
    value: null,
    text: "40–60%",
  });
  assert.equal(group.reported("tilt"), 20);
  hass.states["cover.b"].attributes.current_position = null;
  refresh();
  assert.equal(group.aggregate("position").text, "40% · 1 unknown");
  assert.equal(group.reported("position"), null);
  hass.states["cover.b"].state = "unavailable";
  refresh();
  assert.equal(group.aggregate("position").text, "40% · 1 unavailable");
  assert.match(group.state(), /unavailable/);
  hass.states["cover.b"].state = "open";
  hass.states["cover.b"].attributes.supported_features = 0;
  refresh();
  assert.match(group.aggregate("position").text, /unknown.*unsupported/);
  assert.deepEqual(calls, []);
});

test("compact headers retain incomplete ranges and full descriptions retain member uncertainty", () => {
  const { group, hass, calls, refresh } = fixture();
  assert.deepEqual(group.aggregate("position", "en", true), {
    value: null,
    text: "40–60%",
  });
  hass.states["cover.b"].attributes.current_position = null;
  refresh();
  assert.deepEqual(group.aggregate("position", "en", true), {
    value: null,
    text: "40% + ?",
  });
  assert.equal(group.aggregate("position").text, "40% · 1 unknown");
  hass.states["cover.b"].state = "unavailable";
  refresh();
  assert.equal(group.aggregate("position", "cs", true).text, "40% + ?");
  assert.equal(group.aggregate("position", "cs").text, "40% · Nedostupné: 1");
  assert.deepEqual(calls, []);
});

test("compact read-only readings stay known and formatting never changes command eligibility", async () => {
  const { group, hass, calls, members, refresh } = fixture();
  hass.states["cover.b"].attributes.supported_features = 8;
  refresh();
  const eligibility = group.eligibility("tilt");
  assert.deepEqual(group.aggregate("tilt", "en", true), {
    value: 20,
    text: "20%",
  });
  assert.equal(group.aggregate("tilt").text, "20% · 1 unsupported");
  assert.equal(group.eligibility("tilt"), eligibility);
  assert.deepEqual(calls, []);
  await group.perform("tilt", 55);
  assert.deepEqual(
    calls.map((args) => [args[1], args[2], args[3]]),
    [
      [
        "set_cover_tilt_position",
        { tilt_position: 55 },
        { entity_id: "cover.a" },
      ],
    ],
  );
  for (const member of members) member.setAttached(false);
});

test("fully unavailable compact headers never invent a percentage or repeat an unknown marker", () => {
  const { group, hass, calls, refresh } = fixture();
  for (const entity of Object.values(hass.states)) entity.state = "unavailable";
  refresh();
  assert.deepEqual(group.aggregate("position", "en", true), {
    value: null,
    text: "Unknown",
  });
  assert.equal(group.aggregate("position").text, "Unknown · 2 unavailable");
  assert.deepEqual(calls, []);
});

test("mixed group pointer gestures require explicit input and commit one exact target to each member", async () => {
  const { group, calls } = fixture();
  group.begin("position", "pointer");
  await group.finish("position", "pointer");
  assert.deepEqual(calls, []);
  group.begin("position", "pointer");
  group.input("position", 0);
  assert.deepEqual(calls, []);
  await group.finish("position", "pointer");
  await group.change("position", 0);
  assert.deepEqual(calls, [
    ["cover", "set_cover_position", { position: 0 }, { entity_id: "cover.a" }],
    ["cover", "set_cover_position", { position: 0 }, { entity_id: "cover.b" }],
  ]);
  assert.equal(group.reported("position"), null);
});

test("partial eligibility skips unavailable, unsupported and missing-axis members visibly", async () => {
  for (const condition of [
    "unavailable",
    "unsupported",
    "missing",
    "unknown",
  ]) {
    const { group, hass, calls, refresh } = fixture();
    const entity = hass.states["cover.b"];
    if (condition === "unavailable" || condition === "unknown")
      entity.state = condition;
    if (condition === "unsupported") entity.attributes.supported_features = 8;
    if (condition === "missing") delete entity.attributes.current_position;
    refresh();
    assert.match(group.coverage("position"), /Controls 1 of 2.*cover.b/);
    const results = await group.perform("position", 70);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0][3], { entity_id: "cover.a" });
    assert.deepEqual(
      results.map((r) => r.status),
      ["accepted", "skipped"],
    );
    assert.match(group.error, /cover.b/);
  }
});

test("synchronous and asynchronous failures do not mask success or trigger retries", async () => {
  for (const synchronous of [true, false]) {
    const { group, calls } = fixture((_domain, _service, _data, target) => {
      if (target.entity_id === "cover.a") {
        if (synchronous) throw new Error("refused");
        return Promise.reject(new Error("refused"));
      }
    });
    const results = await group.perform("tilt", 75);
    assert.deepEqual(
      results.map((r) => r.status),
      ["failed", "accepted"],
    );
    assert.match(group.error, /cover.a.*refused/);
    assert.equal(calls.length, 2);
    assert.ok(
      calls.every(
        (call) =>
          call[1] === "set_cover_tilt_position" && call[2].tilt_position === 75,
      ),
    );
  }
});

test("group fan-out does not wait for one motor response, and a sibling acts independently", async () => {
  const held = deferred();
  const { group, members, hass, calls } = fixture(
    (_domain, _service, _data, target) =>
      target.entity_id === "cover.a" ? held.promise : undefined,
  );
  const pending = group.perform("position", 80);
  assert.equal(calls.length, 2);
  assert.equal(group.pending, true);
  assert.match(group.reason("tilt"), /Waiting/);
  // The other member's immediate HA response must settle before a new request.
  await new Promise((resolve) => setImmediate(resolve));
  await members[1].perform("tilt", 45);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[2].slice(1), [
    "set_cover_tilt_position",
    { tilt_position: 45 },
    { entity_id: "cover.b" },
  ]);
  hass.states["cover.b"].attributes.current_position = 80;
  assert.equal(group.aggregate("position").text, "40–80%");
  held.resolve();
  await pending;
});

test("individual actions and differently timed HA updates never synchronize members", async () => {
  const { group, members, calls, hass, refresh } = fixture();
  await members[0].perform("position", 90);
  hass.states["cover.a"].attributes.current_position = 50;
  refresh();
  assert.equal(group.aggregate("position").text, "50–60%");
  hass.states["cover.a"].attributes.current_position = 90;
  refresh();
  assert.equal(group.aggregate("position").text, "60–90%");
  assert.equal(calls.length, 1);
});

test("eligibility loss and recovery cancel a group draft; incoming percentages alone do not", async () => {
  const { group, hass, refresh, calls } = fixture();
  group.begin("position", "pointer");
  group.input("position", 80);
  hass.states["cover.b"].attributes.current_position = 65;
  refresh();
  assert.equal(group.value("position"), 80);
  hass.states["cover.b"].state = "unavailable";
  refresh();
  hass.states["cover.b"].state = "open";
  refresh();
  await group.finish("position", "pointer");
  await group.change("position", 80);
  assert.deepEqual(calls, []);
});

test("group and member gestures cancel each other without completing stale input", async () => {
  const { group, members, calls } = fixture();
  members[0].begin("position", "keyboard");
  members[0].input("position", 90);
  group.begin("tilt", "pointer");
  group.input("tilt", 70);
  await members[0].finish("position", "keyboard");
  members[1].begin("position", "pointer");
  members[1].input("position", 85);
  await group.finish("tilt", "pointer");
  assert.deepEqual(calls, []);
  await members[1].finish("position", "pointer");
  assert.deepEqual(
    calls.map((call) => call[3].entity_id),
    ["cover.b"],
  );
});

test("STOP remains immediate during pending movement and late errors cannot replace STOP results", async () => {
  const held = deferred();
  const { group, members, calls } = fixture((_domain, service) =>
    service === "set_cover_position" ? held.promise : undefined,
  );
  const pending = group.perform("position", 80);
  const results = await group.stop();
  assert.equal(results.length, 4);
  assert.equal(calls.length, 6);
  held.reject(new Error("late move failure"));
  await pending;
  assert.ok(
    group.results.every(
      (r) => r.status === "accepted" && ["stop", "stopTilt"].includes(r.action),
    ),
  );
  assert.equal(group.error, "");
  assert.ok(members.every((member) => member.error === ""));
});

test("synchronous STOP during fan-out prevents all remaining move sends", async () => {
  let group, stopping;
  const state = fixture((_domain, service) => {
    if (service === "set_cover_position") stopping = group.stop();
  });
  group = state.group;
  await group.perform("position", 80);
  await stopping;
  assert.equal(
    state.calls.filter((call) => call[1] === "set_cover_position").length,
    1,
  );
  assert.equal(
    state.calls.filter((call) => call[1].startsWith("stop_")).length,
    4,
  );
  assert.equal(group.error, "");
});

test("member STOP prevents that member's not-yet-sent group start only", async () => {
  let members, stopping;
  const state = fixture((_domain, service, _data, target) => {
    if (service === "set_cover_position" && target.entity_id === "cover.a")
      stopping = members[1].stop();
  });
  members = state.members;
  const results = await state.group.perform("position", 80);
  await stopping;
  assert.equal(
    state.calls.filter((call) => call[1] === "set_cover_position").length,
    1,
  );
  assert.equal(results[1].status, "skipped");
});

test("a fresh member gesture invalidates its not-yet-sent group start", async () => {
  let members;
  const state = fixture((_domain, service, _data, target) => {
    if (service === "set_cover_position" && target.entity_id === "cover.a")
      members[1].begin("tilt", "pointer");
  });
  members = state.members;
  const results = await state.group.perform("position", 80);
  assert.equal(state.calls.length, 1);
  assert.equal(results[1].status, "skipped");
  assert.equal(members[1].draft.axis, "tilt");
});

test("disposal during synchronous dispatch prevents further targets and ignores old results", async () => {
  let group;
  const state = fixture(() => group.dispose());
  group = state.group;
  await group.perform("position", 70);
  assert.equal(state.calls.length, 1);
  assert.deepEqual(group.results, []);
});

test("STOP attempts all independently supported channels even after another rejects", async () => {
  const { group, members, hass, calls, refresh } = fixture(
    (_domain, service) => {
      if (service === "stop_cover") throw new Error("lift refused");
    },
  );
  hass.states["cover.a"].attributes.supported_features = 8;
  hass.states["cover.b"].attributes.supported_features = 64;
  refresh();
  const results = await group.stop();
  assert.deepEqual(
    calls.map((call) => [call[1], call[3].entity_id]),
    [
      ["stop_cover", "cover.a"],
      ["stop_cover_tilt", "cover.b"],
    ],
  );
  assert.deepEqual(
    results.map((r) => r.status),
    ["failed", "accepted"],
  );
  assert.match(members[0].error, /lift refused/);
});

test("no group slider action is enabled without an eligible member, while supported STOP remains", () => {
  const { group, hass, refresh, calls } = fixture();
  for (const entity of Object.values(hass.states)) entity.state = "unknown";
  refresh();
  assert.match(group.reason("position"), /No eligible/);
  assert.equal(group.reason("stop"), null);
  assert.deepEqual(calls, []);
});

test("last-moment eligibility recheck cancels a group gesture even without a refresh callback", async () => {
  const { group, hass, calls } = fixture();
  group.begin("position", "pointer");
  group.input("position", 80);
  hass.states["cover.b"].attributes.supported_features = 8;
  await group.finish("position", "pointer");
  assert.deepEqual(calls, []);
});

test("unrelated key/axis releases cannot cancel or prematurely commit a group drag", async () => {
  const { group, calls } = fixture();
  group.begin("position", "pointer");
  group.input("position", 75);
  await group.finish("tilt", "keyboard");
  await group.finish("position", "keyboard");
  assert.equal(group.draft.value, 75);
  assert.deepEqual(calls, []);
  await group.finish("position", "pointer");
  assert.equal(calls.length, 2);
});

test("a group button action cancels its own draft and trailing completion cannot send the old target", async () => {
  for (const axis of ["position", "tilt"]) {
    for (const mode of ["pointer", "keyboard", "assistive"]) {
      for (const action of ["open", "close"]) {
        const { group, calls } = fixture();
        group.begin(axis, mode);
        group.input(axis, 80);
        await group.perform(action);
        await group.finish(axis, mode);
        await group.change(axis, 80);
        assert.deepEqual(
          calls,
          ["cover.a", "cover.b"].map((entity_id) => [
            "cover",
            action === "open" ? "open_cover" : "close_cover",
            {},
            { entity_id },
          ]),
        );
        assert.equal(group.draft, undefined);
        // A subsequent explicit interaction is still allowed.
        group.begin("position", "keyboard");
        group.input("position", 70);
        await group.finish("position", "keyboard");
        assert.equal(calls.length, 4);
        assert.ok(
          calls
            .slice(2)
            .every(
              (call) =>
                call[1] === "set_cover_position" && call[2].position === 70,
            ),
        );
      }
    }
  }
});

test("group draft stays cancelled during and after a superseding button's pending response", async () => {
  const held = deferred();
  const { group, calls } = fixture(() => held.promise);
  group.begin("position", "keyboard");
  group.input("position", 80);
  const opening = group.perform("open");
  await group.finish("position", "keyboard");
  await group.change("position", 80);
  assert.equal(calls.length, 2);
  held.resolve();
  await opening;
  await group.finish("position", "keyboard");
  await group.change("position", 80);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call[1] === "open_cover"));
});
