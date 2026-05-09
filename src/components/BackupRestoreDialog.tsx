import { invoke } from "@tauri-apps/api/core";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type {
  BackupDefaults,
  BackupFileInfo,
  BackupOperationResult,
  BackupScheduleFrequency,
  BackupScheduleInfo,
  BackupType,
  RestoreFileMove,
} from "../lib/types";
import Dropdown from "./Dropdown";
import Input from "./Input";
import Tooltip from "./Tooltip";

interface Props {
  databases: string[];
  currentDatabase?: string;
  initialDatabase?: string;
  onClose: () => void;
  onRefreshDatabases?: () => void;
}

type TabId = "backup" | "restore" | "schedules";

const WEEKDAYS = [
  { label: "Sun", value: 1 },
  { label: "Mon", value: 2 },
  { label: "Tue", value: 4 },
  { label: "Wed", value: 8 },
  { label: "Thu", value: 16 },
  { label: "Fri", value: 32 },
  { label: "Sat", value: 64 },
];

function cleanError(err: unknown, fallback: string): string {
  return String(err ?? fallback)
    .replace(/^Error:\s*/i, "")
    .replace(/^(Backup|Restore|Schedule creation|Schedule deletion) failed:\s*/i, "");
}

function backupTypeLabel(type: BackupType): string {
  if (type === "differential") return "Differential";
  if (type === "log") return "Transaction Log";
  return "Full";
}

function extensionForBackup(type: BackupType): string {
  return type === "log" ? "trn" : "bak";
}

