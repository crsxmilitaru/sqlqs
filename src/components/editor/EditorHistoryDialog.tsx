import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onMount,
  Show,
} from "solid-js";
import type { QueryTab, QueryTabHistoryEntry } from "../../lib/types";
import DialogCloseButton from "../ui/DialogCloseButton";
import DialogShell from "../ui/DialogShell";

const CONTEXT_LINES = 3;
const MAX_CHANGED_LINES_PER_SIDE = 240;

type DiffRowType = "context" | "removed" | "added" | "omitted";

interface DiffRow {
  type: DiffRowType;
  oldLine?: number;
  newLine?: number;
  text: string;
}

interface DiffResult {
  rows: DiffRow[];
  added: number;
  removed: number;
}

interface Props {
  tab: QueryTab;
  onClose: () => void;
  onRestore: (sql: string) => void;
}

function splitLines(sql: string) {
  return sql.length === 0 ? [] : sql.split("\n");
}

function lineCount(sql: string) {
  return splitLines(sql).length;
}

function clampChangedRange(lines: string[], start: number, end: number) {
  const count = end - start;
  if (count <= MAX_CHANGED_LINES_PER_SIDE) {
    return {
      head: lines.slice(start, end),
      tail: [] as string[],
      omitted: 0,
      tailStart: end,
    };
  }

  const half = Math.floor(MAX_CHANGED_LINES_PER_SIDE / 2);
  return {
    head: lines.slice(start, start + half),
    tail: lines.slice(end - half, end),
    omitted: count - half * 2,
    tailStart: end - half,
  };
}

function addRange(
  rows: DiffRow[],
  type: DiffRowType,
  lines: string[],
  oldStart: number,
  newStart = oldStart,
) {
  lines.forEach((text, index) => {
    rows.push({
      type,
      text,
      oldLine: type !== "added" ? oldStart + index + 1 : undefined,
      newLine: type !== "removed" ? newStart + index + 1 : undefined,
    });
  });
}

function buildDiff(previousSql: string, currentSql: string): DiffResult {
  const oldLines = splitLines(previousSql);
  const newLines = splitLines(currentSql);
  const rows: DiffRow[] = [];

  let prefix = 0;
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  ) {
    prefix++;
  }

  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] ===
      newLines[newLines.length - 1 - suffix]
  ) {
    suffix++;
  }

  const oldChangeEnd = oldLines.length - suffix;
  const newChangeEnd = newLines.length - suffix;
  const removed = Math.max(0, oldChangeEnd - prefix);
  const added = Math.max(0, newChangeEnd - prefix);

  if (removed === 0 && added === 0) {
    return {
      added: 0,
      removed: 0,
      rows: [
        {
          type: "context",
          text: "No text changes between this snapshot and the current editor.",
        },
      ],
    };
  }

  const beforeStart = Math.max(0, prefix - CONTEXT_LINES);
  if (beforeStart > 0) {
    rows.push({
      type: "omitted",
      text: `${beforeStart} earlier line${beforeStart === 1 ? "" : "s"}`,
    });
  }
  addRange(
    rows,
    "context",
    oldLines.slice(beforeStart, prefix),
    beforeStart,
  );

  const oldBlock = clampChangedRange(oldLines, prefix, oldChangeEnd);
  addRange(rows, "removed", oldBlock.head, prefix);
  if (oldBlock.omitted > 0) {
    rows.push({
      type: "omitted",
      text: `${oldBlock.omitted} removed line${oldBlock.omitted === 1 ? "" : "s"} hidden`,
    });
  }
  addRange(rows, "removed", oldBlock.tail, oldBlock.tailStart);

  const newBlock = clampChangedRange(newLines, prefix, newChangeEnd);
  addRange(rows, "added", newBlock.head, prefix);
  if (newBlock.omitted > 0) {
    rows.push({
      type: "omitted",
      text: `${newBlock.omitted} added line${newBlock.omitted === 1 ? "" : "s"} hidden`,
    });
  }
  addRange(rows, "added", newBlock.tail, newBlock.tailStart);

  const afterEnd = Math.min(oldLines.length, oldChangeEnd + CONTEXT_LINES);
  addRange(
    rows,
    "context",
    oldLines.slice(oldChangeEnd, afterEnd),
    oldChangeEnd,
    newChangeEnd,
  );
  if (afterEnd < oldLines.length) {
    rows.push({
      type: "omitted",
      text: `${oldLines.length - afterEnd} later line${oldLines.length - afterEnd === 1 ? "" : "s"}`,
    });
  }

  return { rows, added, removed };
}

