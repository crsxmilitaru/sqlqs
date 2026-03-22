import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import {
  EditorView,
  keymap,
  placeholder as placeholderExt,
  lineNumbers,
  highlightActiveLineGutter,
  highlightActiveLine,
} from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { sql, MSSQL } from "@codemirror/lang-sql";
import { oneDark } from "@codemirror/theme-one-dark";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  autocompletion,
  completionKeymap,
  closeBrackets,
  closeBracketsKeymap,
  startCompletion,
  type CompletionContext,
} from "@codemirror/autocomplete";
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
  foldGutter,
  foldKeymap,
} from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { invoke } from "@tauri-apps/api/core";
import { AiService } from "../lib/ai";
import { getModifierKeyLabel } from "../lib/platform";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onExecute: (selectedSql?: string) => void;
  readOnly?: boolean;
  theme: { id: string };
  onContextMenu?: (e: React.MouseEvent) => void;
}

export interface SqlEditorHandle {
  focus: () => void;
  openCompletion: () => void;
  getSelectedText: () => string;
}

const SqlEditor = forwardRef<SqlEditorHandle, Props>(function SqlEditor(
  { value, onChange, onExecute, readOnly, theme, onContextMenu }: Props,
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
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

  const aiCompletionSource = useCallback(async (context: CompletionContext) => {
    const { state, pos } = context;
    const before = state.doc.sliceString(Math.max(0, pos - 2000), pos);
    const after = state.doc.sliceString(pos, Math.min(state.doc.length, pos + 1000));
    const line = state.doc.lineAt(pos);

    if (!context.explicit && line.text.slice(0, pos - line.from).match(/\w$/)) {
      return null;
    }

    try {
      const [currentDatabase, schemaSummary] = await invoke<[string | null, string]>("generate_sql_completion");

      const result = await AiService.generateCompletion(
        {
          before_cursor: before,
          after_cursor: after,
        },
        currentDatabase || undefined,
        schemaSummary || undefined
      );

      if (!result || !result.insert_text || result.insert_text.trim() === "") {
        return null;
      }

      return {
        from: pos,
        options: [
          {
            label: result.insert_text.split("\n")[0] + (result.insert_text.includes("\n") ? "..." : ""),
            apply: result.insert_text,
            type: "ai",
            detail: `AI (${result.model_label})`,
            boost: 99,
          },
        ],
      };
    } catch (err) {
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
          override: [aiCompletionSource],
          defaultKeymap: true,
          closeOnBlur: false,
        }),
        highlightSelectionMatches(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        sql({ dialect: MSSQL, upperCaseKeywords: true }),
        ...(theme.id === "light" || theme.id === "soft-light" ? [] : [oneDark]),
        executeKeymap,
        keymap.of([
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
  }, [aiCompletionSource, executeShortcutLabel, readOnly, theme]);

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

  return <div ref={containerRef} onContextMenu={onContextMenu} className="h-full w-full overflow-hidden" />;
});

export default SqlEditor;
