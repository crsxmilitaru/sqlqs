# AGENTS.md

## 1. Project

**SQL Query Studio** (`sqlqs`) is a desktop SQL editor for **Microsoft SQL Server** on Windows and macOS. The npm/crate name is `sqlqs`; the shipped product name is `SQL Query Studio`.

It is not a generic multi-engine SQL client, and the sidecar is not a database engine. SQL Server is the engine. This app is a client: editor UI, Tauri host, and a .NET process that talks to SQL Server.

## 2. Architecture

Three processes:

```text
SolidJS webview  --Tauri invoke-->  Rust host (sqlqs_lib)  --JSON-RPC stdin/stdout-->  Sqlqs.Sidecar.Host
```

1. **Frontend (`src/`)** — SolidJS + TypeScript, Vite, Tailwind CSS v4 plus component CSS in `src/styles/`. CodeMirror 6 (`@codemirror/lang-sql`, `sql-formatter`, `@replit/codemirror-minimap`). Gemini chat via `@google/genai`. Icons: Font Awesome.
2. **Tauri host (`src-tauri/src/`)** — Rust crate `sqlqs_lib` (binary `sqlqs`). Windowing (frameless custom title bar; Mica on Windows), Tauri command handlers, OS keychain (`keyring`, service name `SQL Query Studio`), settings, updater, file I/O, clipboard, Excel/CSV/JSON export. Spawns and supervises the sidecar (`SidecarSupervisor`).
3. **Sidecar (`src-tauri/sidecar/`)** — .NET 10 self-contained executable `Sqlqs.Sidecar.Host` (separate version from app), bundled as `externalBin`. Speaks JSON-RPC 2.0 (StreamJsonRpc, `Content-Length` framing) over stdin/stdout. Connects to SQL Server with `Microsoft.Data.SqlClient`. Scripting, backup, and restore use SMO (`Microsoft.SqlServer.SqlManagementObjects`). Extended Events live in `Sqlqs.Sidecar.Sql`.

Frontend never talks to the sidecar directly. Keep JSON-RPC payloads in sync between:

- C# DTOs: `src-tauri/sidecar/src/Sqlqs.Sidecar.Contracts/` (namespaces `Sqlqs.Contracts.*`, assembly `Sqlqs.Sidecar.Contracts`, `netstandard2.0`)
- Rust mirrors: `src-tauri/src/sidecar/contracts/`

Sidecar RPC groups: `health.*`, `connection.*`, `query.*`, `schema.*`, `scripting.*`, `backup.*`, `xe.*`.

## 3. Repository layout

```text
sqlqs/
├── .github/workflows/          # build-desktop, preview, stable
├── docs/                       # screenshots and user-facing images
├── scripts/                    # sidecar build/dev, version bump, release
├── index.html                  # Vite entry
├── src/                        # SolidJS app
│   ├── components/             # ai, dialogs, editor, explorer, settings, shell, ui
│   ├── hooks/                  # useTabs, useConnection, useHistory, useSavedQueries, …
│   ├── lib/                    # AI, formatters, linter, safety, shortcuts, theme
│   ├── styles/                 # Tailwind entry (global.css) and component CSS
│   ├── themes/                 # built-in themes: dark, dracula, light, midnight, oled, soft-light
│   └── index.tsx
├── src-tauri/
│   ├── capabilities/           # Tauri v2 permissions
│   ├── sidecar/                # Sqlqs.Sidecar.slnx
│   │   └── src/
│   │       ├── Sqlqs.Sidecar.Host/       # JSON-RPC host process
│   │       ├── Sqlqs.Sidecar.Sql/        # SqlClient: connections, queries, schema, XE
│   │       ├── Sqlqs.Sidecar.Smo/        # SMO: scripting, backup/restore
│   │       └── Sqlqs.Sidecar.Contracts/  # shared DTOs (Sqlqs.Contracts.*)
│   ├── src/                    # Rust host (lib.rs + sidecar, db, settings, sql_gen, …)
│   ├── tests/                  # sidecar spawn + live SQL Server tests
│   ├── tauri.conf.json
│   ├── tauri.windows.conf.json
│   └── tauri.macos.conf.json
├── eslint.config.js
├── global.json                 # .NET SDK (10.0.100, rollForward latestFeature)
├── package.json
├── tsconfig.json
└── vite.config.ts              # dev server 127.0.0.1:1420
```

## 4. Toolchain

- **Node.js** 22+ (`.nvmrc` pins a 22.x version)
- **Rust** stable + `cargo`
- **.NET SDK** matching `global.json` (.NET 10)
- [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) (MSVC on Windows, Xcode on macOS)

## 5. Commands

### Setup
```bash
npm run setup
```
`npm install`, `cargo fetch`, `dotnet restore` of `src-tauri/sidecar/Sqlqs.Sidecar.slnx`.

