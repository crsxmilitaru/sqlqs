import { invoke } from "@tauri-apps/api/core";
import { createSignal, For, onMount, Show } from "solid-js";
import type { QueryResult } from "../../lib/types";
import type { ExplorerObjectType } from "../explorer/ObjectMenu";
import DialogCloseButton from "../ui/DialogCloseButton";
import DialogShell from "../ui/DialogShell";
import { Icon } from "../ui/Icons";
import Tooltip from "../ui/Tooltip";
import { Loader } from "../ui/Loader";

interface Props {
  database: string;
  schema: string;
  name: string;
  objectType: ExplorerObjectType;
  onClose: () => void;
}

interface DependencyRow {
  database?: string;
  schema: string;
  name: string;
  class: string;
}

type Tab = "used-by" | "references";

function objectTypeLabel(type: ExplorerObjectType): string {
  switch (type) {
    case "TABLE":
      return "Table";
    case "VIEW":
      return "View";
    case "PROCEDURE":
      return "Procedure";
    case "FUNCTION":
      return "Function";
    case "TRIGGER":
      return "Trigger";
    case "TYPE":
      return "Type";
  }
}

function classIcon(klass: string): string {
  const k = klass.toUpperCase();
  if (k.includes("PROCEDURE")) return "fa-cog";
  if (k.includes("VIEW")) return "fa-eye";
  if (k.includes("TRIGGER")) return "fa-bolt";
  if (k.includes("FUNCTION")) return "fa-superscript";
  if (k.includes("TYPE")) return "fa-shapes";
  if (k.includes("TABLE")) return "fa-table";
  if (k.includes("COLUMN")) return "fa-columns";
  return "fa-cube";
}

function rowFromQueryRow(
  row: (string | number | boolean | null)[],
  columns: { name: string }[],
): DependencyRow {
  const get = (col: string) => {
    const i = columns.findIndex((c) => c.name === col);
    return i >= 0 ? row[i] : null;
  };
  const dbVal = get("Database");
  const dbStr = dbVal == null ? "" : String(dbVal);
  return {
    database: dbStr === "" ? undefined : dbStr,
    schema: String(get("Schema") ?? ""),
    name: String(get("Name") ?? ""),
    class: String(get("Class") ?? ""),
  };
}

