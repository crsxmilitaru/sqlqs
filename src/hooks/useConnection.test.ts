import { renderHook, waitFor } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it } from "vitest";
import { saveAutoConnectStartup } from "../lib/settings";
import { invokeMock, setInvokeHandler } from "../test/tauri";
import { useConnection } from "./useConnection";

describe("useConnection", () => {
  beforeEach(() => {
    saveAutoConnectStartup(false);
    setInvokeHandler((command) => {
      if (command === "load_connections") {
        return { connections: [], auto_connect_startup: false };
      }
      if (command === "get_databases") return ["master", "app"];
      if (command === "change_database") return undefined;
      if (command === "disconnect_from_server") return undefined;
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
  });

  it("connects, loads databases, and stores the selected database", async () => {
    const { result } = renderHook(useConnection);
    await waitFor(() => expect(result.isInitializing()).toBe(false));

    result.connect({
      server: "localhost",
      database: "app",
      use_windows_auth: true,
      encrypt: false,
      trust_server_certificate: true,
    });

    await waitFor(() => expect(result.databases()).toEqual(["master", "app"]));
    expect(result.connected()).toBe(true);
    expect(result.serverName()).toBe("localhost");
    expect(result.connectionKey()).toBe("localhost#win");
    expect(result.currentDatabase()).toBe("app");
    expect(localStorage.getItem("sqlqs_last_database")).toBe("app");
  });

  it("changes databases through the native boundary", async () => {
    const { result } = renderHook(useConnection);
    await waitFor(() => expect(result.isInitializing()).toBe(false));

    await expect(result.changeDatabase("master")).resolves.toBe(true);

    expect(invokeMock).toHaveBeenCalledWith("change_database", {
      database: "master",
    });
    expect(result.currentDatabase()).toBe("master");
  });

  it("disconnects and clears all connection state", async () => {
    const { result } = renderHook(useConnection);
    await waitFor(() => expect(result.isInitializing()).toBe(false));
    result.connect({
      server: "localhost",
      database: "app",
      use_windows_auth: true,
      encrypt: false,
      trust_server_certificate: true,
    });
    await waitFor(() => expect(result.connected()).toBe(true));

    await result.disconnect();

    expect(invokeMock).toHaveBeenCalledWith("disconnect_from_server");
    expect(result.connected()).toBe(false);
    expect(result.serverName()).toBe("");
    expect(result.connectionKey()).toBe("");
    expect(result.currentDatabase()).toBeUndefined();
    expect(result.databases()).toEqual([]);
  });

  it("restores an available database after connecting", async () => {
    localStorage.setItem("sqlqs_last_database", "app");
    const { result } = renderHook(useConnection);
    await waitFor(() => expect(result.isInitializing()).toBe(false));

    result.connect({
      server: "localhost",
      use_windows_auth: true,
      encrypt: false,
      trust_server_certificate: true,
    });

    await waitFor(() => expect(result.currentDatabase()).toBe("app"));
    expect(invokeMock).toHaveBeenCalledWith("change_database", {
      database: "app",
    });
  });
});
