import { beforeEach, describe, expect, it, vi } from "vitest";
import { invokeMock, setInvokeHandler } from "../test/tauri";
import { startTaskbarOperation } from "./taskbar";

function taskbarStates() {
  return invokeMock.mock.calls
    .filter(([command]) => command === "set_taskbar_progress")
    .map(([, args]) => (args as { state: string }).state);
}

describe("taskbar operations", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setInvokeHandler((command) => {
      if (command === "set_taskbar_progress") return undefined;
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
  });

  it("keeps progress active until every operation completes", () => {
    const first = startTaskbarOperation();
    const second = startTaskbarOperation();

    first.complete();
    second.complete();
    second.complete();

    expect(taskbarStates()).toEqual([
      "indeterminate",
      "indeterminate",
      "none",
    ]);
  });

  it("shows failures before resetting the taskbar", () => {
    const operation = startTaskbarOperation();

    operation.fail();

    expect(taskbarStates()).toEqual(["indeterminate", "error"]);

    vi.advanceTimersByTime(3000);

    expect(taskbarStates()).toEqual(["indeterminate", "error", "none"]);
  });
});
