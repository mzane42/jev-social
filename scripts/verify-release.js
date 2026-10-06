import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const STABLE_SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

function requireEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message}: expected ${expected}, received ${actual}`);
}

export function verifyNpmVersion(value) {
  const version = String(value ?? "").trim();
  const match = STABLE_SEMVER_PATTERN.exec(version);
  if (!match) throw new Error("npm CLI version must be a stable semantic version");
  const numbers = match.slice(1, 4).map(Number);
  const minimum = [11, 5, 1];
  const supported = numbers.some((number, index) => (
    number > minimum[index]
    && numbers.slice(0, index).every((part, prior) => part === minimum[prior])
  )) || numbers.every((number, index) => number === minimum[index]);
  if (!supported) throw new Error("trusted publishing requires npm 11.5.1 or newer");
  return version;
}

export function verifyReleaseMetadata({
  packageJson,
  packageLock,
  codexManifest,
  grokManifest,
  skillContents,
  releaseTag,
  eventCommit,
  checkoutCommit,
}) {
  requireEqual(packageJson?.name, "jev-social", "package name must remain jev-social");
  const version = String(packageJson?.version ?? "").trim();
  if (!STABLE_SEMVER_PATTERN.test(version)) {
    throw new Error("package version must be stable semantic versioning");
  }
  const expectedTag = `v${version}`;
  requireEqual(releaseTag, expectedTag, "release tag must equal package version");
  requireEqual(
    packageJson?.publishConfig?.registry,
    "https://registry.npmjs.org/",
    "publish registry must be the public npm registry",
  );
  requireEqual(packageJson?.publishConfig?.access, "public", "package access must remain public");
  requireEqual(packageLock?.version, version, "package-lock version must equal package version");
  requireEqual(
    packageLock?.packages?.[""]?.version,
    version,
    "package-lock root version must equal package version",
  );
  if (codexManifest?.version !== version || grokManifest?.version !== version) {
    throw new Error("plugin manifest versions must equal package version");
  }
  if (!String(skillContents ?? "").includes(`release \`${expectedTag}\``)) {
    throw new Error("Agent Skill must identify the release tag");
  }
  if (!SHA_PATTERN.test(String(eventCommit ?? ""))) {
    throw new Error("release event revision must be a full commit SHA");
  }
  if (!SHA_PATTERN.test(String(checkoutCommit ?? ""))) {
    throw new Error("checked-out revision must be a full commit SHA");
  }
  requireEqual(
    checkoutCommit,
    eventCommit,
    "checked-out commit must equal the release event commit",
  );
  return {
    commit: checkoutCommit,
    packageName: packageJson.name,
    releaseTag,
    version,
  };
}

export async function verifyRelease({
  root = new URL("../", import.meta.url),
  env = process.env,
  checkoutCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim(),
  npmVersion = execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["--version"], {
    encoding: "utf8",
  }).trim(),
} = {}) {
  verifyNpmVersion(npmVersion);
  const [packageJson, packageLock, codexManifest, grokManifest, skillContents] = await Promise.all([
    readFile(new URL("package.json", root), "utf8").then(JSON.parse),
    readFile(new URL("package-lock.json", root), "utf8").then(JSON.parse),
    readFile(new URL(".codex-plugin/plugin.json", root), "utf8").then(JSON.parse),
    readFile(new URL(".grok-plugin/plugin.json", root), "utf8").then(JSON.parse),
    readFile(new URL("skills/jev-social/SKILL.md", root), "utf8"),
  ]);
  return verifyReleaseMetadata({
    packageJson,
    packageLock,
    codexManifest,
    grokManifest,
    skillContents,
    releaseTag: env.RELEASE_TAG,
    eventCommit: env.GITHUB_SHA,
    checkoutCommit,
  });
}

async function main() {
  try {
    const result = await verifyRelease();
    process.stdout.write(
      `Verified ${result.packageName}@${result.version} at ${result.commit} for ${result.releaseTag}.\n`,
    );
  } catch (error) {
    process.stderr.write(`Release verification failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
