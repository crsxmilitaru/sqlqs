import type { AppSettings } from "../lib/types";

export const CONNECTION_SETTINGS: AppSettings = {
  connections: [
    {
      name: "Local Dev",
      config: {
        server: "localhost",
        use_windows_auth: false,
        username: "sa",
        encrypt: false,
        trust_server_certificate: true,
      },
    },
    {
      name: "Staging",
      config: {
        server: "staging-db",
        database: "reports",
        use_windows_auth: true,
        encrypt: false,
        trust_server_certificate: false,
      },
    },
  ],
  last_connection: "Staging",
  auto_connect_startup: false,
};

export const EMPTY_CONNECTION_SETTINGS: AppSettings = {
  connections: [],
  auto_connect_startup: false,
};