export default function DependenciesDialog(props: Props) {
  const [visible, setVisible] = createSignal(false);
  const [activeTab, setActiveTab] = createSignal<Tab>("used-by");
  const [usedByLoading, setUsedByLoading] = createSignal(true);
  const [usedByError, setUsedByError] = createSignal<string | null>(null);
  const [usedBy, setUsedBy] = createSignal<DependencyRow[]>([]);
  const [referencesLoading, setReferencesLoading] = createSignal(true);
  const [referencesError, setReferencesError] = createSignal<string | null>(
    null,
  );
  const [references, setReferences] = createSignal<DependencyRow[]>([]);

  onMount(() => {
    requestAnimationFrame(() => setVisible(true));

    const runAction = async (action: string): Promise<DependencyRow[]> => {
      const { sql } = await invoke<{ sql: string }>("generate_object_script", {
        database: props.database,
        schema: props.schema,
        name: props.name,
        objectType: props.objectType,
        action,
      });
      const result = await invoke<QueryResult>("execute_query", { sql });
      const rs = result.result_sets[0];
      if (!rs) return [];
      return rs.rows.map((row) => rowFromQueryRow(row, rs.columns));
    };

    const cleanError = (err: unknown) =>
      String(err ?? "Failed to load dependencies")
        .replace(/^Error:\s*/i, "")
        .replace(/^Query failed:\s*/i, "")
        .replace(/^Batch \d+ failed:\s*/i, "");

    runAction("referencing_entities")
      .then((rows) => setUsedBy(rows))
      .catch((err) => setUsedByError(cleanError(err)))
      .finally(() => setUsedByLoading(false));

    runAction("referenced_entities")
      .then((rows) => setReferences(rows))
      .catch((err) => setReferencesError(cleanError(err)))
      .finally(() => setReferencesLoading(false));
  });

  const fullName = () =>
    `[${props.database}].[${props.schema}].[${props.name}]`;

  const formatRow = (row: DependencyRow): string => {
    const parts = [row.database, row.schema, row.name].filter(
      (p) => p && p.length > 0,
    );
    return parts.map((p) => `[${p}]`).join(".");
  };

  const tabCount = (tab: Tab) =>
    tab === "used-by" ? usedBy().length : references().length;
  const tabLoading = (tab: Tab) =>
    tab === "used-by" ? usedByLoading() : referencesLoading();

  const renderList = (
    rows: DependencyRow[],
    loading: boolean,
    error: string | null,
    emptyMsg: string,
  ) => (
    <div class="flex-1 overflow-y-auto min-h-0">
      <Show when={loading}>
        <Loader variant="horizontal" size={16} text="Loading…" />
      </Show>
      <Show when={!loading && error}>
        <div class="m-4 text-sm text-error/90 bg-error/5 border border-error/15 rounded-lg px-3 py-2 select-text">
          {error}
        </div>
      </Show>
      <Show when={!loading && !error && rows.length === 0}>
        <div class="text-sm text-text-muted/60 py-10 text-center italic">
          {emptyMsg}
        </div>
      </Show>
      <Show when={!loading && !error && rows.length > 0}>
        <div class="flex flex-col divide-y divide-border/20">
          <For each={rows}>
            {(row) => (
              <div class="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-overlay/30">
                <Icon
                  name={classIcon(row.class)}
                  class="text-text-muted/60 text-xs w-4 text-center"
                  fixedWidth={false}
                />
                <div class="flex flex-col flex-1 min-w-0">
                  <span class="text-sm text-text font-mono truncate select-text">
                    {formatRow(row)}
                  </span>
                  <span class="text-[10px] text-text-muted/60 uppercase tracking-wider">
                    {row.class.replace(/_/g, " ").toLowerCase()}
                  </span>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );

  return (
    <DialogShell
      visible={visible()}
      onClose={props.onClose}
      class="w-[600px] h-[600px] max-h-[85vh] flex flex-col shadow-2xl"
      ariaLabel={`${objectTypeLabel(props.objectType)} Dependencies`}
    >
        <div class="flex items-center justify-between px-6 py-4 border-b border-overlay-xs">
          <div class="flex items-center gap-3 min-w-0">
            <div class="w-8 h-8 rounded-lg flex items-center justify-center bg-accent/10 text-accent shrink-0">
              <Icon name="diagram-project" class="text-sm" />
            </div>
            <div class="flex flex-col min-w-0">
              <h2 class="text-m font-semibold text-text">
                {objectTypeLabel(props.objectType)} Dependencies
              </h2>
              <p
                class="text-xs text-text-muted font-mono truncate"
                title={fullName()}
              >
                {fullName()}
              </p>
            </div>
          </div>
          <DialogCloseButton onClick={props.onClose} />
        </div>

        <div class="flex border-b border-border/30 px-2">
          <For
            each={[
              {
                id: "used-by" as const,
                label: "Used By",
                hint: "What references this object",
              },
              {
                id: "references" as const,
                label: "References",
                hint: "What this object references",
              },
            ]}
          >
            {(tab) => (
              <Tooltip content={tab.hint} placement="bottom">
                <button
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  class={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px flex items-center gap-2 cursor-pointer ${
                    activeTab() === tab.id
                      ? "border-accent text-text"
                      : "border-transparent text-text-muted hover:text-text"
                  }`}
                >
                  {tab.label}
                  <Show when={!tabLoading(tab.id)}>
                    <span
                      class={`text-[10px] rounded-full px-1.5 py-0.5 min-w-[18px] text-center ${
                        activeTab() === tab.id
                          ? "bg-accent/20 text-accent"
                          : "bg-surface-overlay text-text-muted"
                      }`}
                    >
                      {tabCount(tab.id)}
                    </span>
                  </Show>
                </button>
              </Tooltip>
            )}
          </For>
        </div>

        <Show when={activeTab() === "used-by"}>
          {renderList(
            usedBy(),
            usedByLoading(),
            usedByError(),
            "Nothing references this object.",
          )}
        </Show>

        <Show when={activeTab() === "references"}>
          {renderList(
            references(),
            referencesLoading(),
            referencesError(),
            "This object doesn't reference anything.",
          )}
        </Show>

        <div class="flex justify-end gap-3 px-6 py-4 border-t border-border rounded-b-2xl">
          <button
            type="button"
            onClick={props.onClose}
            class="btn btn-primary px-6 py-1.5"
          >
            Close
          </button>
        </div>
    </DialogShell>
  );
}
