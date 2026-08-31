import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import BackupRestoreDialog from "./BackupRestoreDialog";
import { invokeMock, setInvokeHandler } from "../../test/tauri";

const BACKUP_DEFAULTS = {
  backup_directory: "C:\\SQLBackups",
  data_directory: "C:\\Data",
  log_directory: "C:\\Logs",
};

const BACKUP_FILES = [
  {
    logical_name: "App_data",
    physical_name: "C:\\Data\\App.mdf",
    file_type: "D",
    size_bytes: 5 * 1024 * 1024,
  },
  {
    logical_name: "App_log",
    physical_name: "C:\\Logs\\App_log.ldf",
    file_type: "L",
    size_bytes: 1024 * 1024,
  },
];

const SCHEDULES = [
  {
    job_name: "Nightly App",
    schedule_name: "Daily 23:00",
    enabled: true,
    next_run: "2026-09-01 23:00:00",
  },
];

function renderDialog(
  overrides: Partial<Parameters<typeof BackupRestoreDialog>[0]> = {},
) {
  const onClose = vi.fn();
  const onRefreshDatabases = vi.fn();
  const rendered = render(() => (
    <BackupRestoreDialog
      databases={["app", "sales"]}
      currentDatabase="app"
      onClose={onClose}
      onRefreshDatabases={onRefreshDatabases}
      {...overrides}
    />
  ));
  return { ...rendered, onClose, onRefreshDatabases };
}

function defaultHandler(overrides: Record<string, unknown> = {}) {
  const handlers: Record<string, unknown> = {
    get_backup_defaults: BACKUP_DEFAULTS,
    list_backup_schedules: SCHEDULES,
    ...overrides,
  };
  return (command: string) => {
    if (command in handlers) return handlers[command] as never;
    throw new Error(`Unexpected Tauri command: ${command}`);
  };
}

function destinationInput(container: HTMLElement) {
  return container.querySelector(
    'input[name="backup-destination-path"]',
  ) as HTMLInputElement;
}

function sourcePathInput(container: HTMLElement) {
  return container.querySelector(
    'input[name="restore-source-path"]',
  ) as HTMLInputElement;
}

function targetDatabaseInput(container: HTMLElement) {
  return container.querySelector(
    'input[name="restore-target-database"]',
  ) as HTMLInputElement;
}

