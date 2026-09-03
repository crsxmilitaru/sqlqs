import { completionStatus } from "@codemirror/autocomplete";
import {
  StateEffect,
  StateField,
  Transaction,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import {
  canSuggestInlineCompletion,
  clearInlineSuggestionEffect,
  GhostTextWidget,
} from "./sql-inline-completion";

export interface AiInlineCompletionContext {
  prefix: string;
  suffix: string;
  signal: AbortSignal;
}

export interface AiInlineCompletionOptions {
  fetch: (context: AiInlineCompletionContext) => Promise<string | null>;
  debounceMs?: number;
}

interface AiSuggestion {
  at: number;
  text: string;
}

interface AiFieldState {
  suggestion: AiSuggestion | null;
  decorations: DecorationSet;
}

const setAiSuggestion = StateEffect.define<AiSuggestion | null>();
const requestAiQuery = StateEffect.define<null>();

const DEFAULT_DEBOUNCE_MS = 500;

function buildAiDecorations(
  state: EditorState,
  suggestion: AiSuggestion | null,
): DecorationSet {
  if (!suggestion || completionStatus(state) === "active") {
    return Decoration.none;
  }

  const newlineIndex = suggestion.text.indexOf("\n");
  if (newlineIndex < 0) {
    return Decoration.set([
      Decoration.widget({
        widget: new GhostTextWidget(suggestion.text, "cm-ai-ghost"),
        side: 1,
      }).range(suggestion.at),
    ]);
  }

  const ranges = [];
  const firstLine = suggestion.text.slice(0, newlineIndex);
  if (firstLine) {
    ranges.push(
      Decoration.widget({
        widget: new GhostTextWidget(firstLine, "cm-ai-ghost"),
        side: 1,
      }).range(suggestion.at),
    );
  }
  const remainingLines = suggestion.text.slice(newlineIndex + 1);
  if (remainingLines) {
    ranges.push(
      Decoration.widget({
        widget: new GhostTextWidget(
          remainingLines,
          "cm-ai-ghost cm-ai-ghost-block",
          true,
        ),
        block: true,
        side: 1,
      }).range(state.doc.lineAt(suggestion.at).to),
    );
  }
  return Decoration.set(ranges, true);
}

const aiField = StateField.define<AiFieldState>({
  create: () => ({ suggestion: null, decorations: Decoration.none }),
  update(value, transaction) {
    let suggestion = value.suggestion;
    let handled = false;
    for (const effect of transaction.effects) {
      if (effect.is(setAiSuggestion)) {
        suggestion = effect.value;
        handled = true;
      }
    }
    if (!handled) {
      if (transaction.docChanged) {
        suggestion = null;
      } else if (
        transaction.selection &&
        transaction.selection.main.head !== suggestion?.at
      ) {
        suggestion = null;
      }
    }
    const popupChanged =
      completionStatus(transaction.startState) !==
      completionStatus(transaction.state);
    if (suggestion === value.suggestion && !popupChanged) {
      return value;
    }
    return {
      suggestion,
      decorations: buildAiDecorations(transaction.state, suggestion),
    };
  },
  provide: (field) =>
    EditorView.decorations.from(field, (value) => value.decorations),
});

function currentSuggestion(state: EditorState): AiSuggestion | null {
  return state.field(aiField, false)?.suggestion ?? null;
}

function shouldAutoQuery(transaction: Transaction): boolean {
  const event = transaction.annotation(Transaction.userEvent);
  if (!event || event === "input.complete") return false;
  return (
    event.startsWith("input.") ||
    event.startsWith("delete.") ||
    event.startsWith("select.") ||
    event.startsWith("paste") ||
    event.startsWith("drop")
  );
}

export function aiInlineCompletion(options: AiInlineCompletionOptions): Extension {
  const fetchCompletion = options.fetch;
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  const plugin = ViewPlugin.fromClass(
    class {
      private generation = 0;
      private timer: number | undefined;
      private controller: AbortController | undefined;

      constructor(private readonly view: EditorView) {}

      update(update: ViewUpdate) {
        let requested = false;
        let schedule = false;
        for (const transaction of update.transactions) {
          if (transaction.effects.some((effect) => effect.is(requestAiQuery))) {
            requested = true;
          }
          if (shouldAutoQuery(transaction)) {
            schedule = true;
          }
        }
        if (requested) {
          this.queryNow();
        } else if (schedule) {
          this.schedule();
        }
      }

      destroy() {
        this.cancelPending();
      }

      private schedule() {
        this.cancelPending();
        this.timer = window.setTimeout(() => {
          this.timer = undefined;
          void this.query();
        }, debounceMs);
      }

      private queryNow() {
        this.cancelPending();
        void this.query();
      }

      private cancelPending() {
        this.generation++;
        if (this.timer !== undefined) {
          clearTimeout(this.timer);
          this.timer = undefined;
        }
        this.controller?.abort();
        this.controller = undefined;
      }

      private async query() {
        const generation = this.generation;
        const state = this.view.state;
        if (!canSuggestInlineCompletion(state)) return;

        const pos = state.selection.main.head;
        const controller = new AbortController();
        this.controller = controller;

        let completion: string | null;
        try {
          completion = await fetchCompletion({
            prefix: state.doc.sliceString(0, pos),
            suffix: state.doc.sliceString(pos, state.doc.length),
            signal: controller.signal,
          });
        } catch {
          return;
        } finally {
          if (this.controller === controller) {
            this.controller = undefined;
          }
        }

        if (generation !== this.generation || controller.signal.aborted) {
          return;
        }
        const current = this.view.state;
        if (
          current.doc !== state.doc ||
          current.selection.main.head !== pos ||
          !canSuggestInlineCompletion(current)
        ) {
          return;
        }
        if (!completion) return;

        const existing = currentSuggestion(current);
        if (existing?.at === pos && existing.text === completion) return;

        this.view.dispatch({
          effects: [
            setAiSuggestion.of({ at: pos, text: completion }),
            clearInlineSuggestionEffect(),
          ],
        });
      }
    },
  );

  return [aiField, plugin];
}

export function hasAiSuggestion(view: EditorView): boolean {
  return currentSuggestion(view.state) != null;
}

export function clearAiSuggestion(view: EditorView): void {
  if (currentSuggestion(view.state)) {
    view.dispatch({ effects: setAiSuggestion.of(null) });
  }
}

export function requestAiSuggestion(view: EditorView): void {
  view.dispatch({ effects: requestAiQuery.of(null) });
}

export function acceptAiSuggestion(view: EditorView): boolean {
  const suggestion = currentSuggestion(view.state);
  if (!suggestion || view.state.readOnly) return false;
  view.dispatch({
    changes: { from: suggestion.at, to: suggestion.at, insert: suggestion.text },
    selection: { anchor: suggestion.at + suggestion.text.length },
    userEvent: "input.complete",
    scrollIntoView: true,
  });
  return true;
}
