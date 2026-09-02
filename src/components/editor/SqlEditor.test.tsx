import { render, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import SqlEditor, { type SqlEditorHandle } from "./SqlEditor";

describe("SqlEditor", () => {
  it("exposes editor operations and reports document changes", async () => {
    const onChange = vi.fn();
    let handle: SqlEditorHandle | undefined;
    render(() => (
      <SqlEditor
        tabId="tab-1"
        value="SELECT 1"
        onChange={onChange}
        onExecute={vi.fn()}
        theme={{ id: "dark", mode: "dark" }}
        onRef={(value) => {
          handle = value;
        }}
      />
    ));

    expect(handle?.getSelectedText()).toBe("");
    handle?.selectAll();
    handle?.replaceSelection("SELECT 2");

    await waitFor(() => expect(onChange).toHaveBeenCalledWith("SELECT 2", undefined));

    handle?.selectAll();
    handle?.toLowerCase();
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("select 2", undefined));

    handle?.selectAll();
    handle?.toUpperCase();
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("SELECT 2", undefined));

    handle?.selectAll();
    handle?.toggleComment();
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("-- SELECT 2", undefined));
  });

  it("reports text selection changes", async () => {
    const onSelectionChange = vi.fn();
    let handle: SqlEditorHandle | undefined;
    render(() => (
      <SqlEditor
        tabId="tab-1"
        value="SELECT 1"
        onChange={vi.fn()}
        onExecute={vi.fn()}
        onSelectionChange={onSelectionChange}
        theme={{ id: "dark", mode: "dark" }}
        onRef={(value) => {
          handle = value;
        }}
      />
    ));

    handle?.selectAll();
    await waitFor(() => expect(onSelectionChange).toHaveBeenCalledWith(true));
  });

  it("manages undo and redo operations and reports history depth changes", async () => {
    const onChange = vi.fn();
    const onHistoryDepthChange = vi.fn();
    const [value, setValue] = createSignal("SELECT 1");
    let handle: SqlEditorHandle | undefined;
    render(() => (
      <SqlEditor
        tabId="tab-1"
        value={value()}
        onChange={(val, opt) => {
          setValue(val);
          onChange(val, opt);
        }}
        onExecute={vi.fn()}
        onHistoryDepthChange={onHistoryDepthChange}
        theme={{ id: "dark", mode: "dark" }}
        onRef={(value) => {
          handle = value;
        }}
      />
    ));

    expect(handle?.canUndo()).toBe(false);
    expect(handle?.canRedo()).toBe(false);

    handle?.selectAll();
    handle?.replaceSelection("SELECT 2");
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("SELECT 2", undefined));

    await waitFor(() => expect(handle?.canUndo()).toBe(true));
    expect(handle?.canRedo()).toBe(false);

    handle?.undo();
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("SELECT 1", expect.anything()));
    await waitFor(() => expect(handle?.canRedo()).toBe(true));

    handle?.redo();
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("SELECT 2", expect.anything()));
  });
});


