import { readFileSync, writeFileSync } from "fs";

const version = process.argv[2]?.replace(/^v/, "");
const versionPattern = /^\d+\.\d+\.\d+(?:-preview)?$/;

if (!version || !versionPattern.test(version)) {
  console.error("Usage: node scripts/set-version.mjs <x.y.z[-preview]>");
  process.exit(1);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

function replaceRequired(path, contents, pattern, replacement) {
  if (!pattern.test(contents)) {
    throw new Error(`Could not find version in ${path}`);
  }

  const next = contents.replace(pattern, replacement);
  return next;
}

const pkg = readJson("package.json");
pkg.version = version;

const pkgLock = readJson("package-lock.json");
pkgLock.version = version;
if (pkgLock.packages?.[""]) {
  pkgLock.packages[""].version = version;
}

const tauri = readJson("src-tauri/tauri.conf.json");
tauri.version = version;

const cargo = replaceRequired(
  "src-tauri/Cargo.toml",
  readFileSync("src-tauri/Cargo.toml", "utf8"),
  /^version = ".*"/m,
  `version = "${version}"`,
);

const lock = replaceRequired(
  "src-tauri/Cargo.lock",
  readFileSync("src-tauri/Cargo.lock", "utf8"),
  /(name = "sqlqs"\r?\nversion = ")[^"]*(")/,
  `$1${version}$2`,
);

writeJson("package.json", pkg);
writeJson("package-lock.json", pkgLock);
writeJson("src-tauri/tauri.conf.json", tauri);
writeFileSync("src-tauri/Cargo.toml", cargo);
writeFileSync("src-tauri/Cargo.lock", lock);

console.log(version);
