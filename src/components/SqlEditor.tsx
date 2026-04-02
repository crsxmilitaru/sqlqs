import {
  acceptCompletion,
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  startCompletion,
  type CompletionContext,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, moveLineDown, moveLineUp } from "@codemirror/commands";
import { MSSQL, sql } from "@codemirror/lang-sql";
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  syntaxHighlighting,
} from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder as placeholderExt,
} from "@codemirror/view";
import { invoke } from "@tauri-apps/api/core";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { getModifierKeyLabel } from "../lib/platform";
import type { DatabaseSchemaCatalogEntry } from "../lib/types";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onExecute: (selectedSql?: string) => void;
  readOnly?: boolean;
  theme: { id: string };
  currentDatabase?: string;
  onContextMenu?: (e: React.MouseEvent) => void;
}

export interface SqlEditorHandle {
  focus: () => void;
  openCompletion: () => void;
  getSelectedText: () => string;
  scrollToBottom: () => void;
}

function createFoldMarker(open: boolean): HTMLElement {
  const marker = document.createElement("span");
  marker.className = "cm-foldMarker";
  marker.setAttribute("aria-hidden", "true");
  marker.dataset.state = open ? "open" : "closed";

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 12 12");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", open ? "M3 4.5 6 7.5 9 4.5" : "M4.5 3 7.5 6 4.5 9");

  svg.appendChild(path);
  marker.appendChild(svg);

  return marker;
}

interface SchemaTableEntry {
  name: string;
  schema: string;
  columns: string[];
}

type SchemaTableMap = Map<string, SchemaTableEntry>;

const schemaCatalogCache = new Map<string, SchemaTableMap>();
const schemaCatalogLoaders = new Map<string, Promise<SchemaTableMap>>();

function buildSchemaTableMap(entries: DatabaseSchemaCatalogEntry[]): SchemaTableMap {
  const map: SchemaTableMap = new Map();

  for (const entry of entries) {
    map.set(entry.table_name.toLowerCase(), {
      name: entry.table_name,
      schema: entry.schema_name,
      columns: entry.columns,
    });
  }

  return map;
}

async function loadSchemaTableMap(database: string): Promise<SchemaTableMap> {
  const cached = schemaCatalogCache.get(database);
  if (cached) {
    return cached;
  }

  const existingLoader = schemaCatalogLoaders.get(database);
  if (existingLoader) {
    return existingLoader;
  }

  const loader = invoke<DatabaseSchemaCatalogEntry[]>("get_database_schema_catalog", {
    database,
  })
    .then((entries) => {
      const map = buildSchemaTableMap(entries);
      schemaCatalogCache.set(database, map);
      return map;
    })
    .finally(() => {
      schemaCatalogLoaders.delete(database);
    });

  schemaCatalogLoaders.set(database, loader);
  return loader;
}

