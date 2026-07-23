import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const readText = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const readJson = async (path) => JSON.parse(await readText(path));

const [packageJson, packageLock, versionFile, changelog, readme] =
  await Promise.all([
    readJson("package.json"),
    readJson("package-lock.json"),
    readText("VERSION"),
    readText("CHANGELOG.md"),
    readText("README.md"),
  ]);

const version = packageJson.version;
const escapeRegExp = (value) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
assert.match(
  version,
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*)|(?:\d*[A-Za-z-][0-9A-Za-z-]*))(?:\.(?:(?:0|[1-9]\d*)|(?:\d*[A-Za-z-][0-9A-Za-z-]*)))*)?$/,
  "package.json must contain a valid semantic version",
);
assert.equal(
  packageLock.version,
  version,
  "package-lock.json top-level version must match package.json",
);
assert.equal(
  packageLock.packages?.[""]?.version,
  version,
  "package-lock.json root package version must match package.json",
);
assert.equal(
  versionFile.trim(),
  version,
  "VERSION must match package.json",
);
assert.ok(
  new RegExp(
    `^## \\[${escapeRegExp(version)}\\] - \\d{4}-\\d{2}-\\d{2}$`,
    "m",
  ).test(changelog),
  `CHANGELOG.md must contain one dated release section for ${version}`,
);
assert.equal(
  changelog.match(
    new RegExp(`^## \\[${escapeRegExp(version)}\\] - `, "gm"),
  )?.length ?? 0,
  1,
  `CHANGELOG.md must contain exactly one release section for ${version}`,
);
assert.ok(
  readme.includes(`当前应用版本：\`v${version}\``),
  `README.md must identify the current application version ${version}`,
);
if (process.env.GITHUB_REF_TYPE === "tag") {
  assert.equal(
    process.env.GITHUB_REF_NAME,
    `v${version}`,
    "Git tag must exactly match package.json as v<version>",
  );
}

console.log(`RelayBase version metadata is consistent: v${version}`);
