import { invoke } from "@tauri-apps/api/core";

type TaskbarState = "indeterminate" | "error" | "none";

export interface TaskbarOperation {
  complete: () => void;
  fail: () => void;
}

let nextOperationId = 0;
const activeOperations = new Set<number>();
let errorResetTimer: ReturnType<typeof setTimeout> | undefined;

function setTaskbarState(state: TaskbarState) {
  void invoke("set_taskbar_progress", {
    progress: state === "error" ? 100 : 0,
    total: 100,
    state,
  }).catch(() => undefined);
}

function clearErrorResetTimer() {
  if (errorResetTimer === undefined) return;
  clearTimeout(errorResetTimer);
  errorResetTimer = undefined;
}

function scheduleErrorReset() {
  clearErrorResetTimer();
  errorResetTimer = setTimeout(() => {
    errorResetTimer = undefined;
    if (activeOperations.size === 0) {
      setTaskbarState("none");
    }
  }, 3000);
}

export function startTaskbarOperation(): TaskbarOperation {
  const operationId = ++nextOperationId;
  activeOperations.add(operationId);
  if (activeOperations.size === 1) {
    clearErrorResetTimer();
    setTaskbarState("indeterminate");
  }

  let settled = false;
  const finish = (failed: boolean) => {
    if (settled) return;
    settled = true;
    activeOperations.delete(operationId);

    if (failed) {
      setTaskbarState("error");
      if (activeOperations.size === 0) {
        scheduleErrorReset();
      } else {
        clearErrorResetTimer();
      }
      return;
    }

    if (activeOperations.size > 0) {
      clearErrorResetTimer();
      setTaskbarState("indeterminate");
      return;
    }

    clearErrorResetTimer();
    setTaskbarState("none");
  };

  return {
    complete: () => finish(false),
    fail: () => finish(true),
  };
}
