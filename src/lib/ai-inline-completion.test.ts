import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptAiSuggestion,
  aiInlineCompletion,
  clearAiSuggestion,
  hasAiSuggestion,
  requestAiSuggestion,
  type AiInlineCompletionContext,
} from "./ai-inline-completion";

const DEBOUNCE_MS = 500;

function createEditor(
  fetchCompletion: (
    context: AiInlineCompletionContext,
  ) => Promise<string | null>,
  options?: { readOnly?: boolean; doc?: string; anchor?: number },
) {
  const parent = document.createElement("div");
  document.body.append(parent);
  const state = EditorState.create({
    doc: options?.doc ?? "SEL",
    selection: { anchor: options?.anchor ?? 3 },
    extensions: [
      EditorState.readOnly.of(options?.readOnly ?? false),
      aiInlineCompletion({ fetch: fetchCompletion, debounceMs: DEBOUNCE_MS }),
    ],
  });
  const view = new EditorView({ state, parent });
  return {
    view,
    dispose: () => {
      view.destroy();
      parent.remove();
    },
  };
}

function typeText(view: EditorView, text: string) {
  const pos = view.state.selection.main.head;
  view.dispatch({
    changes: { from: pos, to: pos, insert: text },
    selection: { anchor: pos + text.length },
    userEvent: "input.type",
  });
}

async function flushAsync() {
  await vi.advanceTimersByTimeAsync(0);
}

describe("AI inline completion", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits for the debounce before querying", async () => {
    const fetchCompletion = vi.fn().mockResolvedValue("ECT");
    const editor = createEditor(fetchCompletion);

    typeText(editor.view, "E");
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1);
    expect(fetchCompletion).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchCompletion).toHaveBeenCalledTimes(1);
    expect(fetchCompletion).toHaveBeenCalledWith({
      prefix: "SELE",
      suffix: "",
      signal: expect.any(AbortSignal),
    });
    expect(hasAiSuggestion(editor.view)).toBe(true);

    editor.dispose();
  });

  it("renders and accepts a single-line suggestion", async () => {
    const editor = createEditor(() => Promise.resolve("CT * FROM [Orders]"));

    typeText(editor.view, "E");
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(hasAiSuggestion(editor.view)).toBe(true);
    expect(document.querySelector(".cm-ai-ghost")).toHaveTextContent(
      "CT * FROM [Orders]",
    );
    expect(document.querySelector(".cm-ai-ghost-block")).toBeNull();

    expect(acceptAiSuggestion(editor.view)).toBe(true);
    expect(editor.view.state.doc.toString()).toBe("SELECT * FROM [Orders]");
    expect(editor.view.state.selection.main.head).toBe(
      "SELECT * FROM [Orders]".length,
    );
    expect(hasAiSuggestion(editor.view)).toBe(false);

    editor.dispose();
  });

  it("renders multi-line suggestions and inserts the full text on accept", async () => {
    const editor = createEditor(() =>
      Promise.resolve("CT *\nFROM [Orders]\nWHERE 1 = 1"),
    );

    typeText(editor.view, "E");
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    const inline = document.querySelector(
      ".cm-ai-ghost:not(.cm-ai-ghost-block)",
    );
    expect(inline?.textContent).toBe("CT *");
    expect(
      document.querySelector(".cm-ai-ghost-block")?.textContent,
    ).toBe("FROM [Orders]\nWHERE 1 = 1");

    acceptAiSuggestion(editor.view);
    expect(editor.view.state.doc.toString()).toBe(
      "SELECT *\nFROM [Orders]\nWHERE 1 = 1",
    );

    editor.dispose();
  });

  it("discards stale responses after further typing", async () => {
    const resolvers: Array<(value: string | null) => void> = [];
    const fetchCompletion = vi.fn(
      () =>
        new Promise<string | null>((resolve) => resolvers.push(resolve)),
    );
    const editor = createEditor(fetchCompletion);

    typeText(editor.view, "E");
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    typeText(editor.view, "C");
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(fetchCompletion).toHaveBeenCalledTimes(2);

    resolvers[0]("ECT");
    await flushAsync();
    expect(hasAiSuggestion(editor.view)).toBe(false);

    resolvers[1]("CT * FROM [Orders]");
    await flushAsync();
    expect(hasAiSuggestion(editor.view)).toBe(true);

    editor.dispose();
  });

  it("clears the suggestion when the document changes", async () => {
    const editor = createEditor(() => Promise.resolve("CT"));

    typeText(editor.view, "E");
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(hasAiSuggestion(editor.view)).toBe(true);

    typeText(editor.view, "F");
    expect(hasAiSuggestion(editor.view)).toBe(false);

    clearAiSuggestion(editor.view);
    expect(hasAiSuggestion(editor.view)).toBe(false);

    editor.dispose();
  });

  it("does not re-query immediately after accepting a suggestion", async () => {
    const fetchCompletion = vi.fn().mockResolvedValue("CT");
    const editor = createEditor(fetchCompletion);

    typeText(editor.view, "E");
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(fetchCompletion).toHaveBeenCalledTimes(1);

    acceptAiSuggestion(editor.view);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(fetchCompletion).toHaveBeenCalledTimes(1);

    editor.dispose();
  });

  it("queries immediately on requestAiSuggestion", async () => {
    const fetchCompletion = vi.fn().mockResolvedValue("ECT");
    const editor = createEditor(fetchCompletion);

    requestAiSuggestion(editor.view);
    await flushAsync();

    expect(fetchCompletion).toHaveBeenCalledTimes(1);
    expect(hasAiSuggestion(editor.view)).toBe(true);

    editor.dispose();
  });

  it("does not suggest when the cursor precedes a word character", async () => {
    const fetchCompletion = vi.fn().mockResolvedValue("id");
    const editor = createEditor(fetchCompletion, {
      doc: "SELECT id FROM t",
      anchor: 7,
    });

    requestAiSuggestion(editor.view);
    await flushAsync();

    expect(fetchCompletion).not.toHaveBeenCalled();
    expect(hasAiSuggestion(editor.view)).toBe(false);

    editor.dispose();
  });

  it("never queries or accepts in read-only editors", async () => {
    const fetchCompletion = vi.fn().mockResolvedValue("ECT");
    const editor = createEditor(fetchCompletion, { readOnly: true });

    requestAiSuggestion(editor.view);
    await flushAsync();

    expect(fetchCompletion).not.toHaveBeenCalled();
    expect(acceptAiSuggestion(editor.view)).toBe(false);

    editor.dispose();
  });

  it("cancels pending work when the view is destroyed", async () => {
    const fetchCompletion = vi.fn().mockResolvedValue("ECT");
    const editor = createEditor(fetchCompletion);

    typeText(editor.view, "E");
    editor.dispose();

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(fetchCompletion).not.toHaveBeenCalled();
  });
});