function formatSnapshotTime(createdAt: number) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(createdAt));
}

function formatRelativeTime(createdAt: number) {
  const diffMs = Date.now() - createdAt;
  const minute = 60_000;
  const hour = minute * 60;
  const day = hour * 24;

  if (diffMs < minute) return "just now";
  if (diffMs < hour) {
    const value = Math.floor(diffMs / minute);
    return `${value} min ago`;
  }
  if (diffMs < day) {
    const value = Math.floor(diffMs / hour);
    return `${value} hr ago`;
  }
  const value = Math.floor(diffMs / day);
  return `${value} day${value === 1 ? "" : "s"} ago`;
}

function formatSqlSize(sql: string) {
  const lines = lineCount(sql);
  const chars = sql.length;
  return `${lines} line${lines === 1 ? "" : "s"} · ${chars.toLocaleString()} chars`;
}

function formatSnapshotType(entry: QueryTabHistoryEntry) {
  if (entry.type === "action") {
    return entry.label ?? "Action";
  }

  return entry.label ?? "Typing";
}

function getDefaultSelectedEntry(
  entries: QueryTabHistoryEntry[],
  currentSql: string,
) {
  return entries.find((entry) => entry.sql !== currentSql) ?? entries[0];
}

export default function EditorHistoryDialog(props: Props) {
  const [visible, setVisible] = createSignal(false);
  const [selectedId, setSelectedId] = createSignal("");

  const history = createMemo(() =>
    (props.tab.history ?? []).filter(
      (entry) => entry.sql && entry.sql !== props.tab.sql,
    ),
  );
  const selectedEntry = createMemo<QueryTabHistoryEntry | undefined>(() => {
    const entries = history();
    return (
      entries.find((entry) => entry.id === selectedId()) ??
      getDefaultSelectedEntry(entries, props.tab.sql)
    );
  });
  const diff = createMemo(() =>
    buildDiff(selectedEntry()?.sql ?? "", props.tab.sql),
  );

  createEffect(() => {
    const entries = history();
    const selected = entries.find((entry) => entry.id === selectedId());
    if (selected) return;

    const fallback = getDefaultSelectedEntry(entries, props.tab.sql);
    if (fallback?.id !== selectedId()) {
      setSelectedId(fallback?.id ?? "");
    }
  });

  onMount(() => {
    requestAnimationFrame(() => setVisible(true));
  });

  return (
    <DialogShell
      visible={visible()}
      onClose={props.onClose}
      class="w-[min(1100px,calc(100vw-32px))] h-[min(720px,calc(100vh-32px))] shadow-2xl flex flex-col"
      ariaLabel="Editor text history"
    >
      <div class="flex items-center justify-between gap-4 px-5 py-4 border-b border-border">
        <div class="min-w-0">
          <h2 class="text-base font-semibold text-text leading-tight">
            Text History
          </h2>
          <p class="text-s text-text-muted truncate mt-1">{props.tab.title}</p>
        </div>
        <DialogCloseButton onClick={props.onClose} />
      </div>

      <div class="grid grid-cols-[280px_minmax(0,1fr)] flex-1 min-h-0">
        <aside class="border-r border-border bg-surface/40 min-h-0 flex flex-col">
          <div class="px-3 py-2 border-b border-border">
            <p class="text-s font-semibold text-text-muted">
              {history().length} restore point{history().length === 1 ? "" : "s"}
            </p>
          </div>
          <div class="flex-1 overflow-y-auto p-2">
            <For each={history()}>
              {(entry) => (
                <button
                  type="button"
                  onClick={() => setSelectedId(entry.id)}
                  class={`w-full text-left rounded-lg border p-3 mb-2 transition-all duration-150 ease-in-out cursor-pointer ${
                    selectedEntry()?.id === entry.id
                      ? "border-accent/40 bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)] text-text shadow-sm"
                      : "border-border/30 bg-surface-header/20 hover:bg-surface-hover/80 hover:border-border/60 text-text-muted"
                  }`}
                >
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-s font-semibold text-text">
                      {formatRelativeTime(entry.createdAt)}
                    </span>
                    <span
                      class={`inline-flex items-center rounded px-1.5 py-0.5 text-3xs font-semibold tracking-wide uppercase border ${
                        entry.type === "action"
                          ? "bg-accent/10 border-accent/20 text-accent"
                          : "bg-surface-active border-border/30 text-text-muted"
                      }`}
                    >
                      {formatSnapshotType(entry)}
                    </span>
                  </div>
                  <div class="flex items-center gap-1.5 text-xs text-text-muted/80 mt-2">
                    <i class="fa-regular fa-clock opacity-60 text-3xs flex-shrink-0" />
                    <span class="truncate">
                      {formatSnapshotTime(entry.createdAt)}
                    </span>
                  </div>
                  <div class="flex items-center gap-1.5 text-xs text-text-muted/60 mt-1">
                    <i class="fa-solid fa-align-left opacity-50 text-3xs flex-shrink-0" />
                    <span>{formatSqlSize(entry.sql)}</span>
                  </div>
                </button>
              )}
            </For>
          </div>
        </aside>

        <main class="min-h-0 flex flex-col">
          <Show
            when={selectedEntry()}
            fallback={
              <div class="flex flex-1 items-center justify-center px-6 text-center text-s text-text-muted">
                No text history is available for this editor.
              </div>
            }
          >
            {(entry) => (
              <>
                <div class="flex items-center justify-between gap-4 px-4 py-3 border-b border-border">
                  <div class="min-w-0">
                    <p class="text-s font-semibold text-text">
                      Snapshot vs Current
                    </p>
                    <p class="text-xs text-text-muted mt-1">
                      {diff().removed} removed - {diff().added} added
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      props.onRestore(entry().sql);
                      props.onClose();
                    }}
                    disabled={entry().sql === props.tab.sql}
                    class="btn btn-primary"
                  >
                    <i class="fa-solid fa-rotate-left" />
                    <span>Restore</span>
                  </button>
                </div>

                <div class="flex-1 min-h-0 overflow-auto bg-surface font-mono text-xs">
                  <For each={diff().rows}>
                    {(row) => (
                      <div
                        class={`grid grid-cols-[48px_48px_24px_minmax(0,1fr)] min-h-[22px] border-b border-border/20 ${
                          row.type === "added"
                            ? "bg-[color-mix(in_srgb,var(--color-success)_13%,transparent)]"
                            : row.type === "removed"
                              ? "bg-[color-mix(in_srgb,var(--color-error)_13%,transparent)]"
                              : row.type === "omitted"
                                ? "bg-surface-hover text-text-muted"
                                : ""
                        }`}
                      >
                        <span class="px-2 py-1 text-right text-text-muted/70 select-none">
                          {row.oldLine ?? ""}
                        </span>
                        <span class="px-2 py-1 text-right text-text-muted/70 select-none border-r border-border/30">
                          {row.newLine ?? ""}
                        </span>
                        <span class="px-2 py-1 text-center select-none">
                          {row.type === "added"
                            ? "+"
                            : row.type === "removed"
                              ? "-"
                              : row.type === "omitted"
                                ? "..."
                                : ""}
                        </span>
                        <pre class="px-2 py-1 whitespace-pre-wrap break-words">
                          {row.text}
                        </pre>
                      </div>
                    )}
                  </For>
                </div>
              </>
            )}
          </Show>
        </main>
      </div>
    </DialogShell>
  );
}
