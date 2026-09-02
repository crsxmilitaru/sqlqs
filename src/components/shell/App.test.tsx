import { fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { setInvokeHandler } from "../../test/tauri";
import App from "./App";

vi.mock("../../hooks/useAppUpdater", () => ({
  useAppUpdater: () => {
    const [updateDialogVisible, setUpdateDialogVisible] = createSignal(false);
    return {
      appVersion: () => "0.5.0-preview",
      updateStatus: () => ({ checking: false, message: null, tone: "neutral" }),
      updateAvailable: () => null,
      updateAvailableChannel: () => null,
      updateDialogVisible,
      setUpdateDialogVisible,
      checkForUpdates: vi.fn(),
      installUpdate: vi.fn(),
      cancelUpdate: vi.fn(),
    };
  },
}));

vi.mock("./TitleBar", () => ({
  default: (props: { onConnect: () => void; onShowSettings: () => void }) => (
    <div>
      <button onClick={props.onConnect}>Connect Server</button>
      <button onClick={props.onShowSettings}>Settings</button>
    </div>
  ),
}));

vi.mock("../editor/QueryEditorPanel", () => ({
  default: () => <div>Query workspace</div>,
}));

vi.mock("../explorer/ObjectExplorer", () => ({
  default: () => <div>Object explorer</div>,
}));

vi.mock("../dialogs/ConnectionDialog", () => ({
  default: () => <div role="dialog" aria-label="Connection dialog" />,
}));

vi.mock("../settings/SettingsView", () => ({
  default: () => <div role="dialog" aria-label="Settings dialog" />,
}));

describe("App", () => {
  it("opens primary application dialogs", () => {
    setInvokeHandler((command) => {
      if (command === "load_connections") {
        return { connections: [], auto_connect_startup: false };
      }
      if (command === "list_conversations") return [];
      if (command === "load_api_key") return null;
      if (command === "get_startup_sql_file_path") return null;
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
    render(() => <App />);

    expect(screen.getByText("Query workspace")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Connect Server" }));
    expect(
      screen.getByRole("dialog", { name: "Connection dialog" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(
      screen.getByRole("dialog", { name: "Settings dialog" }),
    ).toBeInTheDocument();
  });
});
