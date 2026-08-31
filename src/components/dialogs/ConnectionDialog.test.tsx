import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "../../lib/types";
import { invokeMock, setInvokeHandler } from "../../test/tauri";
import ConnectionDialog from "./ConnectionDialog";

function input(container: HTMLElement, name: string) {
  return container.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
}

describe("ConnectionDialog", () => {
  beforeEach(() => {
    setInvokeHandler((command) => {
      if (command === "load_connections") {
        return {
          connections: [],
          auto_connect_startup: false,
        } satisfies AppSettings;
      }
      if (command === "connect_to_server") return undefined;
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
  });

  it("connects using the field-based configuration", async () => {
    const user = userEvent.setup();
    const onConnect = vi.fn();
    const { container } = render(() => (
      <ConnectionDialog onConnect={onConnect} onClose={vi.fn()} />
    ));

    await user.clear(input(container, "server"));
    await user.type(input(container, "server"), "db01");
    await user.type(input(container, "database"), "app");
    await user.clear(input(container, "username"));
    await user.type(input(container, "username"), "sqluser");
    await user.type(input(container, "password"), "secret");
    await user.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("connect_to_server", {
        config: {
          server: "db01",
          database: "app",
          username: "sqluser",
          password: "secret",
          use_windows_auth: false,
          encrypt: false,
          trust_server_certificate: true,
        },
        saveConnection: "sqluser@db01",
        rememberPassword: false,
      }),
    );
    expect(onConnect).toHaveBeenCalledWith(
      expect.objectContaining({ server: "db01", database: "app" }),
    );
  });

  it("parses server and database previews from connection strings", async () => {
    const user = userEvent.setup();
    const onConnect = vi.fn();
    const { container } = render(() => (
      <ConnectionDialog onConnect={onConnect} onClose={vi.fn()} />
    ));

    await user.click(
      screen.getByRole("button", { name: "Connection String" }),
    );
    const textarea = container.querySelector<HTMLTextAreaElement>(
      'textarea[name="connection-string"]',
    )!;
    await user.type(
      textarea,
      'Server=tcp:db01;Initial Catalog="app;archive";Encrypt=true',
    );
    await user.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() => expect(onConnect).toHaveBeenCalledOnce());
    expect(onConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        server: "db01",
        database: "app;archive",
        connection_string:
          'Server=tcp:db01;Initial Catalog="app;archive";Encrypt=true',
      }),
    );
  });

  it("surfaces native connection failures", async () => {
    const user = userEvent.setup();
    setInvokeHandler((command) => {
      if (command === "load_connections") {
        return { connections: [], auto_connect_startup: false };
      }
      if (command === "connect_to_server") {
        throw new Error("Login failed");
      }
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
    render(() => (
      <ConnectionDialog onConnect={vi.fn()} onClose={vi.fn()} />
    ));

    await user.click(screen.getByRole("button", { name: "Connect" }));

    expect(await screen.findByText("Error: Login failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect" })).toBeEnabled();
  });

  it("saves edited connections without connecting", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const settings: AppSettings = {
      connections: [
        {
          name: "Old",
          config: {
            server: "db01",
            username: "sa",
            use_windows_auth: false,
            encrypt: false,
            trust_server_certificate: true,
          },
        },
      ],
      last_connection: "Old",
      auto_connect_startup: false,
    };
    setInvokeHandler((command) => {
      if (command === "load_connections") return settings;
      if (command === "load_saved_password") return null;
      if (command === "save_connections_settings") return undefined;
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
    const { container } = render(() => (
      <ConnectionDialog
        editConnection={settings.connections[0]}
        onConnect={vi.fn()}
        onClose={vi.fn()}
        onSaved={onSaved}
      />
    ));
    await waitFor(() => expect(input(container, "save-name")).toHaveValue("Old"));

    await user.clear(input(container, "save-name"));
    await user.type(input(container, "save-name"), "Primary");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("save_connections_settings", {
        payload: expect.objectContaining({
          last_connection: "Primary",
          connections: [expect.objectContaining({ name: "Primary" })],
        }),
      }),
    );
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Primary" }),
    );
  });
});
