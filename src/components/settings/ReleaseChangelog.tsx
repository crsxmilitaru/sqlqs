import { For, Show, createMemo, createResource } from "solid-js";
import { open } from "@tauri-apps/plugin-shell";
import { formatLocalDateTime } from "../../lib/system-locale";
import { Icon } from "../ui/Icons";
import { Loader } from "../ui/Loader";
import Tooltip from "../ui/Tooltip";
import { SettingTitle } from "./SettingsComponents";

const RELEASES_API =
  "https://api.github.com/repos/crsxmilitaru/sqlqs/releases?per_page=50";
const RELEASES_PAGE = "https://github.com/crsxmilitaru/sqlqs/releases";
const MAX_ENTRIES = 16;

interface GitHubRelease {
  tag_name: string;
  name: string | null;
  body: string | null;
  html_url: string;
  published_at: string | null;
  prerelease: boolean;
  draft: boolean;
}

interface ChangelogEntry {
  version: string;
  tagName: string;
  body: string;
  htmlUrl: string;
  publishedAt: string | null;
  preview: boolean;
}

interface Props {
  currentVersion: string | null;
}

function stripVersionPrefix(value: string): string {
  return value.replace(/^v/i, "").trim();
}

function isPreviewRelease(tag: string, prerelease: boolean): boolean {
  return prerelease || /preview/i.test(tag);
}

function changelogLines(body: string): string[] {
  return body
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s*[-*]\s+/, "")
        .replace(/\s*\([0-9a-f]{7,40}\)\s*$/i, "")
        .trim(),
    )
    .filter((line) => line.length > 0 && !/^#+\s/.test(line));
}

function parseReleases(releases: GitHubRelease[]): ChangelogEntry[] {
  return releases
    .filter((release) => !release.draft)
    .slice(0, MAX_ENTRIES)
    .map((release) => ({
      version: stripVersionPrefix(release.tag_name),
      tagName: release.tag_name,
      body: release.body?.trim() ?? "",
      htmlUrl: release.html_url,
      publishedAt: release.published_at,
      preview: isPreviewRelease(release.tag_name, release.prerelease),
    }));
}

async function loadChangelog(): Promise<ChangelogEntry[]> {
  const response = await fetch(RELEASES_API, {
    headers: {
      Accept: "application/vnd.github+json",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub returned ${response.status}`);
  }
  const releases = (await response.json()) as GitHubRelease[];
  if (!Array.isArray(releases)) {
    throw new Error("Unexpected changelog response");
  }
  return parseReleases(releases);
}

function formatReleaseDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return formatLocalDateTime(date, false);
}

function matchesInstalled(version: string, currentVersion: string | null): boolean {
  if (!currentVersion) return false;
  const release = stripVersionPrefix(version);
  const current = stripVersionPrefix(currentVersion);
  if (release === current) return true;
  return current.includes("-preview") && release.startsWith(`${current}.`);
}

export default function ReleaseChangelog(props: Props) {
  const [entries, { refetch }] = createResource(loadChangelog);

  const currentTag = createMemo(() => {
    const list = entries() ?? [];
    return (
      list.find((entry) => matchesInstalled(entry.version, props.currentVersion))
        ?.tagName ?? null
    );
  });

  const openIndex = createMemo(() => {
    const list = entries() ?? [];
    const current = list.findIndex((entry) => entry.tagName === currentTag());
    return current >= 0 ? current : 0;
  });

  async function openUrl(url: string, event?: MouseEvent) {
    event?.preventDefault();
    event?.stopPropagation();
    await open(url);
  }

  return (
    <div class="settings-section">
      <div class="flex items-start justify-between gap-4 mb-4">
        <SettingTitle
          title="Changelog"
          description="What changed in recent stable and preview releases"
        />
        <a
          href={RELEASES_PAGE}
          class="settings-external-link shrink-0 mt-0.5"
          onClick={(event) => void openUrl(RELEASES_PAGE, event)}
        >
          All releases
        </a>
      </div>

      <Show when={entries.loading}>
        <Loader text="Loading changelog…" variant="horizontal" class="py-6" />
      </Show>

      <Show when={!entries.loading && entries.error}>
        <div class="settings-changelog-status">
          <p class="text-s text-text-muted">Couldn't load the changelog.</p>
          <button
            type="button"
            class="settings-inline-link text-s mt-2"
            onClick={() => void refetch()}
          >
            <Icon name="rotate-right" class="mr-1 text-xs" />
            Try again
          </button>
        </div>
      </Show>

      <Show when={!entries.loading && !entries.error}>
        <Show
          when={(entries() ?? []).length > 0}
          fallback={
            <p class="text-s text-text-muted">No published releases yet.</p>
          }
        >
          <div class="settings-changelog">
            <For each={entries()}>
              {(entry, index) => {
                const lines = () => changelogLines(entry.body);
                const current = () => entry.tagName === currentTag();
                return (
                  <details
                    class="settings-changelog-item"
                    classList={{ current: current() }}
                    open={index() === openIndex()}
                  >
                    <summary>
                      <Icon
                        name="chevron-right"
                        class="settings-changelog-chevron"
                      />
                      <span class="settings-changelog-version">
                        {entry.version}
                      </span>
                      <Show when={entry.preview}>
                        <span class="settings-status-badge warning">
                          Preview
                        </span>
                      </Show>
                      <Show when={current()}>
                        <span class="settings-status-badge muted">Current</span>
                      </Show>
                      <span class="settings-changelog-date">
                        {formatReleaseDate(entry.publishedAt)}
                      </span>
                      <Tooltip
                        content={`Open ${entry.version} on GitHub`}
                        placement="top"
                      >
                        <button
                          type="button"
                          class="settings-changelog-open"
                          aria-label={`Open ${entry.version} on GitHub`}
                          onClick={(event) => void openUrl(entry.htmlUrl, event)}
                        >
                          <Icon name="arrow-up-right-from-square" />
                        </button>
                      </Tooltip>
                    </summary>
                    <div class="settings-changelog-body">
                      <Show
                        when={lines().length > 0}
                        fallback={
                          <p class="text-s text-text-muted">
                            No notes for this release.
                          </p>
                        }
                      >
                        <ul>
                          <For each={lines()}>
                            {(line) => <li>{line}</li>}
                          </For>
                        </ul>
                      </Show>
                    </div>
                  </details>
                );
              }}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
}
