import assert from "node:assert/strict";
import { test } from "node:test";
import { CoverController } from "../src/controller.ts";
import { GroupController } from "../src/group.ts";
import {
  errorNotice,
  MessageError,
  noticeText,
  stateText,
  text,
} from "../src/localize.ts";
import { actionReasonKey, parseConfig } from "../src/model.ts";
import { progressLabels } from "../src/progress.ts";

function fixture() {
  const calls = [];
  const hass = {
    connected: true,
    language: "en",
    states: Object.fromEntries(
      ["a", "b"].map((id) => [
        `cover.${id}`,
        {
          entity_id: `cover.${id}`,
          state: "open",
          attributes: {
            supported_features: 255,
            current_position: 30,
            current_tilt_position: 50,
          },
        },
      ]),
    ),
    services: {
      cover: Object.fromEntries(
        [
          "set_cover_position",
          "set_cover_tilt_position",
          "stop_cover",
          "stop_cover_tilt",
          "open_cover",
          "close_cover",
        ].map((s) => [s, {}]),
      ),
    },
    callService: async (...args) => {
      calls.push(args);
    },
  };
  const members = ["a", "b"].map((id) => {
    const cover = new CoverController();
    cover.configure({
      type: "custom:advanced-blind-card",
      blinds: [{ entity: `cover.${id}` }],
    });
    cover.setAttached(true);
    cover.setHass(hass);
    return cover;
  });
  return { calls, hass, members, group: new GroupController(members) };
}

test("cs regional language variants and fallback agree with progress labels", () => {
  for (const language of ["cs", "cs-CZ", "CS-cz", "cs_CZ"]) {
    assert.equal(text("position", language), "Poloha");
    assert.equal(progressLabels(language).target, "Cíl");
  }
  for (const language of [undefined, "en-US", "de", "csharp", ""])
    assert.equal(text("position", language), "Position");
  assert.equal(
    text("coverage", "cs", { eligible: 1, total: 2 }),
    "Ovládá 1 z 2",
  );
  assert.equal(stateText("closed", "cs"), "Zavřeno");
  assert.equal(stateText("toString", "cs"), "toString");
});

test("typed validation keeps paths and renders per language without parsing English", () => {
  let detail;
  try {
    parseConfig({
      type: "custom:advanced-blind-card",
      blinds: [{ entity: "cover.a", show_values: 1 }],
    });
  } catch (error) {
    assert.ok(error instanceof MessageError);
    assert.match(error.message, /blinds\[0\].show_values.*boolean/);
    detail = errorNotice(error);
  }
  assert.deepEqual(detail, {
    key: "boolean",
    params: { path: "blinds[0].show_values" },
  });
  assert.equal(
    noticeText(detail, "cs"),
    "blinds[0].show_values musí být true nebo false.",
  );
});

test("backend errors that look like internal English errors stay verbatim", async () => {
  const {
    hass,
    members: [cover],
  } = fixture();
  hass.callService = async () => {
    throw new Error("Current value is unknown.");
  };
  const [result] = await cover.perform("position", 40);
  assert.equal(result.reason, "Current value is unknown.");
  assert.equal(cover.errorText("cs"), "Current value is unknown.");
  assert.equal(
    cover.progress.status("position").reason,
    "Current value is unknown.",
  );
  cover.setAttached(false);
});

test("internal skipped errors remain translatable after the attempt", async () => {
  const {
    hass,
    members: [cover],
  } = fixture();
  hass.connected = false;
  const [result] = await cover.perform("position", 40);
  assert.equal(actionReasonKey(cover.snapshot, "position"), "haDisconnected");
  assert.equal(result.status, "skipped");
  assert.equal(noticeText(result.reason, "cs"), "Home Assistant je odpojený.");
  assert.equal(cover.errorText("en"), "Home Assistant is disconnected.");
  assert.equal(cover.errorText("cs"), "Home Assistant je odpojený.");
});

test("language changes do not cancel a group gesture or alter exact command payloads", async () => {
  const { calls, hass, members, group } = fixture();
  const signature = group.eligibility("position");
  assert.equal(group.begin("position", "keyboard"), true);
  group.input("position", 40);
  hass.language = "cs-CZ";
  for (const member of members) member.setHass({ ...hass });
  group.refresh();
  assert.equal(group.eligibility("position"), signature);
  assert.ok(group.draft);
  assert.equal(calls.length, 0);
  await group.finish("position", "keyboard");
  assert.deepEqual(
    calls.map(([domain, service, data, target]) => ({
      domain,
      service,
      data,
      target,
    })),
    ["a", "b"].map((id) => ({
      domain: "cover",
      service: "set_cover_position",
      data: { position: 40 },
      target: { entity_id: `cover.${id}` },
    })),
  );
  for (const member of members) member.setAttached(false);
});

test("mixed group and skipped member reasons localize without inventing a mean", async () => {
  const { hass, members, group } = fixture();
  hass.states["cover.b"].state = "unavailable";
  assert.deepEqual(group.aggregate("position", "cs"), {
    value: null,
    text: "30% · Nedostupné: 1",
  });
  assert.match(
    group.coverage("position", "cs"),
    /Ovládá 1 z 2.*Entita je nedostupná/,
  );
  await group.perform("position", 40);
  assert.match(group.errorText("cs"), /cover.b.*Poloha.*Entita je nedostupná/);
  assert.match(group.state("cs"), /Nedostupné/);
  for (const member of members) member.setAttached(false);
});