function sanitizeFilePart(value: string): string {
  return value.replace(/[<>:"/\\|?*\s]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "") || "database";
}

function joinServerPath(folder: string, fileName: string): string {
  const trimmed = folder.trim();
  if (!trimmed) return fileName;
  const separator = trimmed.includes("/") && !trimmed.includes("\\") ? "/" : "\\";
  return `${trimmed.replace(/[\\/]$/, "")}${separator}${fileName}`;
}

function todayStamp(): string {
  const now = new Date();
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const time = `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  return `${date}_${time}`;
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "Unknown";
  const mb = bytes / 1024 / 1024;
  return `${mb.toLocaleString(undefined, { maximumFractionDigits: 1 })} MB`;
}

function makeRestorePath(defaults: BackupDefaults | null, targetDb: string, file: BackupFileInfo, index: number): string {
  const isLog = file.file_type.toUpperCase() === "L";
  const folder = (isLog ? defaults?.log_directory : defaults?.data_directory) || "";
  const extension = isLog ? "ldf" : index === 0 ? "mdf" : "ndf";
  const name = `${sanitizeFilePart(targetDb || "RestoredDatabase")}_${sanitizeFilePart(file.logical_name)}.${extension}`;
  return folder ? joinServerPath(folder, name) : file.physical_name;
}

export default function BackupRestoreDialog(props: Props) {
  const preferredDatabase = () => props.initialDatabase || props.currentDatabase || props.databases[0] || "";

  const [visible, setVisible] = createSignal(false);
  const [activeTab, setActiveTab] = createSignal<TabId>("backup");
  const [defaults, setDefaults] = createSignal<BackupDefaults | null>(null);
  const [loadingDefaults, setLoadingDefaults] = createSignal(true);
  const [busyAction, setBusyAction] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [success, setSuccess] = createSignal<string | null>(null);

  const [backupDatabase, setBackupDatabase] = createSignal(preferredDatabase());
  const [backupType, setBackupType] = createSignal<BackupType>("full");
  const [destinationPath, setDestinationPath] = createSignal("");
  const [destinationTouched, setDestinationTouched] = createSignal(false);
  const [overwrite, setOverwrite] = createSignal(true);
  const [copyOnly, setCopyOnly] = createSignal(false);
  const [compression, setCompression] = createSignal(false);
  const [checksum, setChecksum] = createSignal(true);

  const [sourcePath, setSourcePath] = createSignal("");
  const [inspectedSourcePath, setInspectedSourcePath] = createSignal("");
  const [targetDatabase, setTargetDatabase] = createSignal("");
  const [backupFiles, setBackupFiles] = createSignal<BackupFileInfo[]>([]);
  const [fileMoves, setFileMoves] = createSignal<RestoreFileMove[]>([]);
  const [replaceExisting, setReplaceExisting] = createSignal(false);
  const [recovery, setRecovery] = createSignal(true);
  const [restrictedUser, setRestrictedUser] = createSignal(false);

  const [scheduleJobName, setScheduleJobName] = createSignal("");
  const [scheduleFolder, setScheduleFolder] = createSignal("");
  const [scheduleFrequency, setScheduleFrequency] = createSignal<BackupScheduleFrequency>("daily");
  const [scheduleTime, setScheduleTime] = createSignal("23:00");
  const [weeklyDays, setWeeklyDays] = createSignal<number[]>([2, 4, 8, 16, 32]);
  const [monthlyDay, setMonthlyDay] = createSignal(1);
  const [schedules, setSchedules] = createSignal<BackupScheduleInfo[]>([]);
  const [schedulesLoading, setSchedulesLoading] = createSignal(false);
  const [scheduleError, setScheduleError] = createSignal<string | null>(null);

  const databaseOptions = createMemo(() => props.databases.map((db) => ({ value: db, label: db })));
  const backupTypeOptions = [
    { value: "full", label: "Full" },
    { value: "differential", label: "Differential" },
    { value: "log", label: "Transaction Log" },
  ];
  const frequencyOptions = [
    { value: "daily", label: "Daily" },
    { value: "weekly", label: "Weekly" },
    { value: "monthly", label: "Monthly" },
  ];
  const busy = () => busyAction() !== null;

  onMount(() => {
    requestAnimationFrame(() => setVisible(true));

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy()) {
        props.onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown));

    void loadDefaults();
    void loadSchedules();
  });

  createEffect(() => {
    const fallback = preferredDatabase();
    if (!backupDatabase() && fallback) {
      setBackupDatabase(fallback);
    }
  });

  createEffect(() => {
    if (destinationTouched()) return;
    const db = backupDatabase();
    const folder = defaults()?.backup_directory || "";
    if (!db || !folder) return;
    const fileName = `${sanitizeFilePart(db)}_${backupType()}_${todayStamp()}.${extensionForBackup(backupType())}`;
    setDestinationPath(joinServerPath(folder, fileName));
  });

  createEffect(() => {
    if (backupType() === "differential" && copyOnly()) {
      setCopyOnly(false);
    }
  });

  createEffect(() => {
    const folder = defaults()?.backup_directory;
    if (folder && !scheduleFolder()) {
      setScheduleFolder(folder);
    }
  });

  createEffect(() => {
    if (backupDatabase()) {
      setScheduleJobName(backupDatabase());
    }
  });

  async function loadDefaults() {
    setLoadingDefaults(true);
    try {
      const value = await invoke<BackupDefaults>("get_backup_defaults");
      setDefaults(value);
    } catch (err) {
      setError(cleanError(err, "Failed to load SQL Server default folders"));
    } finally {
      setLoadingDefaults(false);
    }
  }

  async function loadSchedules() {
    setSchedulesLoading(true);
    setScheduleError(null);
    try {
      setSchedules(await invoke<BackupScheduleInfo[]>("list_backup_schedules"));
    } catch (err) {
      setSchedules([]);
      setScheduleError(cleanError(err, "Failed to load backup schedules"));
    } finally {
      setSchedulesLoading(false);
    }
  }

  async function runBackup() {
    setBusyAction("backup");
    setError(null);
    setSuccess(null);
    try {
      const result = await invoke<BackupOperationResult>("backup_database", {
        request: {
          database: backupDatabase(),
          destination_path: destinationPath(),
          backup_type: backupType(),
          overwrite: overwrite(),
          copy_only: copyOnly(),
          compression: compression(),
          checksum: checksum(),
        },
      });
      setSuccess(`${result.message} ${result.elapsed_ms} ms`);
    } catch (err) {
      setError(cleanError(err, "Backup failed"));
    } finally {
      setBusyAction(null);
    }
  }

  function handleSourcePathChange(value: string) {
    setSourcePath(value);
    if (inspectedSourcePath() && value !== inspectedSourcePath()) {
      setInspectedSourcePath("");
      setBackupFiles([]);
      setFileMoves([]);
    }
  }

  async function inspectBackup() {
    setBusyAction("inspect");
    setError(null);
    setSuccess(null);
    try {
      const inspectedPath = sourcePath().trim();
      const files = await invoke<BackupFileInfo[]>("inspect_backup_file", { sourcePath: inspectedPath });
      if (files.length === 0) {
        throw new Error("No files were found in this backup.");
      }
      setBackupFiles(files);
      setInspectedSourcePath(inspectedPath);
      const firstDataFile = files.find((file) => file.file_type.toUpperCase() !== "L");
      const nextTargetDatabase = targetDatabase() || firstDataFile?.logical_name.replace(/_data$/i, "") || "RestoredDatabase";
      setTargetDatabase(nextTargetDatabase);
      setFileMoves(files.map((file, index) => ({
        logical_name: file.logical_name,
        physical_name: makeRestorePath(defaults(), nextTargetDatabase, file, index),
      })));
      setSuccess(`Loaded ${files.length} file${files.length === 1 ? "" : "s"} from backup.`);
    } catch (err) {
      setError(cleanError(err, "Failed to inspect backup"));
    } finally {
      setBusyAction(null);
    }
  }

  function refreshRestoreMoves() {
    setFileMoves(backupFiles().map((file, index) => ({
      logical_name: file.logical_name,
      physical_name: makeRestorePath(defaults(), targetDatabase() || "RestoredDatabase", file, index),
    })));
  }

  async function runRestore() {
    setBusyAction("restore");
    setError(null);
    setSuccess(null);
    try {
      const result = await invoke<BackupOperationResult>("restore_database", {
        request: {
          source_path: sourcePath(),
          target_database: targetDatabase(),
          replace_existing: replaceExisting(),
          recovery: recovery(),
          restricted_user: restrictedUser(),
          file_moves: fileMoves(),
        },
      });
      setSuccess(`${result.message} ${result.elapsed_ms} ms`);
      props.onRefreshDatabases?.();
    } catch (err) {
      setError(cleanError(err, "Restore failed"));
    } finally {
      setBusyAction(null);
    }
  }

  async function saveSchedule() {
    setBusyAction("schedule");
    setError(null);
    setSuccess(null);
    setScheduleError(null);
    try {
      const result = await invoke<BackupOperationResult>("create_backup_schedule", {
        request: {
          job_name: scheduleJobName(),
          database: backupDatabase(),
          destination_folder: scheduleFolder(),
          backup_type: backupType(),
          frequency: scheduleFrequency(),
          time: scheduleTime(),
          weekly_days: weeklyDays(),
          monthly_day: monthlyDay(),
          copy_only: copyOnly(),
          compression: compression(),
          checksum: checksum(),
        },
      });
      setSuccess(result.message);
      await loadSchedules();
      setActiveTab("schedules");
    } catch (err) {
      setError(cleanError(err, "Schedule creation failed"));
    } finally {
      setBusyAction(null);
    }
  }

  async function deleteSchedule(jobName: string) {
    setBusyAction(`delete:${jobName}`);
    setError(null);
    setSuccess(null);
    setScheduleError(null);
    try {
      await invoke<BackupOperationResult>("delete_backup_schedule", { jobName });
      setSuccess("Schedule deleted.");
      await loadSchedules();
    } catch (err) {
      setError(cleanError(err, "Schedule deletion failed"));
    } finally {
      setBusyAction(null);
    }
  }

  function toggleWeekday(value: number) {
    setWeeklyDays((prev) => prev.includes(value) ? prev.filter((day) => day !== value) : [...prev, value].sort((a, b) => a - b));
  }

  function updateMove(index: number, physicalName: string) {
    setFileMoves((prev) => prev.map((move, i) => i === index ? { ...move, physical_name: physicalName } : move));
  }

  const renderCheck = (label: string, checked: boolean, onChange: (checked: boolean) => void, disabled = false) => (
    <label class={`flex items-center gap-2 text-s text-text-muted ${disabled ? "opacity-50" : "cursor-pointer"}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.currentTarget.checked)} />
      <span>{label}</span>
    </label>
  );

  return (
    <div
      class="dialog-overlay"
      data-visible={visible()}
      onMouseDown={() => !busy() && props.onClose()}
      role="dialog"
      aria-modal="true"
    >
      <div
        class="dialog-surface w-[760px] max-w-[calc(100vw-32px)] h-[720px] max-h-[calc(100vh-32px)] flex flex-col shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div class="flex items-center justify-between px-6 py-4 border-b border-overlay-xs">
          <div class="flex items-center gap-3 min-w-0">
            <div class="w-8 h-8 rounded-lg flex items-center justify-center bg-accent/10 text-accent shrink-0">
              <i class="fa-solid fa-rotate text-sm" />
            </div>
            <div class="flex flex-col min-w-0">
              <h2 class="text-m font-semibold text-text">Backup & Restore</h2>
              <p class="text-xs text-text-muted truncate">Database backup and restore wizard with SQL Server Agent scheduling</p>
            </div>
          </div>
          <Tooltip content="Close" placement="bottom">
            <button
              type="button"
              onClick={props.onClose}
              disabled={busy()}
              class="text-text-muted hover:bg-surface-overlay hover:text-text rounded-lg w-8 h-8 flex items-center justify-center transition-colors cursor-pointer shrink-0 disabled:opacity-40"
            >
              &times;
            </button>
          </Tooltip>
        </div>

        <div class="flex border-b border-border/30 px-2">
          <For each={[
            { id: "backup" as const, label: "Backup", icon: "fa-database" },
            { id: "restore" as const, label: "Restore", icon: "fa-clock-rotate-left" },
            { id: "schedules" as const, label: "Schedules", icon: "fa-calendar-days" },
          ]}>
            {(tab) => (
              <button
                type="button"
                onClick={() => setActiveTab(tab.id)}
                class={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px flex items-center gap-2 cursor-pointer ${
                  activeTab() === tab.id
                    ? "border-accent text-text"
                    : "border-transparent text-text-muted hover:text-text"
                }`}
              >
                <i class={`fa-solid ${tab.icon} text-[11px]`} />
                {tab.label}
              </button>
            )}
          </For>
        </div>

        <div class="flex-1 overflow-y-auto min-h-0 px-6 py-5">
          <Show when={error()}>
            <div class="mb-4 text-sm text-error/90 bg-error/5 border border-error/15 rounded-lg px-3 py-2 select-text whitespace-pre-wrap">
              {error()}
            </div>
          </Show>
          <Show when={success()}>
            <div class="mb-4 text-sm text-success/90 bg-success/5 border border-success/15 rounded-lg px-3 py-2 select-text">
              {success()}
            </div>
          </Show>

          <Show when={activeTab() === "backup"}>
            <div class="grid grid-cols-[1fr_220px] gap-5 max-md:grid-cols-1">
              <div class="flex flex-col gap-4">
                <div>
                  <label class="text-s font-medium text-text-muted mb-1.5 block">Database</label>
                  <Dropdown value={backupDatabase()} options={databaseOptions()} onChange={setBackupDatabase} filterable />
                </div>
                <div>
                  <label class="text-s font-medium text-text-muted mb-1.5 block">Destination on SQL Server</label>
                  <Input
                    value={destinationPath()}
                    placeholder={loadingDefaults() ? "Loading server default path..." : "C:\\SQLBackups\\Database_full.bak"}
                    onInput={(e) => {
                      setDestinationTouched(true);
                      setDestinationPath(e.currentTarget.value);
                    }}
                  />
                </div>
                <div>
                  <label class="text-s font-medium text-text-muted mb-1.5 block">Schedule Folder on SQL Server</label>
                  <Input
                    value={scheduleFolder()}
                    placeholder="C:\\SQLBackups"
                    onInput={(e) => setScheduleFolder(e.currentTarget.value)}
                  />
                </div>
                <div class="grid grid-cols-3 gap-3">
                  <div>
                    <label class="text-s font-medium text-text-muted mb-1.5 block">Type</label>
                    <Dropdown value={backupType()} options={backupTypeOptions} onChange={(value) => setBackupType(value as BackupType)} />
                  </div>
                  <div>
                    <label class="text-s font-medium text-text-muted mb-1.5 block">Frequency</label>
                    <Dropdown value={scheduleFrequency()} options={frequencyOptions} onChange={(value) => setScheduleFrequency(value as BackupScheduleFrequency)} />
                  </div>
                  <div>
                    <label class="text-s font-medium text-text-muted mb-1.5 block">Time</label>
                    <Input type="time" value={scheduleTime()} onInput={(e) => setScheduleTime(e.currentTarget.value)} />
                  </div>
                </div>

                <Show when={scheduleFrequency() === "weekly"}>
                  <div class="flex flex-wrap gap-2">
                    <For each={WEEKDAYS}>
                      {(day) => (
                        <button
                          type="button"
                          onClick={() => toggleWeekday(day.value)}
                          class={`btn h-7 px-2 ${weeklyDays().includes(day.value) ? "btn-toggled" : "btn-secondary"}`}
                        >
                          {day.label}
                        </button>
                      )}
                    </For>
                  </div>
                </Show>

                <Show when={scheduleFrequency() === "monthly"}>
                  <div class="max-w-[160px]">
                    <label class="text-s font-medium text-text-muted mb-1.5 block">Day of month</label>
                    <Input type="number" min="1" max="31" value={monthlyDay()} onInput={(e) => setMonthlyDay(Number(e.currentTarget.value) || 1)} />
                  </div>
                </Show>
              </div>

              <div class="flex flex-col gap-3 text-sm">
                <div class="rounded-lg border border-border/50 bg-surface-overlay/30 p-3">
                  <div class="text-xs uppercase tracking-wider text-text-muted mb-2">Options</div>
                  <div class="flex flex-col gap-2">
                    {renderCheck("Overwrite destination", overwrite(), setOverwrite)}
                    {renderCheck("Copy-only backup", copyOnly(), setCopyOnly, backupType() === "differential")}
                    {renderCheck("Compression", compression(), setCompression)}
                    {renderCheck("Checksum", checksum(), setChecksum)}
                  </div>
                </div>
                <div class="rounded-lg border border-border/50 bg-surface-overlay/30 p-3 text-s text-text-muted leading-relaxed">
                  SQL Server writes to paths visible from the database server, not necessarily this workstation.
                </div>
              </div>
            </div>
          </Show>

          <Show when={activeTab() === "restore"}>
            <div class="flex flex-col gap-4">
              <div class="grid grid-cols-[1fr_auto] gap-3">
                <div>
                  <label class="text-s font-medium text-text-muted mb-1.5 block">Backup file on SQL Server</label>
                  <Input value={sourcePath()} placeholder="C:\\SQLBackups\\Database_full.bak" onInput={(e) => handleSourcePathChange(e.currentTarget.value)} />
                </div>
                <div class="flex items-end">
                  <button type="button" onClick={inspectBackup} disabled={busy() || !sourcePath().trim()} class="btn btn-secondary px-4">
                    <Show when={busyAction() === "inspect"} fallback={<i class="fa-solid fa-magnifying-glass" />}>
                      <div class="w-3.5 h-3.5 rounded-full border-2 border-current/30 border-t-current animate-spin" />
                    </Show>
                    Inspect
                  </button>
                </div>
              </div>

              <div class="grid grid-cols-[1fr_auto] gap-3">
                <div>
                  <label class="text-s font-medium text-text-muted mb-1.5 block">Restore as database</label>
                  <Input value={targetDatabase()} placeholder="RestoredDatabase" onInput={(e) => setTargetDatabase(e.currentTarget.value)} />
                </div>
                <div class="flex items-end">
                  <button type="button" onClick={refreshRestoreMoves} disabled={backupFiles().length === 0 || !targetDatabase().trim()} class="btn btn-secondary px-4">
                    <i class="fa-solid fa-wand-magic-sparkles" />
                    Paths
                  </button>
                </div>
              </div>

              <div class="rounded-lg border border-border/50 overflow-hidden">
                <div class="grid grid-cols-[160px_96px_1fr] gap-3 px-3 py-2 text-xs uppercase tracking-wider text-text-muted bg-surface-header">
                  <span>Logical File</span>
                  <span>Size</span>
                  <span>Restore Path</span>
                </div>
                <Show
                  when={fileMoves().length > 0}
                  fallback={<div class="px-3 py-8 text-center text-sm text-text-muted">Inspect a backup file to load logical files.</div>}
                >
                  <For each={fileMoves()}>
                    {(move, index) => {
                      const file = () => backupFiles()[index()];
                      return (
                        <div class="grid grid-cols-[160px_96px_1fr] gap-3 px-3 py-2 border-t border-border/30 items-center">
                          <div class="min-w-0">
                            <div class="text-sm text-text font-mono truncate" title={move.logical_name}>{move.logical_name}</div>
                            <div class="text-[10px] text-text-muted">{file()?.file_type === "L" ? "Log" : "Data"}</div>
                          </div>
                          <span class="text-s text-text-muted">{formatSize(file()?.size_bytes ?? 0)}</span>
                          <Input value={move.physical_name} onInput={(e) => updateMove(index(), e.currentTarget.value)} />
                        </div>
                      );
                    }}
                  </For>
                </Show>
              </div>

              <div class="flex flex-wrap gap-4">
                {renderCheck("Replace existing database", replaceExisting(), setReplaceExisting)}
                {renderCheck("Recover database", recovery(), setRecovery)}
                {renderCheck("Restricted user after restore", restrictedUser(), setRestrictedUser)}
              </div>
            </div>
          </Show>

          <Show when={activeTab() === "schedules"}>
            <div class="flex flex-col gap-3">
              <div class="flex items-center justify-between">
                <div>
                  <h3 class="text-sm font-semibold text-text">SQLQS Backup Jobs</h3>
                  <p class="text-xs text-text-muted">Schedules are stored in SQL Server Agent.</p>
                </div>
                <button type="button" onClick={loadSchedules} disabled={schedulesLoading()} class="btn btn-secondary px-4">
                  <i class={`fa-solid fa-rotate ${schedulesLoading() ? "animate-spin" : ""}`} />
                  Refresh
                </button>
              </div>

              <Show when={scheduleError()}>
                <div class="text-sm text-error/90 bg-error/5 border border-error/15 rounded-lg px-3 py-2 select-text whitespace-pre-wrap">
                  {scheduleError()}
                </div>
              </Show>

              <Show
                when={schedules().length > 0}
                fallback={<div class="px-3 py-10 text-center text-sm text-text-muted border border-border/50 rounded-lg">No SQLQS backup schedules found.</div>}
              >
                <div class="rounded-lg border border-border/50 overflow-hidden">
                  <For each={schedules()}>
                    {(schedule) => (
                      <div class="grid grid-cols-[1fr_170px_auto] gap-3 px-3 py-3 border-b last:border-b-0 border-border/30 items-center">
                        <div class="min-w-0">
                          <div class="text-sm text-text font-medium truncate">{schedule.job_name}</div>
                          <div class="text-xs text-text-muted truncate">{schedule.schedule_name || "No schedule attached"}</div>
                        </div>
                        <div class="text-xs text-text-muted">
                          {schedule.next_run ? `Next: ${schedule.next_run}` : schedule.enabled ? "Next run unavailable" : "Disabled"}
                        </div>
                        <button type="button" onClick={() => deleteSchedule(schedule.job_name)} disabled={busy()} class="btn btn-secondary px-3 hover:!text-error">
                          <Show when={busyAction() === `delete:${schedule.job_name}`} fallback={<i class="fa-solid fa-trash-can" />}>
                            <div class="w-3.5 h-3.5 rounded-full border-2 border-current/30 border-t-current animate-spin" />
                          </Show>
                        </button>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </Show>
        </div>

        <div class="flex items-center justify-between gap-3 px-6 py-4 border-t border-border rounded-b-2xl">
          <div class="text-xs text-text-muted/70">
            <Show when={activeTab() === "backup"}>
              {backupTypeLabel(backupType())} backup for {backupDatabase() || "database"}
            </Show>
          </div>
          <div class="flex gap-3">
            <button type="button" onClick={props.onClose} disabled={busy()} class="btn btn-secondary px-6">
              Close
            </button>
            <Show when={activeTab() === "backup"}>
              <button type="button" onClick={saveSchedule} disabled={busy() || !backupDatabase() || !scheduleFolder().trim()} class="btn btn-secondary px-4">
                <Show when={busyAction() === "schedule"} fallback={<i class="fa-solid fa-calendar-plus" />}>
                  <div class="w-3.5 h-3.5 rounded-full border-2 border-current/30 border-t-current animate-spin" />
                </Show>
                Schedule
              </button>
              <button type="button" onClick={runBackup} disabled={busy() || !backupDatabase() || !destinationPath().trim()} class="btn btn-primary px-5">
                <Show when={busyAction() === "backup"} fallback={<i class="fa-solid fa-play" />}>
                  <div class="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                </Show>
                Run Backup
              </button>
            </Show>
            <Show when={activeTab() === "restore"}>
              <button type="button" onClick={runRestore} disabled={busy() || !sourcePath().trim() || !targetDatabase().trim()} class="btn btn-primary px-5">
                <Show when={busyAction() === "restore"} fallback={<i class="fa-solid fa-clock-rotate-left" />}>
                  <div class="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                </Show>
                Restore
              </button>
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
}
