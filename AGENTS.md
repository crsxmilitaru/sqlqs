# AGENTS.md

## 1. Project Overview & Architecture

`sqlqs` is a lightweight, cross-platform SQL client designed for speed, native desktop performance, and an intuitive user experience.

### High-Level Architecture
The project is built on a 3-tier architecture:
1. **Frontend (`src/`)**:
   - **Framework**: SolidJS with TypeScript
   - **Styling**: Tailwind CSS v4
   - **Editor**: CodeMirror 6 with SQL grammar, auto-formatting (`sql-formatter`), minimap, and linting
   - **AI Assistance**: Google GenAI integration (`@google/genai`) for query explanation and generation
2. **Desktop Core Host (`src-tauri/src/`)**:
   - **Framework**: Tauri v2 in Rust
   - **Role**: Window management, OS keychain credential storage (`keyring`), filesystem access, native menus, updater, and IPC bridge
3. **Database Engine Sidecar (`src-tauri/sidecar/`)**:
   - **Framework**: .NET 10 (C#) host application (`Sqlqs.Sidecar.Host`)
   - **Role**: High-performance database operations via `Microsoft.Data.SqlClient` and Microsoft SQL Server Management Objects (SMO) for scripting, backup/restore, and Extended Events (XE)

---

## 2. Repository Layout

```text
sqlqs/
├── .github/workflows/      # GitHub Actions CI/CD (desktop builds, preview, stable release)
├── .vscode/                # VS Code workspace tasks and launch configurations
├── public/                 # Static assets
├── scripts/                # Node.js scripts for sidecar build, dev, version bumping, and release
├── src/                    # Frontend SolidJS application
│   ├── components/         # Modular UI components (ai, dialogs, editor, explorer, settings, shell, ui)
│   ├── hooks/              # SolidJS custom reactive hooks (useTabs, useConnection, useHistory, etc.)
│   ├── lib/                # Utilities, AI client, SQL formatters, safety checks, theme manager
│   ├── styles/             # Global CSS and Tailwind entry point
│   ├── themes/             # Theme definitions (Dark, Dracula, Light, Midnight, OLED, Soft Light)
│   └── index.tsx           # Application root mounting point
├── src-tauri/              # Tauri backend
│   ├── capabilities/       # Tauri v2 security and permission manifests
│   ├── sidecar/            # .NET sidecar solution (Sqlqs.Sidecar.slnx)
│   ├── src/                # Rust backend implementation (IPC commands, sidecar supervisor, db bridge)
│   ├── tests/              # Rust integration and live sidecar tests
│   └── tauri.conf.json     # Tauri runtime and bundle configuration
├── eslint.config.js        # ESLint flat configuration (TypeScript + SolidJS)
├── global.json             # .NET SDK configuration
├── package.json            # NPM dependencies and scripts
├── tsconfig.json           # TypeScript configuration
└── vite.config.ts          # Vite build and plugin setup
```

---

## 3. Toolchain & Prerequisites

Ensure the following tools are present in the environment:
- **Node.js**: v22+ (npm)
- **Rust**: Latest stable toolchain with `cargo`
- **.NET SDK**: Matching version in `global.json` (.NET 10)
- **Platform Dependencies**: Platform-specific Tauri prerequisites (e.g., C++ build tools on Windows, Xcode on macOS)

---

## 4. Build, Run, and Test Commands

### Initial Setup
```bash
npm run setup
```
Installs npm packages, fetches cargo dependencies, and restores .NET sidecar packages.

### Development
- **Run Full Desktop App**:
  ```bash
  npm start
  # or: npm run tauri:dev
  ```
  Automatically compiles the debug sidecar and runs the Tauri application with hot-reload.
- **Frontend Only (Browser Prototyping)**:
  ```bash
  npm run dev
  ```
- **Sidecar Development Build**:
  ```bash
  npm run sidecar:dev
  ```

### Building
- **Build Frontend**: `npm run build`
- **Build Sidecar Executables**: `npm run sidecar:build`
- **Build Production Desktop App**:
  ```bash
  npm run tauri:build
  ```

### Linting & Formatting
- **Lint Frontend**: `npm run lint`
- **Auto-Fix Lint Issues**: `npm run lint:fix`

### Testing
- **Rust Backend Tests**:
  ```bash
  cargo test --manifest-path src-tauri/Cargo.toml
  ```

---

## 5. Code Style & Engineering Standards

### General Principles
- Maintain high code clarity, simplicity, and single-responsibility principles.
- Use CRLF line endings on Windows.
- Write self-explanatory code; avoid obvious or redundant comments. Use JSDoc only when typing or intent is non-obvious.
- Immediately remove dead code, unused variables, and unused imports.

### SolidJS & Frontend Guidelines
- **Reactivity Rules**: SolidJS components do not re-render like React components; the component function executes only once. Use reactive primitives (`createSignal`, `createMemo`, `createEffect`, `createStore`, `Show`, `For`).
- **Props**: Never destructure props directly inside component arguments as it breaks reactivity (use `mergeProps` or access via `props.propertyName`).
- **Styling**: Use Tailwind CSS v4 classes. Avoid inline styles and deep selector nesting.
- **Error Handling**: Never use empty `catch` blocks. Surface errors through user-facing modal dialogs or status indicators.

### Rust & Tauri Backend Guidelines
- Use idiomatic Rust with explicit error propagation (`Result<T, E>`).
- Manage sidecar processes asynchronously via Tokio and the custom `SidecarSupervisor`.
- Ensure all Tauri IPC command handlers validate inputs and return serialized errors suitable for client display.

### C# / .NET Sidecar Guidelines
- Target .NET 10 idioms with nullable reference types enabled.
- Keep IPC message formats consistent with the Rust sidecar client definitions.
- Ensure database connections and SMO server handles are cleanly disposed of.

---

## 6. Security Considerations

- **Credential Storage**: Database passwords and sensitive connection parameters must be stored in the OS-native keychain via the `keyring` crate. Do not log credentials or store them in plaintext configuration files.
- **Query Execution Safety**: Use safety validation helpers in `src/lib/sql-safety.ts` to detect destructive statements before execution.
- **Tauri Permissions**: Follow least-privilege principles when adding plugins or permissions in `src-tauri/capabilities/default.json`.
- **AI Integrations**: API keys must be securely stored and never committed or logged.

---

## 7. Versioning & Releases

- Version updates are synchronized across `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, and sidecar metadata.
- Automated release workflow:
  ```bash
  npm run release
  ```
- Follow standard Conventional Commits (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `perf:`).
