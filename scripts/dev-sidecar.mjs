#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const hostProject = join(
  repoRoot,
  "src-tauri",
  "sidecar",
  "src",
  "Sqlqs.Sidecar.Host",
  "Sqlqs.Sidecar.Host.csproj",
);

const tfm = "net10.0";
const ext = process.platform === "win32" ? ".exe" : "";
const outputExe = join(
  repoRoot,
  "src-tauri",
  "sidecar",
  "src",
  "Sqlqs.Sidecar.Host",
  "bin",
  "Debug",
  tfm,
  `Sqlqs.Sidecar.Host${ext}`,
);

console.log(
  "[sidecar:dev] dotnet build (Debug, framework-dependent, fast iteration)",
);
execFileSync("dotnet", ["build", hostProject, "-c", "Debug", "-v", "minimal"], {
  stdio: "inherit",
});

if (!existsSync(outputExe)) {
  console.error(
    `[sidecar:dev] expected debug binary at ${outputExe} but it was not produced`,
  );
  process.exit(1);
}

const sizeMb = (statSync(outputExe).size / (1024 * 1024)).toFixed(1);
console.log(`[sidecar:dev] -> ${outputExe} (${sizeMb} MB)`);
console.log(
  "[sidecar:dev] Tauri dev will discover this debug binary automatically.",
);
console.log(
  "[sidecar:dev] Re-run after .NET changes; Rust hot-reloads independently.",
);
