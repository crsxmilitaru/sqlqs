import { execSync } from "child_process";
import { appendFileSync, readFileSync } from "fs";

function run(cmd, allowFailure = false) {
  try {
    const result = execSync(cmd, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return typeof result === "string" ? result.trim() : "";
  } catch (err) {
    if (allowFailure) return "";
    throw err;
  }
}

function isAncestor(tag, head = "HEAD") {
  try {
    execSync(`git merge-base --is-ancestor "${tag}" "${head}"`, {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function parseJsonReleases(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    const items = [];
    const chunks = raw.split(/\]\s*\[/);
    for (let i = 0; i < chunks.length; i++) {
      let str = chunks[i].trim();
      if (i > 0) str = `[${str}`;
      if (i < chunks.length - 1) str = `${str}]`;
      try {
        const arr = JSON.parse(str);
        if (Array.isArray(arr)) items.push(...arr);
      } catch {}
    }
    return items;
  }
}

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const version = pkg.version;
if (!/^\d+\.\d+\.\d+-preview$/.test(version)) {
  console.error(`Current package version must be a preview version, got: ${version}`);
  process.exit(1);
}

run("git fetch --tags --force origin", true);

const repo = process.env.REPOSITORY || process.env.GITHUB_REPOSITORY;
let releases = [];
if (repo) {
  const releasesRaw = run(`gh api --paginate "repos/${repo}/releases"`, true);
  releases = parseJsonReleases(releasesRaw);
}

const tagPrefix = `v${version}.`;
const gitTags = run(`git tag -l "${tagPrefix}*"`, true)
  .split(/\r?\n/)
  .map((t) => t.trim())
  .filter(Boolean);

const releaseTags = releases.map((r) => r.tag_name).filter(Boolean);
const allMatchingTags = new Set([...gitTags, ...releaseTags]);
let maxSuffix = 0;
for (const tag of allMatchingTags) {
  if (tag.startsWith(tagPrefix)) {
    const suffix = tag.slice(tagPrefix.length);
    if (/^\d+$/.test(suffix)) {
      const num = parseInt(suffix, 10);
      if (num > maxSuffix) maxSuffix = num;
    }
  }
}

const nextNumber = maxSuffix + 1;
const tagName = `${tagPrefix}${nextNumber}`;

const successfulReleases = releases.filter((r) => {
  if (r.draft) return false;
  if (!Array.isArray(r.assets) || r.assets.length === 0) return false;
  if (!r.tag_name) return false;
  return isAncestor(r.tag_name, "HEAD");
});

const currentSeriesReleases = successfulReleases
  .filter((r) => r.tag_name.startsWith(tagPrefix))
  .map((r) => {
    const suffix = parseInt(r.tag_name.slice(tagPrefix.length), 10);
    return { ...r, suffix: isNaN(suffix) ? 0 : suffix };
  })
  .sort((a, b) => b.suffix - a.suffix);

let prevTag = null;
if (currentSeriesReleases.length > 0) {
  prevTag = currentSeriesReleases[0].tag_name;
} else if (successfulReleases.length > 0) {
  prevTag = successfulReleases[0].tag_name;
}

if (!prevTag) {
  const baseStableTag = run(
    'git describe --tags --abbrev=0 --match "v[0-9]*.[0-9]*.[0-9]*" --exclude "v*-*" HEAD',
    true,
  );
  if (baseStableTag && isAncestor(baseStableTag, "HEAD")) {
    prevTag = baseStableTag;
  }
}

let rawLog = "";
if (prevTag) {
  rawLog = run(`git log --pretty=format:"- %s (%h)" "${prevTag}..HEAD"`, true);
} else {
  rawLog = run('git log -n 10 --pretty=format:"- %s (%h)"', true);
}

const changelogLines = rawLog
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l.length > 0 && !/^- (preview|bump version|v\d)/i.test(l));

const changelog =
  changelogLines.length > 0 ? changelogLines.join("\n") : "- Routine update";

if (process.env.GITHUB_ACTIONS || process.env.CI) {
  const sha = process.env.GITHUB_SHA || run("git rev-parse HEAD");
  run(`git tag -f "${tagName}" "${sha}"`);
  run(`git push origin "refs/tags/${tagName}" --force`, true);
}

if (process.env.GITHUB_OUTPUT) {
  const output = [
    `release-version=${version}`,
    `release-tag=${tagName}`,
    "changelog<<EOF",
    changelog,
    "EOF\n",
  ].join("\n");
  appendFileSync(process.env.GITHUB_OUTPUT, output, "utf8");
} else {
  console.log(`Version: ${version}`);
  console.log(`Tag: ${tagName}`);
  console.log(`Previous tag: ${prevTag}`);
  console.log(`Changelog:\n${changelog}`);
}
