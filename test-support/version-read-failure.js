import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";

const originalReadFileSync = fs.readFileSync;

fs.readFileSync = (target, ...args) => {
  const value = target instanceof URL ? target.pathname : String(target);
  if (value.endsWith("/package.json")) {
    throw new Error("simulated failure from /private/should-not-leak/package.json");
  }
  return originalReadFileSync(target, ...args);
};

syncBuiltinESMExports();
