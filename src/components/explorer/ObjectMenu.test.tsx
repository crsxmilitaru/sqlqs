import { describe, expect, it, vi } from "vitest";
import { invokeMock, setInvokeHandler } from "../../test/tauri";
import { buildObjectExplorerMenuItems } from "./ObjectMenu";

function menuProps() {
  return {
    database: "app",
    schema: "dbo",
    table: "Users",
    objectType: "TABLE" as const,
    onSelectSql: vi.fn(),
    onShowProperties: vi.fn(),
    onShowCompareData: vi.fn(),
    onShowRename: vi.fn(),
    onShowDrop: vi.fn(),
    onShowDependencies: vi.fn(),
  };
}

describe("ObjectMenu", () => {
  it("builds table actions and dispatches local callbacks", () => {
    const props = menuProps();
    const items = buildObjectExplorerMenuItems(props);

    items.find((item) => item.id === "compare-data")?.onClick?.();
    items.find((item) => item.id === "rename")?.onClick?.();
    items.find((item) => item.id === "drop")?.onClick?.();

    expect(props.onShowCompareData).toHaveBeenCalledOnce();
    expect(props.onShowRename).toHaveBeenCalledOnce();
    expect(props.onShowDrop).toHaveBeenCalledOnce();
  });

  it("requests generated SQL for procedure execution", async () => {
    const onSelectSql = vi.fn();
    setInvokeHandler((command) => {
      if (command === "generate_object_script") return { sql: "EXEC dbo.Sync" };
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
    const items = buildObjectExplorerMenuItems({
      ...menuProps(),
      table: "Sync",
      objectType: "PROCEDURE",
      onSelectSql,
    });

    await items.find((item) => item.id === "exec")?.onClick?.();

    expect(invokeMock).toHaveBeenCalledWith("generate_object_script", {
      database: "app",
      schema: "dbo",
      name: "Sync",
      objectType: "PROCEDURE",
      action: "exec",
    });
    expect(onSelectSql).toHaveBeenCalledWith("EXEC dbo.Sync", true);
  });
});
