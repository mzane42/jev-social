import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readConfig } from "../src/config.js";
import { saveOnboarding, resolveSocaiInstallDecision } from "../src/onboard.js";

test("environment-only OpenRouter keys are not persisted during onboarding", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jev-social-onboard-"));
  const env = {
    ...process.env,
    JEV_SOCIAL_HOME: directory,
    OPENROUTER_API_KEY: String(101),
    SOCAI_BIN: path.join(directory, "missing-socai"),
  };
  try {
    await saveOnboarding({ verify: false, persistApiKey: false, env });
    const config = await readConfig(env);
    assert.equal(config.openrouterApiKey, undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a loopback System One provider can onboard without an OpenRouter key", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jev-social-onboard-local-"));
  const env = {
    ...process.env,
    JEV_SOCIAL_HOME: directory,
    JEV_SOCIAL_SYSTEM_ONE_URL: "http://127.0.0.1:8009/v1/systemone",
    JEV_SOCIAL_SYSTEM_ONE_MODEL: "kev-latest",
    SOCAI_BIN: path.join(directory, "missing-socai"),
  };
  delete env.OPENROUTER_API_KEY;
  delete env.openrouter;
  try {
    const result = await saveOnboarding({ verify: true, persistApiKey: false, env });
    const config = await readConfig(env);
    assert.equal(config.openrouterApiKey, undefined);
    assert.deepEqual(result.decisionProvider, { kind: "local", model: "kev-latest" });
    assert.deepEqual(result.keyInfo, {});
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("saveOnboarding reports the resolved socai bin path for CLI output", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jev-social-onboard-bin-"));
  const mockBin = path.join(directory, "mock-socai.mjs");
  const env = {
    ...process.env,
    JEV_SOCIAL_HOME: directory,
    OPENROUTER_API_KEY: String(102),
    SOCAI_BIN: mockBin,
  };
  try {
    const result = await saveOnboarding({ verify: false, persistApiKey: true, socaiBin: mockBin, env });
    assert.equal(result.socai.bin, mockBin, "socai.bin must be present in saveOnboarding result for CLI callers");
    assert.notEqual(result.socai.bin, undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("onboarding in non-interactive environment does not install missing socai CLI unless installCli is explicitly true", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jev-social-onboard-noninteractive-"));
  const env = {
    ...process.env,
    JEV_SOCIAL_HOME: directory,
    OPENROUTER_API_KEY: String(103),
    SOCAI_BIN: path.join(directory, "missing-socai"),
  };
  try {
    const result = await saveOnboarding({ verify: false, installCli: false, env });
    assert.equal(result.socai.installed, false, "socai CLI must not be installed when installCli is false");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("resolveSocaiInstallDecision correctly handles non-interactive, interactive, explicit, and skip flags", () => {
  // 1. Non-interactive default (isTTY: false, no flags) -> false
  assert.equal(
    resolveSocaiInstallDecision({ installed: false, install: false, skipInstall: false, isTTY: false }),
    false,
    "Non-interactive default must not install missing socai CLI",
  );

  // 2. Interactive empty answer (isTTY: true, answer: "") -> true
  assert.equal(
    resolveSocaiInstallDecision({ installed: false, install: false, skipInstall: false, isTTY: true, answer: "" }),
    true,
    "Interactive empty answer must default to true ([Y/n])",
  );

  // 3. Interactive negative answer (isTTY: true, answer: "n") -> false
  assert.equal(
    resolveSocaiInstallDecision({ installed: false, install: false, skipInstall: false, isTTY: true, answer: "n" }),
    false,
    "Interactive 'n' answer must return false",
  );

  // 4. Explicit --install -> true regardless of isTTY
  assert.equal(
    resolveSocaiInstallDecision({ installed: false, install: true, skipInstall: false, isTTY: false }),
    true,
    "Explicit --install must return true even when non-interactive",
  );

  // 5. Explicit --skip-install -> false regardless of isTTY
  assert.equal(
    resolveSocaiInstallDecision({ installed: false, install: false, skipInstall: true, isTTY: true, answer: "y" }),
    false,
    "Explicit --skip-install must return false",
  );

  // 6. Already installed -> false (when install is false)
  assert.equal(
    resolveSocaiInstallDecision({ installed: true, install: false, skipInstall: false, isTTY: true }),
    false,
    "Already installed CLI must not trigger auto-reinstall without --install",
  );

  // 7. Explicit --install when already installed -> true (reinstall semantics)
  assert.equal(
    resolveSocaiInstallDecision({ installed: true, install: true, skipInstall: false, isTTY: false }),
    true,
    "Explicit --install when already installed must return true to preserve reinstall semantics",
  );
});