const SqlEditor = forwardRef<SqlEditorHandle, Props>(function SqlEditor(
  { value, onChange, onExecute, readOnly, theme, currentDatabase, onContextMenu }: Props,
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const schemaRef = useRef<{ database?: string; tables: SchemaTableMap }>({ tables: new Map() });
  const currentDatabaseRef = useRef(currentDatabase);
  const executeShortcutLabel = `${getModifierKeyLabel()}+Enter`;
  const onChangeRef = useRef(onChange);
  const onExecuteRef = useRef(onExecute);
  onChangeRef.current = onChange;
  onExecuteRef.current = onExecute;
  currentDatabaseRef.current = currentDatabase;

  useImperativeHandle(
    ref,
    () => ({
      focus() {
        viewRef.current?.focus();
      },
      openCompletion() {
        const view = viewRef.current;
        if (!view) return;
        view.focus();
        startCompletion(view);
      },
      getSelectedText() {
        const view = viewRef.current;
        if (!view) return "";
        const selection = view.state.selection.main;
        if (selection.from === selection.to) return "";
        return view.state.doc.sliceString(selection.from, selection.to);
      },
      scrollToBottom() {
        const view = viewRef.current;
        if (!view) return;
        const end = view.state.doc.length;
        view.dispatch({
          selection: { anchor: end },
          scrollIntoView: true,
        });
      },
    }),
    [],
  );

  const schemaCompletionSource = useCallback(async (context: CompletionContext) => {
    const database = currentDatabaseRef.current;
    if (!database) {
      return null;
    }

    let { tables } = schemaRef.current;
    if (schemaRef.current.database !== database) {
      if (!context.explicit) {
        return null;
      }

      try {
        tables = await loadSchemaTableMap(database);
      } catch (err) {
        console.error("Failed to load schema for autocomplete:", err);
        return null;
      }

      if (currentDatabaseRef.current !== database) {
        return null;
      }

      schemaRef.current = { database, tables };
    }

    if (tables.size === 0) return null;

    const word = context.matchBefore(/[\w.]+/);
    if (!word && !context.explicit) return null;
    const from = word?.from ?? context.pos;
    const text = word?.text ?? "";

    const dotParts = text.split(".");

    if (dotParts.length >= 2) {
      const lastPart = dotParts[dotParts.length - 1];
      const tableName = dotParts.length >= 3 ? dotParts[1] : dotParts[0];
      const entry = tables.get(tableName.toLowerCase());
      if (entry) {
        return {
          from: from + text.length - lastPart.length,
          options: entry.columns.map((col) => ({ label: col, type: "property" })),
        };
      }
    }

    const options: { label: string; type: string; detail?: string }[] = [];
    for (const [, entry] of tables) {
      options.push({ label: entry.name, type: "type", detail: entry.schema });
    }
    return { from, options };
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const runExecute = (view: EditorView) => {
      const selection = view.state.selection.main;
      const selectedSql =
        selection.from !== selection.to
          ? view.state.doc.sliceString(selection.from, selection.to)
          : undefined;
      onExecuteRef.current(selectedSql);
      return true;
    };

    const executeKeymap = keymap.of([
      { key: "F5", run: runExecute },
      { key: "Mod-Enter", run: runExecute },
    ]);
    const lineMovementKeymap = keymap.of([
      { key: "Alt-ArrowUp", run: moveLineUp },
      { key: "Alt-ArrowDown", run: moveLineDown },
    ]);

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChangeRef.current(update.state.doc.toString());
      }
    });
    const placeholderText = readOnly && !currentDatabase
      ? "Select a database to enable the SQL editor."
      : `-- Write your SQL query here... (F5 or ${executeShortcutLabel} to execute)`;

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        history(),
        foldGutter({
          markerDOM: (open) => createFoldMarker(open),
        }),
        bracketMatching(),
        closeBrackets(),
        autocompletion({
          defaultKeymap: true,
          closeOnBlur: false,
          maxRenderedOptions: 5,
        }),
        sql({ dialect: MSSQL, upperCaseKeywords: true }),
        EditorState.languageData.of(() => [
          { autocomplete: schemaCompletionSource },
        ]),
        highlightSelectionMatches(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        ...(theme.id === "light" || theme.id === "soft-light" ? [] : [oneDark]),
        executeKeymap,
        lineMovementKeymap,
        keymap.of([
          { key: "Tab", run: acceptCompletion },
          ...defaultKeymap,
          ...historyKeymap,
          ...completionKeymap,
          ...closeBracketsKeymap,
          ...foldKeymap,
          ...searchKeymap,
        ]),
        updateListener,
        placeholderExt(placeholderText),
        EditorView.lineWrapping,
        ...(readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []),
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [currentDatabase, schemaCompletionSource, executeShortcutLabel, readOnly, theme]);

  useEffect(() => {
    const view = viewRef.current;
    if (view && view.state.doc.toString() !== value) {
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: value,
        },
      });
    }
  }, [value]);

  useEffect(() => {
    if (!currentDatabase) return;
    const cached = schemaCatalogCache.get(currentDatabase);
    if (cached) {
      schemaRef.current = { database: currentDatabase, tables: cached };
      return;
    }

    schemaRef.current = { database: currentDatabase, tables: new Map() };

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void loadSchemaTableMap(currentDatabase)
        .then((tables) => {
          if (cancelled || currentDatabaseRef.current !== currentDatabase) {
            return;
          }

          schemaRef.current = { database: currentDatabase, tables };
        })
        .catch((err) => {
          if (!cancelled) {
            console.error("Failed to preload schema for autocomplete:", err);
          }
        });
    }, 150);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [currentDatabase]);

  useEffect(() => {
    if (!currentDatabase) {
      schemaRef.current = { database: undefined, tables: new Map() };
    }
  }, [currentDatabase]);

  return <div ref={containerRef} onContextMenu={onContextMenu} className="h-full min-h-0 w-full relative" />;
});

export default SqlEditor;
