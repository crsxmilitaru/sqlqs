import { invoke } from "@tauri-apps/api/core";
import { vi } from "vitest";

export const invokeMock = vi.mocked(invoke);

export function setInvokeHandler(
  implementation: (command: string, args?: Record<string, unknown>) => unknown,
) {
  invokeMock.mockImplementation(
    ((command: string, args?: Record<string, unknown>) =>
      Promise.resolve(implementation(command, args))) as typeof invoke,
  );
}

export function resetInvokeMock() {
  invokeMock.mockReset();
  invokeMock.mockImplementation(((command: string) => {
    throw new Error(`Unexpected Tauri command: ${command}`);
  }) as typeof invoke);
}
