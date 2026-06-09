import { execSync } from "child_process";
import { argv, exit, stdin as input, stdout as output } from "process";
import { readFileSync } from "fs";
import readline from "readline/promises";

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-(preview))?$/;

let requestedWorkflow = argv[2];

function run(cmd, inherit = false) {
  const result = execSync(cmd, {
    encoding: "utf8",
    stdio: inherit ? "inherit" : "pipe",
  });
  return typeof result === "string" ? result.trim() : "";
}

function parseVersion(version) {
  const match = VERSION_PATTERN.exec(version);
  if (!match) {
    throw new Error(`Invalid package version: ${version}`);
  }

  const [, major, minor, patch, prerelease] = match;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    core: `${major}.${minor}.${patch}`,
    isPreview: prerelease === "preview",
  };
}

function compareVersions(a, b) {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

async function prompt(question, fallback) {
  const rl = readline.createInterface({ input, output });
  try {
    return (await rl.question(question)).trim().toLowerCase() || fallback;
  } finally {
    rl.close();
  }
}

function readPackageVersion(ref = null) {
  const contents = ref
    ? run(`git show ${ref}:package.json`)
    : readFileSync("package.json", "utf8");
  return JSON.parse(contents).version;
}

function selectWorkflow(choice) {
  if (choice === "1") return "preview";
  if (choice === "2") return "stable";
  throw new Error("Invalid release type. Select 1 or 2.");
}

function assertCleanWorktree() {
  if (run("git status --porcelain")) {
    throw new Error("You have uncommitted changes. Commit or stash them first.");
  }
}

function assertBranch(expectedBranch) {
  const currentBranch = run("git branch --show-current");
  if (currentBranch !== expectedBranch) {
    throw new Error(
      `${expectedBranch} releases must be run on '${expectedBranch}'. Current branch: '${currentBranch}'.`,
    );
  }
  return currentBranch;
}

function assertNoUnpushedCommits(branch, upstream = `origin/${branch}`) {
  const aheadCount = Number(run(`git rev-list --count ${upstream}..${branch}`));
  if (aheadCount > 0) {
    throw new Error(
      `'${branch}' has ${aheadCount} unpushed commit(s). Push them or back them up before continuing.`,
    );
  }
}

function versionForStable(mode) {
  const current = parseVersion(readPackageVersion());
  if (mode === "hotfix") {
    return `${current.major}.${current.minor}.${current.patch + 1}`;
  }
  return current.core;
}

function versionForPreview(bump) {
  const dev = parseVersion(readPackageVersion());
  const master = parseVersion(readPackageVersion("origin/master"));
  const base = compareVersions(dev, master) > 0 ? dev : master;

  if (bump === "next") {
    if (!dev.isPreview || compareVersions(dev, master) <= 0) {
      throw new Error(
        "No current preview series found. Select 'minor' or 'major' to start one.",
      );
    }
    return `${dev.core}-preview`;
  }

  if (bump === "minor") {
    return `${base.major}.${base.minor + 1}.0-preview`;
  }

  if (bump === "major") {
    return `${base.major + 1}.0.0-preview`;
  }

  throw new Error("Invalid preview bump. Use next, minor, or major.");
}

function commitVersionFiles(message) {
  run(
    "git add package.json package-lock.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock",
    true,
  );
  run(`git commit -m "${message}"`, true);
}

async function main() {
  console.log("=== SQL Query Studio Interactive Release Tool ===\n");

  console.log("Step 1: Checking Git status...");
  assertCleanWorktree();
  console.log("OK: Git status is clean.\n");

  console.log("Step 2: Select release type:");
  console.log("  [1] Preview (Experimental pre-release from 'dev')");
  console.log("  [2] Stable (Production-ready release from 'master')");

  let defaultChoice = "";
  if (requestedWorkflow === "preview") defaultChoice = "1";
  else if (requestedWorkflow === "stable") defaultChoice = "2";
  else if (requestedWorkflow) {
    throw new Error("Invalid release argument. Use preview or stable.");
  }

  const promptText = defaultChoice
    ? `Select option (1 or 2, Enter for default: ${requestedWorkflow}): `
    : "Select option (1 or 2): ";
  const workflow = selectWorkflow(await prompt(promptText, defaultChoice));
  console.log(`OK: Target is ${workflow.toUpperCase()} release.\n`);

  console.log("Step 3: Validating current branch...");
  const expectedBranch = workflow === "stable" ? "master" : "dev";
  const currentBranch = assertBranch(expectedBranch);
  console.log(`OK: Branch is correct: '${currentBranch}'\n`);

  console.log("Step 4: Fetching latest branch info from origin...");
  run("git fetch origin", true);
  console.log("OK: Fetched successfully.\n");

  if (workflow === "stable") {
    console.log("Step 5: Select stable release mode:");
    console.log("  [promote] Promote dev (Merges dev into master and strips preview suffix)");
    console.log("  [hotfix]  Hotfix master (Increments patch version of current master)");
    const mode = await prompt("Select mode (Enter=promote, or type 'hotfix'): ", "promote");

    if (mode !== "promote" && mode !== "hotfix") {
      throw new Error("Invalid stable mode. Use promote or hotfix.");
    }

    if (mode === "promote") {
      console.log("\nStep 5a: Merging 'dev' into 'master'...");
      run("git fetch origin dev", true);
      try {
        run("git merge --no-edit origin/dev", true);
        console.log("OK: Dev merged into master successfully.");
      } catch {
        throw new Error(
          "Merge failed. Resolve conflicts, commit the merge, and rerun this release script.",
        );
      }
    }

    console.log("\nStep 6: Computing new version...");
    const releaseVersion = versionForStable(mode);
    console.log(`OK: Calculated version: ${releaseVersion}\n`);

    const confirm = await prompt(`Do you want to release version v${releaseVersion}? (y/N): `, "n");
    if (confirm !== "y" && confirm !== "yes") {
      console.log("Release cancelled by user.");
      return;
    }

    console.log("\nStep 7: Updating local version configuration files...");
    run(`node scripts/set-version.mjs ${releaseVersion}`, true);
    console.log("OK: Version files updated.\n");

    console.log("Step 8: Committing, tagging, and pushing changes...");
    if (run("git status --porcelain")) {
      commitVersionFiles(`v${releaseVersion}`);
      console.log("OK: Created local commit.");
    } else {
      console.log("OK: Version files already match. No commit needed.");
    }
    run(`git tag -f v${releaseVersion}`, true);
    console.log(`OK: Created git tag: v${releaseVersion}`);

    if (mode === "hotfix") {
      console.log("\nStep 8a: Merging 'master' into 'dev'...");
      run("git fetch origin dev", true);
      assertNoUnpushedCommits("dev");
      run("git checkout dev", true);
      try {
        run("git reset --hard origin/dev", true);
        run("git merge --no-edit master", true);
        console.log("OK: Master merged into dev successfully.");
      } catch (err) {
        try {
          run("git merge --abort", true);
        } catch {}
        throw new Error(
          `Merge of master into dev failed: ${err.message ?? err}. The merge was aborted. Please merge master into dev manually.`,
        );
      } finally {
        run("git checkout master", true);
      }
    }

    run("git push origin master", true);
    run(`git push origin -f v${releaseVersion}`, true);
    if (mode === "hotfix") {
      run("git push origin dev", true);
    }
    console.log(`\nSuccess: Released and pushed stable v${releaseVersion} to GitHub.`);
  } else if (workflow === "preview") {
    console.log("Step 5: Select preview bump type:");
    console.log("  [next]  Reuse the current preview series (e.g. 1.1.0-preview)");
    console.log("  [minor] Start a new minor preview series (e.g. 1.0.0 -> 1.1.0-preview)");
    console.log("  [major] Start a new major preview series (e.g. 1.0.0 -> 2.0.0-preview)");
    const bump = await prompt("Select bump (Enter=next, or type 'minor'/'major'): ", "next");

    if (!/^(next|minor|major)$/.test(bump)) {
      throw new Error("Invalid preview bump. Use next, minor, or major.");
    }

    console.log("\nStep 6: Computing new version...");
    const previewVersion = versionForPreview(bump);
    console.log(`OK: Calculated version: ${previewVersion}\n`);

    const confirm = await prompt(`Do you want to release preview version v${previewVersion}? (y/N): `, "n");
    if (confirm !== "y" && confirm !== "yes") {
      console.log("Release cancelled by user.");
      return;
    }

    console.log("\nStep 7: Updating local version configuration files...");
    run(`node scripts/set-version.mjs ${previewVersion}`, true);
    console.log("OK: Version files updated.\n");

    console.log("Step 8: Committing and pushing changes...");
    if (run("git status --porcelain")) {
      commitVersionFiles(`Preview v${previewVersion}`);
      console.log("OK: Created local commit.");
    } else {
      run(`git commit --allow-empty -m "Preview v${previewVersion}"`, true);
      console.log("OK: Version files already match. Created empty preview commit.");
    }

    run("git push origin dev", true);
    console.log(
      `\nSuccess: Pushed dev. Preview CI will publish v${previewVersion}.`,
    );
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message ?? err}`);
  exit(1);
});
