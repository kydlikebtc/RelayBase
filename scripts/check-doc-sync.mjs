import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

const filesIn = (path) =>
  (() => {
    try {
      return readdirSync(path, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => `${path}/${entry.name}`);
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
  })();
const presentArtifacts = [
  ...filesIn("data").filter((path) => /catalog.*\.json$/i.test(path)),
  ...filesIn("scripts").filter((path) =>
    /generate-.*catalog-reference/i.test(path),
  ),
  ...filesIn("docs").filter((path) => /provider.*provenance/i.test(path)),
];
if (presentArtifacts.length > 0) {
  throw new Error(
    `Provider-derived catalog artifacts must not be committed: ${presentArtifacts.join(", ")}`,
  );
}

const publicDocuments = [
  ".env.example",
  ".github/PULL_REQUEST_TEMPLATE.md",
  "README.md",
  "CHANGELOG.md",
  "app/catalog/page.tsx",
  "app/catalog/CatalogClient.tsx",
  "app/console/ConsoleClient.tsx",
  "app/docs/page.tsx",
  "docs/RELEASES.md",
  "docs/UPSTREAM-INTEGRATION.md",
];
const prohibitedPublicPatterns = [
  /\b(?:api|docs|user)\.[a-z0-9-]+\.(?:io|dev)\b/i,
  /\bOpenAPI\s+V?\d+\.\d+\.\d+\b/i,
  /"(?:snapshotHash|snapshotSha256)"\s*:\s*"[0-9a-f]{64}"/i,
];
for (const path of publicDocuments) {
  const document = readFileSync(path, "utf8");
  const match = prohibitedPublicPatterns.find((pattern) =>
    pattern.test(document),
  );
  if (match) {
    throw new Error(
      `${path} exposes provider-specific catalog or documentation metadata (${match}).`,
    );
  }
}
console.log("Public documentation contains no committed provider catalog snapshot.");

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
