import { createSignal, onMount } from "solid-js";
import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
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

export function useAppUpdater() {
  const [appVersion, setAppVersion] = createSignal<string | null>(null);
  const [updateStatus, setUpdateStatus] = createSignal<UpdateStatus>({
    checking: false,
    message: null,
    tone: "info",
  });
  const [updateAvailable, setUpdateAvailable] = createSignal<Update | null>(null);
  let isChecking = false;

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
      (normalized.includes("signature") && normalized.includes("could not be decoded"))
    ) {
      return {
        message: INVALID_UPDATER_SIGNATURE_MESSAGE,
        configurationIssue: true,
        tone: "error",
      };
    }

    if (normalized.includes("could not fetch a valid release json from the remote")) {
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

  const checkForUpdates = async (manual: boolean): Promise<UpdateCheckResult> => {
    if (isChecking) {
      return "skipped";
    }

    isChecking = true;
    setUpdateStatus({
      checking: true,
      message: manual ? "Checking for updates..." : null,
      tone: "info",
    });

    try {
      const update = await check();
      if (!update) {
        setUpdateStatus({
          checking: false,
          message: manual ? "You are running the latest version." : null,
          tone: "success",
        });
        return "up-to-date";
      }

      setUpdateAvailable(update);
      setUpdateStatus({
        checking: false,
        message: `Update ${update.version} is available.`,
        tone: "info",
      });
      return "update-available";
    } catch (error) {
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
    setUpdateAvailable(null);
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
    setUpdateAvailable(null);
    setUpdateStatus({
      checking: false,
      message: `Update ${update.version} is available.`,
      tone: "info",
    });
  };

  return {
    appVersion,
    updateStatus,
    updateAvailable,
    checkForUpdates,
    installUpdate,
    cancelUpdate,
  };
}