### Development
```bash
npm start              # alias for tauri:dev; debug sidecar + desktop app
npm run tauri:dev
npm run dev            # Vite only (browser; no sidecar / Tauri APIs)
npm run sidecar:dev    # debug sidecar binary
```

`tauri dev` runs `sidecar:dev` then Vite via `beforeDevCommand`.

### Build
```bash
npm run build            # frontend → dist/
npm run sidecar:build    # self-contained sidecar exe
npm run tauri:build      # production installers (NSIS / DMG)
```

### Lint
```bash
npm run lint
npm run lint:fix
```

### Dependencies
```bash
npm run cargo:update    # update Rust dependencies in Cargo.lock
```

### Test
```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Health/spawn tests run without SQL Server. Live tests (`sidecar_*_live.rs`) require `SQLQS_TEST_SERVER` environment variable (SQL Server connection string). Optional test env vars:
- `SQLQS_TEST_USERNAME` — override connection username
- `SQLQS_TEST_PASSWORD` — override connection password
- `SQLQS_TEST_WINDOWS_AUTH` — use Windows authentication if set to any value
- `SQLQS_TEST_TRUST_CERT` — trust untrusted SSL certs
- `SQLQS_TEST_ENCRYPT` — enable connection encryption

## 6. Engineering standards

### Tests
- Avoid embedding real names, personal folders, or environment-specific data in committed tests.
- Prefer deterministic examples and mocked values that are valid in CI and across developer machines.
- Follow the current branch pattern: Vitest + SolidJS Testing Library for frontend coverage, with tests organized by responsibility.

### Test structure
- Component tests live under `src/components/` and cover dialogs, editors, explorer panes, settings, shell chrome, and UI primitives using `.test.tsx` files.
- Hook tests live under `src/hooks/` and focus on lifecycle/state transitions for app, editor, connection, history, tab, and saved-query behaviors using `.test.ts` files.
- Library tests live under `src/lib/` and cover pure logic such as SQL formatting, completion, safety checks, path handling, locale, schema catalog data, and theme/platform helpers.
- Shared test harnesses live under `src/test/`: `setup.ts` handles common browser/test setup, and `tauri.ts` provides mocked Tauri invoke handlers for unit tests.
- Keep each test close to the behavior it verifies, and prefer behavior-focused assertions over implementation details.
- Tests should be organized by feature area rather than by incidental implementation files.

### General
- Prefer clear, small units of work. Remove dead code and unused imports.
- No obvious comments. JSDoc only when types or intent are non-obvious.
- No fallbacks or keeping legacy code.
- CRLF on Windows.

### SolidJS frontend
- Component functions run once. Use `createSignal`, `createMemo`, `createEffect`, `createStore`, `Show`, `For`.
- Never destructure props in the argument list (breaks reactivity). Use `props.x` or `mergeProps`.
- Styling: Tailwind v4 utilities plus the existing CSS in `src/styles/`. Prefer tokens/CSS variables from `global.css` over one-off colors. Avoid inline styles.
- New keyboard shortcuts must be registered in `src/lib/shortcuts.ts` (Settings → Shortcuts).
- Surface errors in dialogs or status UI. No empty `catch` blocks.

### Rust host
- Idiomatic `Result<T, E>` with user-displayable error strings from Tauri commands.
- Sidecar lifecycle goes through `SidecarSupervisor` / `SidecarHandle`. Do not spawn the host process ad hoc.
- Validate command inputs. Do not log passwords, API keys, or connection strings with secrets.

### .NET sidecar
- `Sqlqs.Sidecar.Host` and libraries target `net10.0` with nullable reference types. Contracts target `netstandard2.0`.
- Dispose SQL connections and SMO objects.
- RPC method names and DTO shapes must match the Rust client in `src-tauri/src/sidecar/`.

## 7. Security

- Store SQL passwords and Gemini / Brave API keys in the OS keychain via `src-tauri/src/settings.rs`. Settings JSON must not contain secrets.
- Destructive SQL: use `src/lib/sql-safety.ts` and the existing confirmation UI before unguarded `UPDATE` / `DELETE` / `TRUNCATE` / `MERGE`.
- Tauri permissions live in `src-tauri/capabilities/default.json`. Add only what a feature needs.
- Never commit or log API keys.

## 8. Versioning & releases

App version is kept in sync by `scripts/set-version.mjs` across `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `src-tauri/Cargo.lock`. Sidecar `Sqlqs.Sidecar.Host` has its own assembly version and is not part of that sync.

Preview builds use a `-preview` suffix (e.g. `0.5.0-preview`). Stable releases strip the suffix (e.g. `0.5.0`).

Release workflow:
```bash
npm run release              # interactive: prompts for preview or stable release
```

The script will:
1. Prompt to choose preview or stable release
2. Update all version files
3. Run builds (sidecar + frontend)
4. Trigger GitHub Actions workflows

Commit subjects are imperative sentences, capitalized, no Conventional Commit prefixes. Example: `Add toast notifications and improve close UX`.
