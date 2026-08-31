import { renderHook } from "@solidjs/testing-library";
import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppUpdater } from "./useAppUpdater";
import { invokeMock, setInvokeHandler } from "../test/tauri";
import { saveUpdateChannel } from "../lib/settings";

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn().mockResolvedValue("1.2.3"),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  Update: class {
    version: string;
    downloadAndInstall = vi.fn().mockResolvedValue(undefined);
    constructor(options: { version: string }) {
      this.version = options.version;
    }
  },
}));

const getVersionMock = vi.mocked(getVersion);
const relaunchMock = vi.mocked(relaunch);

function renderUpdater() {
  return renderHook(() => useAppUpdater());
}

function channelMetadata(version: string) {
  return {
    rid: 1,
    currentVersion: "1.0.0",
    version,
    date: "2026-01-01T00:00:00Z",
    body: "Release notes",
    rawJson: {},
  };
}

describe("useAppUpdater", () => {
  beforeEach(() => {
    saveUpdateChannel("stable");
  });

  it("loads the app version on mount", async () => {
    getVersionMock.mockResolvedValue("0.5.0");
    const { result } = renderUpdater();
    await vi.waitFor(() => {
      expect(result.appVersion()).toBe("0.5.0");
    });
  });

  it("tolerates version loading failures", async () => {
    getVersionMock.mockRejectedValue(new Error("no version"));
    const { result } = renderUpdater();
    await vi.waitFor(() => {
      expect(result.appVersion()).toBeNull();
    });
    expect(result.updateStatus().checking).toBe(false);
  });

  it("reports up-to-date when the channel returns no metadata", async () => {
    setInvokeHandler((command) => {
      if (command === "check_update_channel") return null;
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
    const { result } = renderUpdater();

    const outcome = await result.checkForUpdates(true);

    expect(outcome).toBe("up-to-date");
    expect(invokeMock).toHaveBeenCalledWith("check_update_channel", {
      channel: "stable",
    });
    expect(result.updateStatus().message).toBe(
      "You are running the latest Stable version.",
    );
    expect(result.updateStatus().tone).toBe("success");
    expect(result.updateAvailable()).toBeNull();
    expect(result.updateDialogVisible()).toBe(false);
  });

  it("exposes an available update and opens the dialog", async () => {
    setInvokeHandler((command) => {
      if (command === "check_update_channel") {
        return channelMetadata("1.1.0");
      }
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
    const { result } = renderUpdater();

    const outcome = await result.checkForUpdates(true);

    expect(outcome).toBe("update-available");
    expect(result.updateAvailable()?.version).toBe("1.1.0");
    expect(result.updateAvailableChannel()).toBe("stable");
    expect(result.updateDialogVisible()).toBe(true);
    expect(result.updateStatus().message).toBe(
      "Version 1.1.0 is ready to install.",
    );
  });

  it("uses preview wording for the preview channel", async () => {
    saveUpdateChannel("preview");
    setInvokeHandler((command) => {
      if (command === "check_update_channel") {
        return channelMetadata("2.0.0-preview.1");
      }
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
    const { result } = renderUpdater();

    const outcome = await result.checkForUpdates(true);

    expect(outcome).toBe("update-available");
    expect(result.updateStatus().checking).toBe(false);
    expect(result.updateStatus().message).toBe(
      "A new preview build is ready to install.",
    );
    expect(invokeMock).toHaveBeenCalledWith("check_update_channel", {
      channel: "preview",
    });
  });

  it("skips concurrent checks while one is in flight", async () => {
    let release: (() => void) | undefined;
    setInvokeHandler((command) => {
      if (command === "check_update_channel") {
        return new Promise((resolve) => {
          release = () => resolve(null);
        }) as unknown as null;
      }
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
    const { result } = renderUpdater();

    const first = result.checkForUpdates(true);
    const second = await result.checkForUpdates(true);

    expect(second).toBe("skipped");
    release?.();
    await expect(first).resolves.toBe("up-to-date");
  });

  it("classifies missing updater configuration", async () => {
    setInvokeHandler(() => {
      throw undefined;
    });
    invokeMock.mockRejectedValueOnce(
      new Error("Updater does not have any endpoints set"),
    );
    const { result } = renderUpdater();

    const outcome = await result.checkForUpdates(true);

    expect(outcome).toBe("configuration-error");
    expect(result.updateStatus().message).toContain(
      "Updater is not configured yet",
    );
    expect(result.updateStatus().tone).toBe("error");
    expect(result.updateAvailable()).toBeNull();
  });

  it("classifies signature verification failures", async () => {
    invokeMock.mockRejectedValueOnce(
      new Error("signature could not be decoded from string"),
    );
    const { result } = renderUpdater();

    const outcome = await result.checkForUpdates(true);

    expect(outcome).toBe("configuration-error");
    expect(result.updateStatus().message).toContain("signature verification");
  });

  it("classifies missing release metadata as informational", async () => {
    invokeMock.mockRejectedValueOnce(
      new Error("Could not fetch a valid release JSON from the remote"),
    );
    const { result } = renderUpdater();

    const outcome = await result.checkForUpdates(false);

    expect(outcome).toBe("error");
    expect(result.updateStatus().message).toBe(
      "No published update metadata found yet.",
    );
    expect(result.updateStatus().tone).toBe("info");
  });

  it("hides configuration errors during automatic checks", async () => {
    invokeMock.mockRejectedValueOnce(
      new Error("public key mismatch detected"),
    );
    const { result } = renderUpdater();

    const outcome = await result.checkForUpdates(false);

    expect(outcome).toBe("configuration-error");
    expect(result.updateStatus().message).toBeNull();
    expect(result.updateStatus().tone).toBe("info");
  });

  it("surfaces generic check failures", async () => {
    invokeMock.mockRejectedValueOnce(new Error("network unreachable"));
    const { result } = renderUpdater();

    const outcome = await result.checkForUpdates(true);

    expect(outcome).toBe("error");
    expect(result.updateStatus().message).toBe(
      "Update check failed: Error: network unreachable",
    );
  });

  it("downloads, installs, and relaunches", async () => {
    setInvokeHandler((command) => {
      if (command === "check_update_channel") {
        return channelMetadata("1.1.0");
      }
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
    const { result } = renderUpdater();
    await result.checkForUpdates(true);
    const update = result.updateAvailable()!;

    await result.installUpdate(update);

    expect(update.downloadAndInstall).toHaveBeenCalledOnce();
    expect(relaunchMock).toHaveBeenCalledOnce();
    expect(result.updateDialogVisible()).toBe(false);
    expect(result.updateAvailable()).toBeNull();
    expect(result.updateStatus().tone).toBe("success");
    expect(result.updateStatus().message).toContain("Restarting");
  });

  it("falls back to a manual restart prompt when relaunch fails", async () => {
    setInvokeHandler((command) => {
      if (command === "check_update_channel") {
        return channelMetadata("1.1.0");
      }
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
    relaunchMock.mockRejectedValue(new Error("relaunch denied"));
    const { result } = renderUpdater();
    await result.checkForUpdates(true);

    await result.installUpdate(result.updateAvailable()!);

    expect(result.updateStatus().checking).toBe(false);
    expect(result.updateStatus().message).toContain("restart the app manually");
    expect(result.updateStatus().tone).toBe("success");
  });

  it("reports installation failures", async () => {
    setInvokeHandler((command) => {
      if (command === "check_update_channel") {
        return channelMetadata("1.1.0");
      }
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
    const { result } = renderUpdater();
    await result.checkForUpdates(true);
    const update = result.updateAvailable()!;
    update.downloadAndInstall = vi
      .fn()
      .mockRejectedValue(new Error("download interrupted"));

    await result.installUpdate(update);

    expect(relaunchMock).not.toHaveBeenCalled();
    expect(result.updateStatus().checking).toBe(false);
    expect(result.updateStatus().message).toContain("download interrupted");
    expect(result.updateStatus().tone).toBe("error");
  });

  it("cancel keeps the update available without the dialog", async () => {
    setInvokeHandler((command) => {
      if (command === "check_update_channel") {
        return channelMetadata("1.1.0");
      }
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
    const { result } = renderUpdater();
    await result.checkForUpdates(true);

    result.cancelUpdate(result.updateAvailable()!);

    expect(result.updateDialogVisible()).toBe(false);
    expect(result.updateAvailable()?.version).toBe("1.1.0");
    expect(result.updateStatus().message).toBe(
      "Version 1.1.0 is ready to install.",
    );
  });

  it("discards a pending update when the channel switches", async () => {
    setInvokeHandler((command) => {
      if (command === "check_update_channel") {
        return channelMetadata("1.1.0");
      }
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
    const { result } = renderUpdater();
    await result.checkForUpdates(true);
    expect(result.updateAvailable()).not.toBeNull();

    saveUpdateChannel("preview");
    await vi.waitFor(() => {
      expect(result.updateAvailable()).toBeNull();
    });
    expect(result.updateAvailableChannel()).toBeNull();
    expect(result.updateDialogVisible()).toBe(false);
    expect(result.updateStatus().message).toBeNull();
  });
});