describe("BackupRestoreDialog", () => {
  it("loads defaults and schedules, and pre-fills the backup destination", async () => {
    setInvokeHandler(defaultHandler());
    const { container } = renderDialog();

    await waitFor(() => {
      expect(destinationInput(container).value).toMatch(
        /^C:\\SQLBackups\\app_full_\d{8}_\d{4}\.bak$/,
      );
    });
    expect(
      screen.getByText("Full backup for app"),
    ).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith("get_backup_defaults");
    expect(invokeMock).toHaveBeenCalledWith("list_backup_schedules");
  });

  it("prefers the initial database over the current database", async () => {
    setInvokeHandler(defaultHandler());
    renderDialog({ initialDatabase: "sales" });

    await waitFor(() => {
      expect(screen.getByText("Full backup for sales")).toBeInTheDocument();
    });
  });

  it("reports failures to load defaults", async () => {
    invokeMock.mockImplementation(
      ((command: string) => {
        if (command === "list_backup_schedules") return [] as never;
        throw new Error("Failed to load SQL Server default folders");
      }) as unknown as typeof invokeMock,
    );
    renderDialog();

    await waitFor(() => {
      expect(
        screen.getByText(/Failed to load SQL Server default folders/),
      ).toBeInTheDocument();
    });
  });

  it("runs a backup with the selected options", async () => {
    setInvokeHandler(
      defaultHandler({
        backup_database: { message: "Backup completed.", elapsed_ms: 420 },
      }),
    );
    renderDialog();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Run Backup/ }),
      ).not.toBeDisabled();
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Overwrite destination" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Run Backup" }));

    await waitFor(() => {
      expect(screen.getByText("Backup completed. 420 ms")).toBeInTheDocument();
    });
    const call = invokeMock.mock.calls.find(
      ([command]) => command === "backup_database",
    );
    expect(call?.[1]).toMatchObject({
      request: {
        database: "app",
        backup_type: "full",
        overwrite: false,
        copy_only: false,
        compression: false,
        checksum: true,
      },
    });
  });

  it("shows backup failures without closing", async () => {
    invokeMock.mockImplementation(
      ((command: string) => {
        if (command === "get_backup_defaults") return BACKUP_DEFAULTS as never;
        if (command === "list_backup_schedules") return [] as never;
        if (command === "backup_database") {
          throw new Error("Backup failed: device error");
        }
        throw new Error(`Unexpected Tauri command: ${command}`);
      }) as unknown as typeof invokeMock,
    );
    renderDialog();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Run Backup" }),
      ).not.toBeDisabled();
    });
    fireEvent.click(screen.getByRole("button", { name: "Run Backup" }));

    await waitFor(() => {
      expect(screen.getByText("device error")).toBeInTheDocument();
    });
  });

  it("keeps the destination when the user edits it", async () => {
    setInvokeHandler(defaultHandler());
    const { container } = renderDialog();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Run Backup" }),
      ).not.toBeDisabled();
    });
    fireEvent.input(destinationInput(container), {
      target: { value: "D:\\Custom\\app.bak" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run Backup" }));

    await waitFor(() => {
      const call = invokeMock.mock.calls.find(
        ([command]) => command === "backup_database",
      );
      expect(call?.[1]).toMatchObject({
        request: { destination_path: "D:\\Custom\\app.bak" },
      });
    });
  });

  it("creates a schedule and switches to the schedules tab", async () => {
    setInvokeHandler(
      defaultHandler({
        create_backup_schedule: {
          message: "Schedule created.",
          elapsed_ms: 10,
        },
      }),
    );
    renderDialog();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Schedule$/ }),
      ).not.toBeDisabled();
    });
    fireEvent.click(screen.getByRole("button", { name: /Schedule$/ }));

    await waitFor(() => {
      expect(screen.getByText("Schedule created.")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText("SQLQS Backup Jobs")).toBeInTheDocument();
    });
    expect(screen.getByText("Nightly App")).toBeInTheDocument();
    expect(screen.getByText(/Next: 2026-09-01 23:00:00/)).toBeInTheDocument();
  });

  it("shows weekly day toggles for weekly frequency", async () => {
    setInvokeHandler(
      defaultHandler({
        create_backup_schedule: { message: "ok", elapsed_ms: 1 },
      }),
    );
    renderDialog();

    await waitFor(() => {
      expect(screen.getByText("Backup & Restore")).toBeInTheDocument();
    });
    const frequencyCombo = screen.getAllByRole("combobox")[2];
    fireEvent.click(frequencyCombo);
    fireEvent.click(screen.getByRole("option", { name: "Weekly" }));

    expect(screen.getByText("Mon")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Wed"));

    fireEvent.click(screen.getByRole("button", { name: /Schedule$/ }));
    await waitFor(() => {
      const call = invokeMock.mock.calls.find(
        ([command]) => command === "create_backup_schedule",
      );
      expect(call?.[1]).toMatchObject({
        request: { frequency: "weekly", weekly_days: [2, 4, 16, 32] },
      });
    });
  });

  it("deletes a schedule from the schedules tab", async () => {
    setInvokeHandler(
      defaultHandler({ delete_backup_schedule: { message: "ok", elapsed_ms: 1 } }),
    );
    renderDialog();

    await waitFor(() => {
      expect(screen.getByText("Backup & Restore")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Schedules" }));
    await waitFor(() => {
      expect(screen.getByText("Nightly App")).toBeInTheDocument();
    });
    const deleteButton = screen
      .getByText("Nightly App")
      .closest("div.grid")!
      .querySelector("button")!;
    fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("delete_backup_schedule", {
        jobName: "Nightly App",
      });
    });
  });

  it("inspects a backup file and builds restore paths", async () => {
    setInvokeHandler(defaultHandler({ inspect_backup_file: BACKUP_FILES }));
    const { container } = renderDialog();

    await waitFor(() => {
      expect(screen.getByText("Backup & Restore")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    fireEvent.input(sourcePathInput(container), {
      target: { value: "C:\\SQLBackups\\app.bak" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Inspect/ }));

    await waitFor(() => {
      expect(screen.getByText("Loaded 2 files from backup.")).toBeInTheDocument();
    });
    expect(screen.getByText("App_data")).toBeInTheDocument();
    expect(screen.getByText("App_log")).toBeInTheDocument();
    expect(targetDatabaseInput(container).value).toBe("App");
    const paths = Array.from(
      container.querySelectorAll('input[name^="restore-move-path-"]'),
    ).map((el) => (el as HTMLInputElement).value);
    expect(paths).toEqual([
      "C:\\Data\\App_App_data.mdf",
      "C:\\Logs\\App_App_log.ldf",
    ]);
  });

  it("rejects backups that contain no files", async () => {
    setInvokeHandler(defaultHandler({ inspect_backup_file: [] }));
    const { container } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    fireEvent.input(sourcePathInput(container), {
      target: { value: "C:\\SQLBackups\\empty.bak" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Inspect/ }));

    await waitFor(() => {
      expect(
        screen.getByText("No files were found in this backup."),
      ).toBeInTheDocument();
    });
  });

  it("restores a database with the configured moves", async () => {
    setInvokeHandler(
      defaultHandler({
        inspect_backup_file: BACKUP_FILES,
        restore_database: { message: "Restore completed.", elapsed_ms: 900 },
      }),
    );
    const { onRefreshDatabases, container } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    fireEvent.input(sourcePathInput(container), {
      target: { value: "C:\\SQLBackups\\app.bak" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Inspect/ }));
    await waitFor(() => {
      expect(screen.getByText("Loaded 2 files from backup.")).toBeInTheDocument();
    });
    const restoreButtons = screen.getAllByRole("button", { name: "Restore" });
    fireEvent.click(restoreButtons[restoreButtons.length - 1]);

    await waitFor(() => {
      expect(screen.getByText("Restore completed. 900 ms")).toBeInTheDocument();
    });
    expect(onRefreshDatabases).toHaveBeenCalledOnce();
    const call = invokeMock.mock.calls.find(
      ([command]) => command === "restore_database",
    );
    expect(call?.[1]).toMatchObject({
      request: {
        source_path: "C:\\SQLBackups\\app.bak",
        target_database: "App",
        replace_existing: false,
        recovery: true,
        restricted_user: false,
        file_moves: [
          { logical_name: "App_data", physical_name: "C:\\Data\\App_App_data.mdf" },
          { logical_name: "App_log", physical_name: "C:\\Logs\\App_App_log.ldf" },
        ],
      },
    });
  });
});
