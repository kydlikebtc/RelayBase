import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const catalog = JSON.parse(
  readFileSync("data/tikhub-catalog-reference.json", "utf8"),
);
const operationCount = catalog.stats.operationCount.toLocaleString("en-US");
const catalogDocTokens = [
  catalog.source.version,
  `${operationCount} 个`,
  `GET ${catalog.stats.methodCounts.GET}`,
  `POST ${catalog.stats.methodCounts.POST}`,
  `${catalog.stats.platformCount} 个平台`,
  `${catalog.stats.tagCount} 个`,
  `${catalog.stats.dataTypeCount} 个`,
];
for (const path of [
  "README.md",
  "CHANGELOG.md",
  "app/docs/page.tsx",
  "docs/TIKHUB-PROVENANCE.md",
]) {
  const document = readFileSync(path, "utf8");
  const missingTokens = catalogDocTokens.filter(
    (token) => !document.includes(token),
  );
  if (missingTokens.length > 0) {
    throw new Error(
      `${path} is out of sync with the TikHub catalog manifest: ${missingTokens.join(", ")}`,
    );
  }
}
for (const path of [
  "app/docs/page.tsx",
  "docs/TIKHUB-PROVENANCE.md",
]) {
  if (
    !readFileSync(path, "utf8").includes(
      catalog.source.snapshotSha256,
    )
  ) {
    throw new Error(
      `${path} is out of sync with the TikHub snapshot hash.`,
    );
  }
}
console.log("TikHub catalog documentation matches the committed manifest.");

const base = process.env.DOC_SYNC_BASE?.trim();
if (!base || /^0+$/.test(base)) {
  console.log("README/CHANGELOG diff gate skipped outside a comparable CI event.");
  process.exit(0);
}

const git = (...args) =>
  execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

try {
  git("cat-file", "-e", `${base}^{commit}`);
} catch {
  throw new Error(
    `DOC_SYNC_BASE ${base} is unavailable; checkout must use fetch-depth: 0`,
  );
}

let changedOutput;
try {
  changedOutput = git(
    "diff",
    "--name-only",
    "--diff-filter=ACMR",
    `${base}...HEAD`,
  );
} catch {
  changedOutput = git(
    "diff",
    "--name-only",
    "--diff-filter=ACMR",
    `${base}..HEAD`,
  );
}
const changed = changedOutput.split("\n").filter(Boolean);
const productFile = (path) =>
  /^(app|worker|db|drizzle|build|public|scripts)\//.test(path) ||
  path === "data/tikhub-catalog-reference.json" ||
  /^(\.openai\/hosting\.json|package(?:-lock)?\.json|vite\.config\.ts|next\.config\.ts|worker-configuration\.d\.ts)$/.test(
    path,
  );

if (!changed.some(productFile)) {
  console.log("No product, runtime, migration or release-tooling changes require doc sync.");
  process.exit(0);
}

const required = ["README.md", "CHANGELOG.md"];
const missing = required.filter((path) => !changed.includes(path));
if (missing.length > 0) {
  throw new Error(
    `Product changes must update README.md and CHANGELOG.md in the same change set; missing: ${missing.join(", ")}`,
  );
}

console.log("Product changes include synchronized README.md and CHANGELOG.md updates.");
