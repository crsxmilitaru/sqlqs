import { execFileSync } from "node:child_process";

function run(file, args = [], allowFailure = false) {
  try {
    const result = execFileSync(file, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return typeof result === "string" ? result.trim() : "";
  } catch (err) {
    if (allowFailure) return "";
    const stderr = err.stderr ? String(err.stderr).trim() : "";
    if (stderr) {
      throw new Error(`${err.message}\n${stderr}`);
    }
    throw err;
  }
}

function parseJsonArray(raw) {
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

function getRepository() {
  const envRepo =
    process.env.REPOSITORY ||
    process.env.GITHUB_REPOSITORY ||
    process.env.GH_REPO;
  if (envRepo) return envRepo.trim();

  const ghRepo = run("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], true);
  if (ghRepo) return ghRepo.trim();

  const remoteUrl = run("git", ["remote", "get-url", "origin"], true);
  const match = /github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?$/.exec(remoteUrl);
  if (match) return `${match[1]}/${match[2]}`;

  return null;
}

const isStableTag = (tag) => /^v?\d+\.\d+\.\d+$/.test(tag);
const isPreviewTag = (tag) =>
  typeof tag === "string" && !isStableTag(tag) && /-preview/i.test(tag);
const isPreviewRelease = (r) => Boolean(r?.tag_name && isPreviewTag(r.tag_name));

const repo = getRepository();
if (!repo) {
  console.error("Could not determine GitHub repository.");
  process.exit(1);
}

const isDryRun = process.argv.includes("--dry-run");

const releasesRaw = run("gh", ["api", "--paginate", `repos/${repo}/releases`], false);
const releases = parseJsonArray(releasesRaw);
const previewReleases = releases.filter(isPreviewRelease);

if (previewReleases.length === 0) {
  console.log("No preview releases found to delete.");
} else {
  console.log(`Found ${previewReleases.length} preview release(s) to delete:`);
  for (const r of previewReleases) {
    const tag = r.tag_name;
    console.log(`  - ${r.name || tag} (${tag})`);
    if (!isDryRun) {
      try {
        run("gh", ["release", "delete", tag, "--repo", repo, "--yes", "--cleanup-tag"]);
        console.log(`    Deleted release and tag: ${tag}`);
      } catch (err) {
        console.warn(`    Failed to delete release ${tag}: ${err.message || err}`);
      }
    }
  }
}

const tagsRaw = run("gh", ["api", "--paginate", `repos/${repo}/git/matching-refs/tags`], false);
const tagRefs = parseJsonArray(tagsRaw);
const leftoverPreviewTags = tagRefs
  .map((item) => item.ref)
  .filter((ref) => typeof ref === "string" && ref.startsWith("refs/tags/"))
  .map((ref) => ref.replace(/^refs\/tags\//, ""))
  .filter(isPreviewTag);

if (leftoverPreviewTags.length > 0) {
  console.log(`Found ${leftoverPreviewTags.length} remote preview tag(s):`);
  for (const tag of leftoverPreviewTags) {
    console.log(`  - ${tag}`);
    if (!isDryRun) {
      try {
        run("gh", ["api", "-X", "DELETE", `repos/${repo}/git/refs/tags/${encodeURIComponent(tag)}`]);
        console.log(`    Deleted tag ref: ${tag}`);
      } catch (err) {
        const msg = String(err.stderr || err.message || err);
        if (!msg.includes("404") && !msg.includes("Reference does not exist")) {
          console.warn(`    Could not delete tag ${tag}: ${msg}`);
        }
      }
    }
  }
}
