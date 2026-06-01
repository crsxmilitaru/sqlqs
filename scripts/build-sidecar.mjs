#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const sidecarRoot = join(repoRoot, "src-tauri", "sidecar");
const hostProject = join(
  sidecarRoot,
  "src",
  "Sqlqs.Sidecar.Host",
  "Sqlqs.Sidecar.Host.csproj",
);
const outRoot = join(sidecarRoot, "bin");

const TARGET_RID = {
  "x86_64-pc-windows-msvc": { rid: "win-x64", ext: ".exe" },
  "aarch64-pc-windows-msvc": { rid: "win-arm64", ext: ".exe" },
  "x86_64-apple-darwin": { rid: "osx-x64", ext: "" },
  "aarch64-apple-darwin": { rid: "osx-arm64", ext: "" },
  "x86_64-unknown-linux-gnu": { rid: "linux-x64", ext: "" },
  "aarch64-unknown-linux-gnu": { rid: "linux-arm64", ext: "" },
};

function currentTargetTriple() {
  if (process.env.SQLQS_SIDECAR_TARGET) return process.env.SQLQS_SIDECAR_TARGET;
  const { platform, arch } = process;
  if (platform === "win32" && arch === "x64") return "x86_64-pc-windows-msvc";
  if (platform === "win32" && arch === "arm64")
    return "aarch64-pc-windows-msvc";
  if (platform === "darwin" && arch === "x64") return "x86_64-apple-darwin";
  if (platform === "darwin" && arch === "arm64") return "aarch64-apple-darwin";
  if (platform === "linux" && arch === "x64") return "x86_64-unknown-linux-gnu";
  if (platform === "linux" && arch === "arm64")
    return "aarch64-unknown-linux-gnu";
  throw new Error(`Unsupported host: ${platform}/${arch}`);
}

function publishForTriple(triple) {
  const mapping = TARGET_RID[triple];
  if (!mapping) throw new Error(`No RID mapping for target triple: ${triple}`);
  const { rid, ext } = mapping;

  const stageDir = join(outRoot, `stage-${rid}`);
  if (existsSync(stageDir)) rmSync(stageDir, { recursive: true, force: true });
  mkdirSync(stageDir, { recursive: true });

  console.log(`[sidecar] publishing ${rid} for target ${triple}`);
  execFileSync(
    "dotnet",
    [
      "publish",
      hostProject,
      "-c",
      "Release",
      "-r",
      rid,
      "--self-contained",
      "-o",
      stageDir,
      "-v",
      "minimal",
    ],
    { stdio: "inherit" },
  );

  const sourceExe = join(stageDir, `Sqlqs.Sidecar.Host${ext}`);
  if (!existsSync(sourceExe)) {
    throw new Error(`Expected published binary not found: ${sourceExe}`);
  }

  mkdirSync(outRoot, { recursive: true });
  const targetExe = join(outRoot, `Sqlqs.Sidecar.Host-${triple}${ext}`);
  if (existsSync(targetExe)) rmSync(targetExe);
  renameSync(sourceExe, targetExe);

  const bytes = statSync(targetExe).size;
  console.log(
    `[sidecar] -> ${targetExe} (${(bytes / (1024 * 1024)).toFixed(1)} MB)`,
  );

  rmSync(stageDir, { recursive: true, force: true });
  return targetExe;
}

const args = process.argv.slice(2);
const triples = args.length > 0 ? args : [currentTargetTriple()];
for (const triple of triples) publishForTriple(triple);
