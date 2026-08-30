import {
  completionStatus,
  CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { StateEffect, StateField, type EditorState, type Extension, type Transaction } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

export interface SqlInlineCompletionOptions {
  source: (
    context: CompletionContext,
  ) => CompletionResult | null | Promise<CompletionResult | null>;
}

interface GhostSuggestion {
  from: number;
  to: number;
  at: number;
  text: string;
  remainder: string;
}

const setGhost = StateEffect.define<GhostSuggestion | null>();

function mapSuggestion(
  ghost: GhostSuggestion,
  transaction: Transaction,
): GhostSuggestion | null {
  const changes = transaction.changes;
  const mapped: GhostSuggestion = {
    ...ghost,
    from: changes.mapPos(ghost.from, 1),
    to: changes.mapPos(ghost.to, 1),
    at: changes.mapPos(ghost.at, 1),
  };
  return mapped.from >= 0 && mapped.at >= 0 && mapped.to >= 0 ? mapped : null;
}

/**
 * The stored ghost is only position-mapped on doc changes; this validates it
 * against the live state so stale ghosts never render or get accepted.
 */
function currentGhost(state: EditorState): GhostSuggestion | null {
  const ghost = state.field(ghostField, false);
  if (!ghost) return null;
  const selection = state.selection;
  if (selection.ranges.length !== 1 || !selection.main.empty) return null;
  if (ghost.at !== selection.main.head || ghost.from >= ghost.at) return null;
  const covered = state.doc.sliceString(ghost.from, ghost.at);
  if (
    covered.toLowerCase() !== ghost.text.slice(0, covered.length).toLowerCase()
  ) {
    return null;
  }
  const remainder = ghost.text.slice(covered.length);
  return remainder ? { ...ghost, remainder } : null;
}

const ghostField = StateField.define<GhostSuggestion | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setGhost)) return effect.value;
    }
    if (!transaction.docChanged) {
      return transaction.selection ? null : value;
    }
    return value ? mapSuggestion(value, transaction) : null;
  },
});

class GhostWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }

  eq(other: GhostWidget) {
    return other.text === this.text;
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-sql-ghost";
    span.setAttribute("aria-hidden", "true");
    span.textContent = this.text;
    return span;
  }

  ignoreEvent() {
    return true;
  }
}

function buildGhostDecorations(state: EditorState): DecorationSet {
  if (completionStatus(state) === "active") return Decoration.none;
  const ghost = currentGhost(state);
  if (!ghost) return Decoration.none;
  return Decoration.set([
    Decoration.widget({
      widget: new GhostWidget(ghost.remainder),
      side: 1,
    }).range(ghost.at),
  ]);
}

function remainderForInsert(
  insert: string,
  label: string,
  covered: string,
): string | null {
  const coveredLower = covered.toLowerCase();
  const insertLower = insert.toLowerCase();
  let remainder: string;

  if (insertLower.startsWith(coveredLower)) {
    remainder = insert.slice(covered.length);
  } else {
    const labelLower = label.toLowerCase();
    if (!labelLower.startsWith(coveredLower)) return null;
    const labelAt = insertLower.indexOf(labelLower);
    if (labelAt < 0) return null;
    remainder = insert.slice(labelAt + covered.length);
  }

  if (!remainder || remainder.includes("\n")) return null;
  return remainder;
}

function buildSuggestion(
  result: CompletionResult,
  state: EditorState,
): GhostSuggestion | null {
  const pos = state.selection.main.head;
  const to = result.to ?? pos;
  if (result.from >= pos || to < pos) return null;
  const covered = state.doc.sliceString(result.from, to);

  for (const option of result.options) {
    if (typeof option.apply === "function") continue;
    const insert =
      typeof option.apply === "string" ? option.apply : option.label;
    if (!insert) continue;
    const remainder = remainderForInsert(insert, option.label, covered);
    if (!remainder) continue;
    return { from: result.from, to, at: pos, text: insert, remainder };
  }
  return null;
}

function canSuggest(state: EditorState): boolean {
  if (state.readOnly) return false;
  const selection = state.selection;
  if (selection.ranges.length !== 1 || !selection.main.empty) return false;
  if (completionStatus(state) === "active") return false;
  const pos = selection.main.head;
  const next = state.doc.sliceString(pos, pos + 1);
  return !(next && /[\w@$#]/.test(next));
}

export function sqlInlineCompletion(
  options: SqlInlineCompletionOptions,
): Extension {
  const source = options.source;

  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      private generation = 0;

      constructor(private readonly view: EditorView) {
        this.decorations = buildGhostDecorations(view.state);
        void this.query();
      }

      update(update: ViewUpdate) {
        const wasActive = completionStatus(update.startState) === "active";
        const isActive = completionStatus(update.state) === "active";
        if (
          wasActive !== isActive ||
          update.docChanged ||
          update.selectionSet
        ) {
          this.generation++;
          if (!isActive) {
            void this.query();
          }
        }
        this.decorations = buildGhostDecorations(update.state);
      }

      destroy() {
        this.generation++;
      }

      private async query() {
        const generation = this.generation;
        const state = this.view.state;
        if (!canSuggest(state)) return;

        const pos = state.selection.main.head;
        let result: CompletionResult | null;
        try {
          result = await source(new CompletionContext(state, pos, false));
        } catch (err) {
          console.error("Inline SQL completion failed:", err);
          return;
        }
        if (generation !== this.generation) return;
        const current = this.view.state;
        if (
          current.doc !== state.doc ||
          current.selection.main.head !== pos ||
          !canSuggest(current)
        ) {
          return;
        }

        const suggestion = result ? buildSuggestion(result, state) : null;
        const existing = current.field(ghostField, false);
        if (
          suggestion?.from === existing?.from &&
          suggestion?.to === existing?.to &&
          suggestion?.at === existing?.at &&
          suggestion?.text === existing?.text
        ) {
          return;
        }
        this.view.dispatch({ effects: setGhost.of(suggestion) });
      }
    },
    { decorations: (view) => view.decorations },
  );

  return [ghostField, plugin];
}

export function hasInlineSuggestion(view: EditorView): boolean {
  return currentGhost(view.state) != null;
}

export function clearInlineSuggestion(view: EditorView): void {
  if (view.state.field(ghostField, false)) {
    view.dispatch({ effects: setGhost.of(null) });
  }
}

export function acceptInlineSuggestion(view: EditorView): boolean {
  const ghost = currentGhost(view.state);
  if (!ghost || view.state.readOnly) return false;
  view.dispatch({
    changes: { from: ghost.from, to: ghost.to, insert: ghost.text },
    selection: { anchor: ghost.from + ghost.text.length },
    userEvent: "input.complete",
    scrollIntoView: true,
  });
  return true;
}
