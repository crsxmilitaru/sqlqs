import {
  acceptCompletion,
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  startCompletion,
  type CompletionContext,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
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
import { AiService } from "../lib/ai";
import { getModifierKeyLabel } from "../lib/platform";
import type { ColumnInfo, DatabaseObject } from "../lib/types";

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
}

const DEBOUNCE_MS = 400;

const SqlEditor = forwardRef<SqlEditorHandle, Props>(function SqlEditor(
  { value, onChange, onExecute, readOnly, theme, currentDatabase, onContextMenu }: Props,
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const schemaRef = useRef<{ tables: Map<string, { name: string; schema: string; columns: string[] }> }>({ tables: new Map() });
  const executeShortcutLabel = `${getModifierKeyLabel()}+Enter`;
  const onChangeRef = useRef(onChange);
  const onExecuteRef = useRef(onExecute);
  onChangeRef.current = onChange;
  onExecuteRef.current = onExecute;

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
    }),
    [],
  );

  const schemaCompletionSource = useCallback((context: CompletionContext) => {
    const { tables } = schemaRef.current;
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

  const aiCompletionSource = useCallback(async (context: CompletionContext) => {
    if (!AiService.isEnabled() || !AiService.getApiKey()) {
      return null;
    }

    const { state, pos } = context;
    const line = state.doc.lineAt(pos);

    if (!context.explicit && line.text.slice(0, pos - line.from).match(/\w$/)) {
      return null;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (!context.explicit) {
      const aborted = await new Promise<boolean>((resolve) => {
        if (controller.signal.aborted) { resolve(true); return; }
        const timer = setTimeout(() => resolve(false), DEBOUNCE_MS);
        controller.signal.addEventListener("abort", () => {
          clearTimeout(timer);
          resolve(true);
        }, { once: true });
      });
      if (aborted) return null;
    }

    if (controller.signal.aborted) return null;

    const before = state.doc.sliceString(Math.max(0, pos - 2000), pos);
    const after = state.doc.sliceString(pos, Math.min(state.doc.length, pos + 1000));

    try {
      let schema = AiService.getCachedSchema();
      if (!schema) {
        const [currentDatabase, schemaSummary] = await invoke<[string | null, string]>("generate_sql_completion");
        AiService.setCachedSchema(currentDatabase, schemaSummary);
        schema = { database: currentDatabase, summary: schemaSummary };
      }

      if (controller.signal.aborted) return null;

      const result = await AiService.generateCompletion(
        { before_cursor: before, after_cursor: after },
        schema.database || undefined,
        schema.summary || undefined,
        controller.signal,
      );

      if (controller.signal.aborted) return null;

      if (!result?.insert_text?.trim()) {
        return null;
      }

      const firstLine = result.insert_text.split("\n")[0];
      const isMultiline = result.insert_text.includes("\n");

      return {
        from: pos,
        options: [
          {
            label: firstLine + (isMultiline ? " ..." : ""),
            apply: result.insert_text,
            type: "text",
            detail: `AI · ${result.duration_ms}ms`,
            boost: 99,
          },
        ],
      };
    } catch (err: any) {
      if (err.name === "AbortError") return null;
      console.error("AI Completion error:", err);
      return null;
    }
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

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChangeRef.current(update.state.doc.toString());
      }
    });

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        history(),
        foldGutter(),
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
          { autocomplete: aiCompletionSource },
        ]),
        highlightSelectionMatches(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        ...(theme.id === "light" || theme.id === "soft-light" ? [] : [oneDark]),
        executeKeymap,
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
        placeholderExt(`-- Write your SQL query here... (F5 or ${executeShortcutLabel} to execute)`),
        EditorView.lineWrapping,
        ...(readOnly ? [EditorState.readOnly.of(true)] : []),
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
  }, [aiCompletionSource, schemaCompletionSource, executeShortcutLabel, readOnly, theme]);

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
    let cancelled = false;

    (async () => {
      try {
        const objects: DatabaseObject[] = await invoke("get_tables", { database: currentDatabase });
        if (cancelled) return;

        const tables = objects.filter((o) => o.object_type === "TABLE" || o.object_type === "VIEW");

        const entries = await Promise.all(
          tables.map(async (t) => {
            try {
              const cols: ColumnInfo[] = await invoke("get_columns", {
                database: currentDatabase,
                schema: t.schema_name,
                table: t.name,
              });
              return [t.schema_name, t.name, cols.map((c) => c.name)] as const;
            } catch {
              return [t.schema_name, t.name, [] as string[]] as const;
            }
          }),
        );

        if (cancelled) return;

        const map = new Map<string, { name: string; schema: string; columns: string[] }>();
        for (const [schemaName, tableName, cols] of entries) {
          map.set(tableName.toLowerCase(), { name: tableName, schema: schemaName, columns: cols });
        }
        schemaRef.current = { tables: map };
        console.log("[schema-load] loaded", map.size, "tables for", currentDatabase);
      } catch (err) {
        console.error("Failed to load schema for autocomplete:", err);
      }
    })();

    return () => { cancelled = true; };
  }, [currentDatabase]);

  return <div ref={containerRef} onContextMenu={onContextMenu} className="h-full w-full overflow-hidden" />;
});

export default SqlEditor;
