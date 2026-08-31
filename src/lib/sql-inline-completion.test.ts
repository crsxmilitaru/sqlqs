import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";
import {
  acceptInlineSuggestion,
  clearInlineSuggestion,
  hasInlineSuggestion,
  sqlInlineCompletion,
} from "./sql-inline-completion";

async function flushCompletion() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function createEditor(
  source: Parameters<typeof sqlInlineCompletion>[0]["source"],
  readOnly = false,
) {
  const parent = document.createElement("div");
  document.body.append(parent);
  const state = EditorState.create({
    doc: "SEL",
    selection: { anchor: 3 },
    extensions: [
      EditorState.readOnly.of(readOnly),
      sqlInlineCompletion({ source }),
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

describe("SQL inline completion", () => {
  it("renders and accepts the remainder of a completion", async () => {
    const source = vi.fn(() => ({
      from: 0,
      options: [{ label: "SELECT" }],
    }));
    const editor = createEditor(source);

    await flushCompletion();

    expect(hasInlineSuggestion(editor.view)).toBe(true);
    expect(document.querySelector(".cm-sql-ghost")).toHaveTextContent("ECT");
    expect(acceptInlineSuggestion(editor.view)).toBe(true);
    expect(editor.view.state.doc.toString()).toBe("SELECT");
    expect(hasInlineSuggestion(editor.view)).toBe(false);

    editor.dispose();
  });

  it("clears an active suggestion without changing the document", async () => {
    const editor = createEditor(() => ({
      from: 0,
      options: [{ label: "SELECT" }],
    }));

    await flushCompletion();
    clearInlineSuggestion(editor.view);

    expect(hasInlineSuggestion(editor.view)).toBe(false);
    expect(editor.view.state.doc.toString()).toBe("SEL");

    editor.dispose();
  });

  it("ignores functional completions and read-only editors", async () => {
    const functional = createEditor(() => ({
      from: 0,
      options: [{ label: "SELECT", apply: () => undefined }],
    }));
    const readOnlySource = vi.fn(() => ({
      from: 0,
      options: [{ label: "SELECT" }],
    }));
    const readOnly = createEditor(readOnlySource, true);

    await flushCompletion();

    expect(hasInlineSuggestion(functional.view)).toBe(false);
    expect(hasInlineSuggestion(readOnly.view)).toBe(false);
    expect(readOnlySource).not.toHaveBeenCalled();
    expect(acceptInlineSuggestion(readOnly.view)).toBe(false);

    functional.dispose();
    readOnly.dispose();
  });
});
