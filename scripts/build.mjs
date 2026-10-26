import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const project = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const projectLicense = await readFile(
  new URL("../LICENSE", import.meta.url),
  "utf8",
);
const { metafile, outputFiles } = await build({
  absWorkingDir: root,
  entryPoints: ["src/index.ts"],
  outfile: "dist/advanced-blind-card.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  legalComments: "inline",
  metafile: true,
  logLevel: "info",
  write: false,
});

if (outputFiles.length !== 1)
  throw new Error("Expected one standalone JS bundle.");

// esbuild metadata uses forward slashes, including with pnpm on Windows.
// Locate each actual input package after its last node_modules segment.
const packageRoots = new Set();
for (const input of Object.keys(metafile.inputs)) {
  const at = input.lastIndexOf("node_modules/");
  if (at < 0) continue;
  const prefix = at + "node_modules/".length;
  const parts = input.slice(prefix).split("/");
  const name = parts.slice(0, parts[0].startsWith("@") ? 2 : 1).join("/");
  packageRoots.add(input.slice(0, prefix) + name);
}
const notices = new Map();
for (const directory of [...packageRoots].sort()) {
  const [json, license] = await Promise.all([
    readFile(resolve(root, directory, "package.json"), "utf8"),
    readFile(resolve(root, directory, "LICENSE"), "utf8"),
  ]);
  const metadata = JSON.parse(json);
  const normalized = license.replaceAll("\r\n", "\n").trim();
  const packages = notices.get(normalized) ?? [];
  packages.push(`${metadata.name}@${metadata.version} (${metadata.license})`);
  notices.set(normalized, packages);
}
const notice = [
  `Advanced Blind Card v${project.version}`,
  projectLicense.replaceAll("\r\n", "\n").trim(),
  ...[...notices].map(
    ([license, packages]) =>
      `Bundled third-party packages:\n${packages.sort().join("\n")}\n\n${license}`,
  ),
].join("\n\n");
if (notice.includes("*/"))
  throw new Error("License notice contains a comment terminator.");
const bundle = `/*!\n${notice}\n*/\n${outputFiles[0].text}`;
const output = Object.values(metafile.outputs)[0];
output.bytes = Buffer.byteLength(bundle);

await mkdir(new URL("../dist/", import.meta.url), { recursive: true });
await writeFile(outputFiles[0].path, bundle);
await mkdir(new URL("../.cache/", import.meta.url), { recursive: true });
await writeFile(
  new URL("../.cache/build-meta.json", import.meta.url),
  JSON.stringify(metafile),
);
console.log(
  `Built advanced-blind-card.js (${output.bytes} bytes, complete license notices).`,
);
