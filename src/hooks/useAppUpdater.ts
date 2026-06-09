import { createEffect, createSignal, onMount } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { Update } from "@tauri-apps/plugin-updater";
import { loadUpdateChannel, type UpdateChannel } from "../lib/settings";
import type { UpdateMessageTone } from "../lib/types";

interface UpdateStatus {
  checking: boolean;
  message: string | null;
  tone: UpdateMessageTone;
}

interface UpdaterErrorDetails {
  message: string;
  configurationIssue: boolean;
  tone: UpdateMessageTone;
}

interface UpdateMetadata {
  rid: number;
  currentVersion: string;
  version: string;
  date?: string;
  body?: string;
  rawJson: Record<string, unknown>;
}

export type UpdateCheckResult =
  | "update-available"
  | "up-to-date"
  | "configuration-error"
  | "error"
  | "skipped";

const MISSING_UPDATER_CONFIG_MESSAGE =
  "Updater is not configured yet. Set plugins.updater.endpoints and plugins.updater.pubkey in src-tauri/tauri.conf.json.";
const INVALID_UPDATER_SIGNATURE_MESSAGE =
  "Updater signature verification failed. Ensure releases are signed with the private key matching plugins.updater.pubkey.";
const NO_RELEASE_METADATA_MESSAGE = "No published update metadata found yet.";

const UPDATE_CHANNEL_LABELS = {
  stable: "Stable",
  preview: "Preview",
} as const;

function updateAvailableMessage(channel: UpdateChannel, update: Update) {
  if (channel === "preview") {
    return "A new preview build is ready to install.";
  }

  return `Version ${update.version} is ready to install.`;
}

export function useAppUpdater() {
  const [appVersion, setAppVersion] = createSignal<string | null>(null);
  const [updateStatus, setUpdateStatus] = createSignal<UpdateStatus>({
    checking: false,
    message: null,
    tone: "info",
  });
  const [updateAvailable, setUpdateAvailable] = createSignal<Update | null>(
    null,
  );
  const [updateAvailableChannel, setUpdateAvailableChannel] =
    createSignal<UpdateChannel | null>(null);
  const [updateDialogVisible, setUpdateDialogVisible] = createSignal(false);
  let isChecking = false;

  createEffect(() => {
    const selectedChannel = loadUpdateChannel();
    const pendingChannel = updateAvailableChannel();

    if (pendingChannel && pendingChannel !== selectedChannel) {
      setUpdateAvailable(null);
      setUpdateAvailableChannel(null);
      setUpdateDialogVisible(false);
      setUpdateStatus({
        checking: false,
        message: null,
        tone: "info",
      });
    }
  });

  onMount(async () => {
    try {
      setAppVersion(await getVersion());
    } catch {
      setAppVersion(null);
    }
  });

  const formatUpdaterError = (error: unknown): UpdaterErrorDetails => {
    const message = String(error);
    const normalized = message.toLowerCase();

    if (normalized.includes("updater does not have any endpoints set")) {
      return {
        message: MISSING_UPDATER_CONFIG_MESSAGE,
        configurationIssue: true,
        tone: "error",
      };
    }

    if (
      normalized.includes("public key") ||
      normalized.includes("pubkey") ||
      (normalized.includes("signature") &&
        normalized.includes("could not be decoded"))
    ) {
      return {
        message: INVALID_UPDATER_SIGNATURE_MESSAGE,
        configurationIssue: true,
        tone: "error",
      };
    }

    if (
      normalized.includes("could not fetch a valid release json from the remote",) ||
      normalized.includes("release not found") ||
      normalized.includes("no published preview release metadata")
    ) {
      return {
        message: NO_RELEASE_METADATA_MESSAGE,
        configurationIssue: false,
        tone: "info",
      };
    }

    return {
      message: `Update check failed: ${message}`,
      configurationIssue: false,
      tone: "error",
    };
  };

  const checkForUpdates = async (
    manual: boolean,
  ): Promise<UpdateCheckResult> => {
    if (isChecking) {
      return "skipped";
    }

    isChecking = true;
    const channel = loadUpdateChannel();
    const channelLabel = UPDATE_CHANNEL_LABELS[channel];
    setUpdateStatus({
      checking: true,
      message: manual ? `Checking ${channelLabel} updates...` : null,
      tone: "info",
    });

    try {
      const metadata = await invoke<UpdateMetadata | null>(
        "check_update_channel",
        {
          channel,
        },
      );
      const update = metadata
        ? new Update(metadata as ConstructorParameters<typeof Update>[0])
        : null;
      if (!update) {
        setUpdateAvailable(null);
        setUpdateAvailableChannel(null);
        setUpdateDialogVisible(false);
        setUpdateStatus({
          checking: false,
          message: manual
            ? `You are running the latest ${channelLabel} version.`
            : null,
          tone: "success",
        });
        return "up-to-date";
      }

      setUpdateAvailable(update);
      setUpdateAvailableChannel(channel);
      setUpdateDialogVisible(true);
      setUpdateStatus({
        checking: false,
        message: updateAvailableMessage(channel, update),
        tone: "info",
      });
      return "update-available";
    } catch (error) {
      setUpdateAvailable(null);
      setUpdateAvailableChannel(null);
      setUpdateDialogVisible(false);
      const { message, configurationIssue, tone } = formatUpdaterError(error);
      const shouldHideMessage = !manual && configurationIssue;
      setUpdateStatus({
        checking: false,
        message: shouldHideMessage ? null : message,
        tone: shouldHideMessage ? "info" : tone,
      });
      return configurationIssue ? "configuration-error" : "error";
    } finally {
      isChecking = false;
    }
  };

  const installUpdate = async (update: Update) => {
    setUpdateDialogVisible(false);
    setUpdateAvailable(null);
    setUpdateAvailableChannel(null);
    setUpdateStatus({
      checking: true,
      message: `Downloading and installing ${update.version}...`,
      tone: "info",
    });

    try {
      await update.downloadAndInstall();
      setUpdateStatus({
        checking: true,
        message: `Update ${update.version} installed. Restarting...`,
        tone: "success",
      });

      try {
        await relaunch();
      } catch {
        setUpdateStatus({
          checking: false,
          message: `Update ${update.version} installed. Please restart the app manually.`,
          tone: "success",
        });
      }
    } catch (error) {
      const { message, tone } = formatUpdaterError(error);
      setUpdateStatus({
        checking: false,
        message,
        tone,
      });
    }
  };

  const cancelUpdate = (update: Update) => {
    setUpdateDialogVisible(false);
    const channel = updateAvailableChannel() ?? loadUpdateChannel();
    setUpdateStatus({
      checking: false,
      message: updateAvailableMessage(channel, update),
      tone: "info",
    });
  };

  return {
    appVersion,
    updateStatus,
    updateAvailable,
    updateAvailableChannel,
    updateDialogVisible,
    setUpdateDialogVisible,
    checkForUpdates,
    installUpdate,
    cancelUpdate,
  };
}
