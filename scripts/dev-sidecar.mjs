#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function currentTargetTriple() {
  const { platform, arch } = process;
  if (platform === "win32" && arch === "x64") return "x86_64-pc-windows-msvc";
  if (platform === "win32" && arch === "arm64") return "aarch64-pc-windows-msvc";
  if (platform === "darwin" && arch === "x64") return "x86_64-apple-darwin";
  if (platform === "darwin" && arch === "arm64") return "aarch64-apple-darwin";
  if (platform === "linux" && arch === "x64") return "x86_64-unknown-linux-gnu";
  if (platform === "linux" && arch === "arm64") return "aarch64-unknown-linux-gnu";
  throw new Error(`Unsupported host: ${platform}/${arch}`);
}

function isDotnetFileLockFailure(output) {
  const codes = [...String(output).matchAll(/\berror ([A-Z]{2,}\d+)\b/gi)].map(
    (match) => match[1].toUpperCase(),
  );
  const lockCodes = new Set(["MSB3021", "MSB3026", "MSB3027"]);
  if (codes.length > 0) {
    return codes.every((code) => lockCodes.has(code));
  }
  return /being used by another process|The process cannot access the file/i.test(
    output,
  );
}

function isFileLockError(err) {
  const code = err?.code;
  if (code === "EBUSY" || code === "EPERM" || code === "EACCES") return true;
  return /being used by another process|The process cannot access the file/i.test(
    String(err?.message ?? err),
  );
}

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
try {
  const output = execFileSync(
    "dotnet",
    ["build", hostProject, "-c", "Debug", "-v", "minimal"],
    { encoding: "utf8" },
  );
  if (output) process.stdout.write(output);
} catch (err) {
  const output = `${err.stdout ?? ""}${err.stderr ?? ""}`;
  if (output) process.stdout.write(output);
  if (isDotnetFileLockFailure(output) && existsSync(outputExe)) {
    console.warn(
      "[sidecar:dev] debug binary is locked (sidecar may be running); keeping the existing build.",
    );
  } else {
    throw err;
  }
}

if (!existsSync(outputExe)) {
  console.error(
    `[sidecar:dev] expected debug binary at ${outputExe} but it was not produced`,
  );
  process.exit(1);
}

const sizeMb = (statSync(outputExe).size / (1024 * 1024)).toFixed(1);
console.log(`[sidecar:dev] -> ${outputExe} (${sizeMb} MB)`);

const sidecarBinDir = join(repoRoot, "src-tauri", "sidecar", "bin");
const stagedExe = join(
  sidecarBinDir,
  `Sqlqs.Sidecar.Host-${currentTargetTriple()}${ext}`,
);
mkdirSync(sidecarBinDir, { recursive: true });
try {
  copyFileSync(outputExe, stagedExe);
  console.log(`[sidecar:dev] -> ${stagedExe} (staged for Tauri externalBin)`);
} catch (err) {
  if (isFileLockError(err) && existsSync(stagedExe)) {
    console.warn(
      "[sidecar:dev] staged binary is locked (sidecar may be running); keeping the existing copy.",
    );
  } else {
    throw err;
  }
}
console.log(
  "[sidecar:dev] Tauri dev will discover this debug binary automatically.",
);
console.log(
  "[sidecar:dev] Re-run after .NET changes; Rust hot-reloads independently.",
);
