import { render, waitFor } from "@solidjs/testing-library";
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
  });
});
