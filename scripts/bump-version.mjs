import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";

const arg = process.argv[2];
if (!arg) {
  console.error("Usage: npm run bump -- <patch|minor|major|x.y.z>");
  process.exit(1);
}

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const [major, minor, patch] = pkg.version.split(".").map(Number);

let version;
if (arg === "patch") version = `${major}.${minor}.${patch + 1}`;
else if (arg === "minor") version = `${major}.${minor + 1}.0`;
else if (arg === "major") version = `${major + 1}.0.0`;
else version = arg.replace(/^v/, "");

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`Invalid version: ${version}`);
  process.exit(1);
}

console.log(`Bumping version: ${pkg.version} → ${version}\n`);

// package.json
pkg.version = version;
writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
console.log("  Updated package.json");

// package-lock.json
try {
  const pkgLock = JSON.parse(readFileSync("package-lock.json", "utf8"));
  pkgLock.version = version;
  writeFileSync("package-lock.json", JSON.stringify(pkgLock, null, 2) + "\n");
  console.log("  Updated package-lock.json");
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

// src-tauri/tauri.conf.json
const tauri = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
tauri.version = version;
writeFileSync(
  "src-tauri/tauri.conf.json",
  JSON.stringify(tauri, null, 2) + "\n",
);
console.log("  Updated src-tauri/tauri.conf.json");

// src-tauri/Cargo.toml
let cargo = readFileSync("src-tauri/Cargo.toml", "utf8");
cargo = cargo.replace(/^version = ".*"/m, `version = "${version}"`);
writeFileSync("src-tauri/Cargo.toml", cargo);
console.log("  Updated src-tauri/Cargo.toml");

// src-tauri/Cargo.lock
let lock = readFileSync("src-tauri/Cargo.lock", "utf8");
lock = lock.replace(
  /name = "sqlqs"\nversion = ".*"/,
  `name = "sqlqs"\nversion = "${version}"`,
);
writeFileSync("src-tauri/Cargo.lock", lock);
console.log("  Updated src-tauri/Cargo.lock");

// Git commit, tag, push
console.log("\nCommitting and tagging...");
execSync(
  "git add package.json package-lock.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock",
  { stdio: "inherit" },
);
execSync(`git commit -m "v${version}"`, { stdio: "inherit" });
execSync(`git tag v${version}`, { stdio: "inherit" });
execSync("git push && git push --tags", { stdio: "inherit" });

console.log(`\nReleased v${version}`);
