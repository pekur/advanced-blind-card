import assert from "node:assert/strict";
import { test } from "node:test";
import { CoverController } from "../src/controller.ts";
import { GroupController } from "../src/group.ts";
import {
  CONFIRMATION_MS,
  progressLabels,
  progressText,
} from "../src/progress.ts";

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function clock() {
  let now = 0;
  const tasks = new Set();
  return {
    now: () => now,
    schedule(callback, delay) {
      const task = { callback, at: now + delay };
      tasks.add(task);
      return () => tasks.delete(task);
    },
    advance(ms) {
      now += ms;
      for (const task of [...tasks])
        if (task.at <= now) {
          tasks.delete(task);
          task.callback();
        }
    },
    get size() {
      return tasks.size;
    },
  };
}
function fixture(handler = () => {}) {
  const calls = [],
    time = clock();
  let notifications = 0;
  const hass = {
    connected: true,
    language: "cs",
    states: Object.fromEntries(
      ["a", "b", "c"].map((id) => [
        `cover.${id}`,
        {
          entity_id: `cover.${id}`,
          state: "open",
          attributes: {
            current_position: 40,
            current_tilt_position: 100,
            supported_features: 255,
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
        ].map((service) => [service, {}]),
      ),
    },
    callService(...args) {
      calls.push(args);
      return handler(...args);
    },
  };
  const members = ["a", "b"].map((id) => {
    const controller = new CoverController(() => notifications++, time);
    controller.configureCover({ entity: `cover.${id}`, showButtons: true });
    controller.setHass(hass);
    controller.setAttached(true);
    return controller;
  });
  const [cover] = members;
  const group = new GroupController(members);
  const update = (id, changes = {}, state, stamp) => {
    const old = hass.states[`cover.${id}`];
    hass.states[`cover.${id}`] = {
      ...old,
      state: state ?? old.state,
      attributes: { ...old.attributes, ...changes },
      last_updated: stamp ?? old.last_updated,
    };
    for (const member of members) member.setHass({ ...hass });
    group.refresh();
  };
  return {
    cover,
    members,
    group,
    hass,
    update,
    time,
    calls,
    notifications: () => notifications,
  };
}
const code = (cover, axis = "position") => cover.progress.status(axis)?.code;
const groupCodes = (group, axis = "position") =>
  group.progressFor(axis)?.members.map((member) => member.status.code);

test("ACK retains the exact target and waits for relevant HA data without locking a new edit", async () => {
  const { cover, update, calls } = fixture();
  await cover.perform("position", 60);
  assert.equal(cover.pending, false);
  assert.equal(cover.reason("position"), null);
  assert.equal(code(cover), "waiting");
  assert.equal(cover.progress.status("position").target, 60);
  assert.equal(cover.reported("position"), 40);
  update("c", { current_position: 60 });
  update("a", { friendly_name: "Unrelated attribute" });
  assert.equal(code(cover), "waiting");
  update("a", { current_position: 60 }, "opening");
  assert.equal(
    code(cover),
    "moving",
    "a matching value while moving is not completion",
  );
  update("a", {}, "open");
  assert.equal(code(cover), "reached");
  assert.equal(calls.length, 1);
});

test("HA updates before ACK do not fake acceptance or lose a later reported target", async () => {
  const response = deferred();
  const { cover, update } = fixture(() => response.promise);
  const request = cover.perform("position", 60);
  update("a", { current_position: 60 });
  assert.equal(code(cover), "sending");
  response.resolve();
  await request;
  assert.equal(code(cover), "reached");
});

test("90/91 and fractional values remain near, never exact, and never send a correction", async () => {
  for (const reported of [89, 91, 90.00001, 90.5]) {
    const { cover, update, calls, time } = fixture();
    await cover.perform("tilt", 90);
    update("a", { current_tilt_position: reported });
    assert.equal(code(cover, "tilt"), "near");
    assert.equal(cover.reported("tilt"), reported);
    time.advance(CONFIRMATION_MS);
    assert.equal(code(cover, "tilt"), "near");
    assert.equal(calls.length, 1);
    update("a", { current_tilt_position: 90 });
    assert.equal(code(cover, "tilt"), "reached");
  }
  const { cover, update } = fixture();
  await cover.perform("tilt", 90);
  update("a", { current_tilt_position: 91.01 });
  assert.equal(code(cover, "tilt"), "waiting");
});

test("lift movement never implies tilt movement or exact completion", async () => {
  const { cover, update, calls } = fixture();
  await cover.perform("tilt", 90);
  update("a", { current_tilt_position: 90 }, "opening");
  assert.equal(code(cover, "tilt"), "waiting");
  update("a", { current_position: 55, current_tilt_position: 91 }, "open");
  assert.equal(code(cover, "tilt"), "near");
  assert.equal(calls.length, 1);
});

test("an initially matching target is labelled already reported, not a newly observed journey", async () => {
  const response = deferred();
  const { cover, update } = fixture(() => response.promise);
  const request = cover.perform("position", 40);
  update("a", {}, undefined, "2026-10-24T10:00:00Z");
  response.resolve();
  await request;
  assert.equal(code(cover), "already");
});

test("terminal results become historical after external motion and never restart an old goal", async () => {
  const { cover, update, calls, time } = fixture();
  await cover.perform("position", 60);
  update("a", { current_position: 60 });
  update("a", { current_position: 50 }, "closing");
  assert.equal(code(cover), "reached");
  assert.equal(cover.progress.status("position").historical, true);
  update("a", { current_position: 60 }, "open");
  assert.equal(cover.progress.status("position").historical, true);
  time.advance(CONFIRMATION_MS * 2);
  assert.equal(time.size, 0);
  assert.equal(calls.length, 1);
});

test("120s deadline updates UI without traffic or a fabricated error, and late data can confirm", async () => {
  const { cover, time, calls, notifications, update } = fixture();
  await cover.perform("position", 60);
  const before = notifications();
  time.advance(CONFIRMATION_MS - 1);
  assert.equal(code(cover), "waiting");
  time.advance(1);
  assert.equal(code(cover), "unconfirmed");
  assert.ok(notifications() > before);
  assert.equal(cover.error, "");
  assert.equal(calls.length, 1);
  assert.equal(time.size, 0);
  update("a", { current_position: 60 });
  assert.equal(code(cover), "reached");
});

test("deadline cannot release a pending service, fake motor stop, or disable supported STOP", async () => {
  const response = deferred();
  const { cover, time, calls, update } = fixture((_domain, service) =>
    service === "set_cover_position" ? response.promise : undefined,
  );
  const request = cover.perform("position", 60);
  update("a", {}, "opening");
  time.advance(CONFIRMATION_MS);
  assert.equal(code(cover), "unconfirmed");
  assert.equal(cover.progress.status("position").pending, true);
  assert.equal(cover.pending, true);
  assert.notEqual(cover.reason("position"), null);
  assert.equal(cover.reason("stop"), null);
  assert.equal(calls.length, 1);
  response.resolve();
  await request;
  assert.equal(cover.pending, false);
  assert.equal(code(cover), "unconfirmed");
});

test("unknown, disconnected, missing, unavailable, and lost capability remain explicit without retry", async () => {
  for (const kind of [
    "unknown",
    "disconnected",
    "missing",
    "unavailable",
    "missingValue",
    "unsupported",
  ]) {
    const { cover, hass, update, calls, time } = fixture();
    await cover.perform("tilt", 90);
    if (kind === "disconnected") hass.connected = false;
    if (kind === "missing") delete hass.states["cover.a"];
    if (kind === "missing" || kind === "disconnected")
      cover.setHass({ ...hass });
    else
      update(
        "a",
        kind === "missingValue"
          ? { current_tilt_position: undefined }
          : kind === "unsupported"
            ? { supported_features: 15 }
            : {},
        ["unknown", "unavailable"].includes(kind) ? kind : undefined,
      );
    assert.equal(
      code(cover, "tilt"),
      ["disconnected", "missing", "unavailable"].includes(kind)
        ? "unavailable"
        : kind === "unsupported"
          ? "unsupported"
          : "unknown",
    );
    time.advance(CONFIRMATION_MS * 2);
    assert.equal(calls.length, 1);
  }
});

test("STOP interrupts both independent goals; late success/failure and target data cannot revive them", async () => {
  for (const fail of [false, true]) {
    const response = deferred();
    const { cover, update, calls } = fixture((_domain, service) =>
      service === "set_cover_position" ? response.promise : undefined,
    );
    await cover.perform("tilt", 90);
    const request = cover.perform("position", 60);
    await cover.stop();
    assert.equal(code(cover), "interrupted");
    assert.equal(code(cover, "tilt"), "interrupted");
    assert.equal(cover.progress.stopStatus(), "accepted");
    update("a", { current_position: 60, current_tilt_position: 100 });
    if (fail) response.reject(new Error("late move error"));
    else response.resolve();
    await request;
    assert.equal(code(cover), "interrupted");
    assert.equal(cover.progress.status("position").pending, false);
    assert.equal(cover.progress.stopStatus(), "accepted");
    assert.deepEqual(
      calls.map((call) => call[1]),
      [
        "set_cover_tilt_position",
        "set_cover_position",
        "stop_cover",
        "stop_cover_tilt",
      ],
    );
  }
});

test("STOP reports pending, timeout and partial channel failure without claiming physical rest", async () => {
  const stop = deferred();
  const { cover, time, calls } = fixture((_domain, service) => {
    if (service === "stop_cover") return stop.promise;
    if (service === "stop_cover_tilt") throw new Error("tilt stop refused");
  });
  const request = cover.stop();
  assert.equal(cover.progress.stopStatus(), "sending");
  time.advance(CONFIRMATION_MS);
  assert.equal(cover.progress.stopStatus(), "unconfirmed");
  assert.equal(cover.pending, true);
  assert.equal(calls.length, 2);
  stop.resolve();
  await request;
  assert.equal(cover.progress.stopStatus(), "failed");
  assert.equal(time.size, 0);
});

test("new committed targets supersede old goals; preview/cancel never erase the real operation", async () => {
  const { cover, update, calls } = fixture();
  await cover.perform("position", 60);
  const old = cover.progress.get("position");
  cover.begin("position", "pointer");
  cover.input("position", 80);
  cover.cancel();
  assert.equal(cover.progress.get("position"), old);
  await cover.perform("position", 70);
  cover.progress.settle(old, "stale failure");
  update("a", { current_position: 60 });
  assert.equal(code(cover), "waiting");
  assert.equal(cover.progress.status("position").target, 70);
  assert.equal(calls.length, 2);
});

test("failed service remains failed despite matching data; invalid targets create no sent goal", async () => {
  const { cover, update, calls } = fixture(() => {
    throw new Error("refused");
  });
  await cover.perform("position", 60);
  update("a", { current_position: 60 });
  assert.equal(code(cover), "failed");
  assert.equal(cover.progress.status("position").reason, "refused");
  await cover.perform("tilt", 100.1);
  assert.equal(code(cover, "tilt"), undefined);
  assert.equal(calls.length, 1);
});

test("open/close track intent without fabricating endpoint data or requiring a position setter", async () => {
  const { cover, update } = fixture();
  update("a", { supported_features: 3, current_position: undefined });
  await cover.perform("open");
  assert.equal(code(cover), "unknown");
  assert.equal(cover.progress.status("position").target, 100);
  update("a", { current_position: 55 });
  assert.equal(
    code(cover),
    "waiting",
    "open with 55% is not a fully open endpoint",
  );
  update("a", { current_position: 100 });
  assert.equal(code(cover), "reached");
});

test("group tracks each original member, preserving near/mixed results instead of averaging", async () => {
  const { group, update, calls } = fixture();
  await group.perform("tilt", 90);
  update("a", { current_tilt_position: 91 });
  update("b", { current_tilt_position: 90 });
  assert.deepEqual(groupCodes(group, "tilt"), ["near", "reached"]);
  assert.equal(group.aggregate("tilt").text, "90–91%");
  assert.equal(group.progressFor("tilt").target, 90);
  assert.equal(calls.length, 2);
});

test("individual committed target replaces only its own group reference, not a sibling's progress", async () => {
  const { group, members, update } = fixture();
  await group.perform("position", 60);
  members[0].begin("position", "keyboard");
  members[0].input("position", 80);
  members[0].cancel();
  assert.deepEqual(groupCodes(group), ["waiting", "waiting"]);
  await members[0].perform("position", 70);
  assert.deepEqual(groupCodes(group), ["replaced", "waiting"]);
  assert.equal(group.progressFor("position").members[0].status.target, 70);
  update("b", { current_position: 60 });
  assert.deepEqual(groupCodes(group), ["replaced", "reached"]);
});

test("group ACK/failure/eligibility are per member, with no retries or hidden skipped motors", async () => {
  const slow = deferred();
  const { group, members, calls, update } = fixture(
    (_domain, _service, _data, target) =>
      target.entity_id === "cover.a"
        ? slow.promise
        : Promise.reject(new Error("refused")),
  );
  const request = group.perform("position", 60);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(code(members[0]), "sending");
  slow.resolve();
  await request;
  assert.deepEqual(groupCodes(group), ["waiting", "failed"]);
  update("a", { current_position: 60 });
  assert.deepEqual(groupCodes(group), ["reached", "failed"]);
  update("b", {}, "unavailable");
  await group.perform("tilt", 90);
  assert.deepEqual(groupCodes(group, "tilt"), ["waiting", "skipped"]);
  assert.equal(calls.length, 3);
});

test("group STOP counts motors once despite two service channels and preserves interrupted targets", async () => {
  const { group, calls, update } = fixture();
  await group.perform("position", 60);
  await group.stop();
  assert.equal(group.stopProgress().length, 2);
  assert.deepEqual(
    group.stopProgress().map((item) => item.status),
    ["accepted", "accepted"],
  );
  assert.deepEqual(groupCodes(group), ["interrupted", "interrupted"]);
  update("a", { current_position: 55, current_tilt_position: 100 });
  update("b", { current_position: 53, current_tilt_position: 100 });
  assert.deepEqual(groupCodes(group), ["interrupted", "interrupted"]);
  assert.equal(calls.length, 6);
});

test("configuration and detach remove histories/timers and late async responses stay inert", async () => {
  for (const reset of [
    (cover) => cover.setAttached(false),
    (cover) => cover.configureCover({ entity: "cover.c", showButtons: true }),
  ]) {
    const response = deferred();
    const { cover, time, calls } = fixture(() => response.promise);
    const request = cover.perform("position", 60);
    assert.equal(time.size, 1);
    reset(cover);
    assert.equal(time.size, 0);
    assert.equal(code(cover), undefined);
    response.resolve();
    await request;
    time.advance(CONFIRMATION_MS);
    assert.equal(code(cover), undefined);
    assert.equal(calls.length, 1);
  }
});

test("new axes share one nearest-deadline timer and completing one preserves the other's deadline", async () => {
  const { cover, time, update } = fixture();
  await cover.perform("position", 60);
  time.advance(30_000);
  await cover.perform("tilt", 90);
  assert.equal(time.size, 1);
  update("a", { current_position: 60 });
  time.advance(90_000);
  assert.equal(code(cover), "reached");
  assert.equal(code(cover, "tilt"), "waiting");
  time.advance(30_000);
  assert.equal(code(cover, "tilt"), "unconfirmed");
  assert.equal(time.size, 0);
});

test("new progress labels use Czech/English with fallback and never equate near or STOP ACK with completion", () => {
  assert.match(progressText({ code: "near" }, "cs-CZ"), /přesně nepotvrzeno/);
  assert.match(
    progressText({ code: "unconfirmed", pending: true }, "cs"),
    /odpověď služby/,
  );
  assert.match(
    progressText({ code: "reached", historical: true }, "en-US"),
    /Last result/,
  );
  assert.match(progressLabels("cs").stopAccepted, /zastavení nepotvrzeno/);
  assert.equal(progressLabels("de"), progressLabels());
});

test("a known STOP channel failure is visible while the other response is pending", async () => {
  const response = deferred();
  const { cover, calls } = fixture((_domain, service) => {
    if (service === "stop_cover") return response.promise;
    throw new Error("tilt channel refused");
  });
  const request = cover.stop();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(cover.progress.stopFailed(), true);
  assert.equal(cover.progress.stopStatus(), "sending");
  assert.equal(cover.pending, true);
  assert.equal(calls.length, 2);
  response.resolve();
  await request;
  assert.equal(cover.progress.stopStatus(), "failed");
});

test("STOP cannot rewrite a previously reached or failed goal as an interrupted journey", async () => {
  const { cover, update } = fixture();
  await cover.perform("position", 60);
  update("a", { current_position: 60 });
  await cover.stop();
  assert.equal(code(cover), "reached");
  assert.equal(cover.progress.stopStatus(), "accepted");
  const failed = fixture((_domain, service) => {
    if (service === "set_cover_position") throw new Error("move refused");
  });
  await failed.cover.perform("position", 60);
  await failed.cover.stop();
  assert.equal(code(failed.cover), "failed");
});

test("a blocked group attempt cannot hide an already dispatched pending goal", async () => {
  const response = deferred();
  const { group } = fixture(() => response.promise);
  const request = group.perform("position", 60);
  await group.perform("position", 80);
  assert.equal(group.progressFor("position").target, 60);
  assert.deepEqual(groupCodes(group), ["sending", "sending"]);
  response.resolve();
  await request;
  assert.deepEqual(groupCodes(group), ["waiting", "waiting"]);
});

for (const axis of ["position", "tilt"]) {
  for (const history of ["none", "other", "same"]) {
    test(`individual ${axis} result stays visible with ${history} group history after ACK`, async () => {
      let refused = false;
      const { cover, group, time, calls, update } = fixture(() => {
        if (refused) throw new Error("individual refused");
      });
      if (history !== "none")
        await group.perform(
          history === "same" ? axis : axis === "position" ? "tilt" : "position",
          50,
        );
      await cover.perform(axis, 90);
      const entry = () => group.individualProgressFor(axis);
      const expectedCalls = history === "none" ? 1 : 3;
      assert.equal(cover.pending, false);
      assert.deepEqual(
        entry().map((member) => [
          member.entity,
          member.status.target,
          member.status.code,
        ]),
        [["cover.a", 90, "waiting"]],
      );
      assert.equal(entry()[0].reported, axis === "tilt" ? 100 : 40);
      assert.equal(
        group.progressFor(axis)?.target,
        history === "same" ? 50 : undefined,
      );
      if (history === "same")
        assert.deepEqual(groupCodes(group, axis), ["replaced", "waiting"]);
      time.advance(CONFIRMATION_MS);
      assert.equal(entry()[0].status.code, "unconfirmed");
      const attribute =
        axis === "tilt" ? "current_tilt_position" : "current_position";
      update("a", { [attribute]: 91 });
      assert.equal(entry()[0].status.code, "near");
      assert.equal(entry()[0].reported, 91);
      update("a", { [attribute]: 90 });
      assert.equal(entry()[0].status.code, "reached");
      update("a", { [attribute]: 85 });
      assert.equal(entry()[0].status.historical, true);
      assert.equal(
        calls.length,
        expectedCalls,
        "reading progress and updates must never dispatch a correction",
      );
      refused = true;
      await cover.perform(axis, 80);
      assert.equal(entry()[0].status.code, "failed");
      assert.equal(entry()[0].status.target, 80);
      assert.equal(entry()[0].status.reason, "individual refused");
      assert.equal(calls.length, expectedCalls + 1);
    });
  }
}

test("group/member previews preserve live individual results until a new common commit", async () => {
  const { cover, group, calls } = fixture();
  assert.deepEqual(group.individualProgressFor("tilt"), []);
  await cover.perform("tilt", 90);
  cover.begin("tilt", "keyboard");
  cover.input("tilt", 70);
  cover.cancel();
  group.begin("tilt", "pointer");
  group.input("tilt", 60);
  group.cancel();
  assert.equal(
    group.progressFor("tilt"),
    undefined,
    "an individual or preview target must not invent a common target",
  );
  assert.equal(group.individualProgressFor("tilt")[0].status.target, 90);
  assert.equal(calls.length, 1);
  await group.perform("tilt", 80);
  assert.deepEqual(group.individualProgressFor("tilt"), []);
  assert.equal(group.progressFor("tilt").target, 80);
  assert.deepEqual(groupCodes(group, "tilt"), ["waiting", "waiting"]);
  assert.equal(calls.length, 3);
});

test("different individual targets remain distinct and STOP interrupts both without a common target", async () => {
  const { members, group, calls } = fixture();
  await members[0].perform("position", 90);
  await members[1].perform("position", 70);
  assert.equal(group.progressFor("position"), undefined);
  assert.deepEqual(
    group
      .individualProgressFor("position")
      .map((member) => member.status.target),
    [90, 70],
  );
  await group.stop();
  assert.deepEqual(
    group.individualProgressFor("position").map((member) => member.status.code),
    ["interrupted", "interrupted"],
  );
  assert.equal(calls.length, 6);
  group.dispose();
  for (const member of members) member.setAttached(false);
  assert.deepEqual(group.individualProgressFor("position"), []);
});

test("individual endpoints remain distinct and missing values cannot hide their targets", async () => {
  const { members, group, update, calls } = fixture();
  await members[0].perform("tilt", 0);
  await members[1].perform("tilt", 100);
  assert.deepEqual(
    group.individualProgressFor("tilt").map((member) => member.status.target),
    [0, 100],
  );
  assert.equal(group.progressFor("tilt"), undefined);
  update("a", { current_tilt_position: undefined });
  const first = group.individualProgressFor("tilt")[0];
  assert.equal(first.status.target, 0);
  assert.equal(first.reported, null);
  assert.equal(first.status.code, "unknown");
  assert.equal(calls.length, 2);
});
