import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("the browser bundle parses and has no external runtime dependencies", async () => {
  const metadata = JSON.parse(
    await readFile(
      new URL("../.cache/build-meta.json", import.meta.url),
      "utf8",
    ),
  );
  const outputs = Object.entries(metadata.outputs);
  assert.equal(outputs.length, 1);

  const [outputPath, output] = outputs[0];
  assert.deepEqual(output.imports, []);
  assert.ok(output.exports.includes("AdvancedBlindCard"));

  const bundlePath = fileURLToPath(
    new URL(`../${outputPath}`, import.meta.url),
  );
  assert.equal((await readFile(bundlePath)).length, output.bytes);
  const result = spawnSync(process.execPath, ["--check", bundlePath], {
    encoding: "utf8",
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});

test("standalone distribution carries complete project and actual bundled dependency licenses", async () => {
  const root = new URL("../", import.meta.url);
  const bundle = await readFile(
    new URL("dist/advanced-blind-card.js", root),
    "utf8",
  );
  const header = bundle.slice(0, bundle.indexOf("*/") + 2);
  const normalized = (value) => value.replaceAll("\r\n", "\n").trim();
  const project = JSON.parse(
    await readFile(new URL("package.json", root), "utf8"),
  );
  assert.ok(
    header.startsWith(`/*!\nAdvanced Blind Card v${project.version}\n`),
  );
  assert.ok(
    header.includes(
      normalized(await readFile(new URL("LICENSE", root), "utf8")),
    ),
  );
  assert.match(header, /Copyright \(c\) 2026 Petr Kurka/);

  const metadata = JSON.parse(
    await readFile(new URL(".cache/build-meta.json", root), "utf8"),
  );
  const roots = new Set();
  for (const input of Object.keys(metadata.inputs)) {
    const match = `/${input}`.match(
      /^(.*\/node_modules\/(?:@[^/]+\/)?[^/]+)\//,
    );
    if (match) roots.add(match[1].slice(1));
  }
  const names = [];
  for (const directory of roots) {
    const pkg = JSON.parse(
      await readFile(new URL(`${directory}/package.json`, root), "utf8"),
    );
    const license = await readFile(
      new URL(`${directory}/LICENSE`, root),
      "utf8",
    );
    names.push(pkg.name);
    assert.equal(pkg.license, "BSD-3-Clause");
    assert.ok(header.includes(`${pkg.name}@${pkg.version} (${pkg.license})`));
    assert.ok(
      header.includes(normalized(license)),
      `${pkg.name}: full license must travel in the JS`,
    );
  }
  assert.deepEqual(names.sort(), [
    "@lit/reactive-element",
    "lit",
    "lit-element",
    "lit-html",
  ]);
});

test("local distribution metadata agrees on the asset name and retains a private prerelease package", async () => {
  const root = new URL("../", import.meta.url);
  const project = JSON.parse(
    await readFile(new URL("package.json", root), "utf8"),
  );
  const hacs = JSON.parse(await readFile(new URL("hacs.json", root), "utf8"));
  assert.equal(project.name, "advanced-blind-card");
  assert.equal(project.private, true);
  assert.equal(project.license, "MIT");
  assert.match(project.version, /^\d+\.\d+\.\d+-beta\.\d+$/);
  assert.equal(hacs.name, "Advanced Blind Card");
  assert.equal(hacs.filename, `${project.name}.js`);
  assert.equal(hacs.render_readme, true);
  assert.equal(hacs.hide_default_branch, true);
  assert.equal(Object.hasOwn(hacs, "zip_release"), false);
  assert.equal(
    Object.hasOwn(hacs, "homeassistant"),
    false,
    "no unverified HA minimum",
  );
});
