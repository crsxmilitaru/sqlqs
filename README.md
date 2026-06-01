<!-- markdownlint-disable MD033 MD041 -->
<div align="center">
  <img src="src-tauri/icons/128x128.png" alt="SQL Query Studio Icon" width="128" height="128">

# SQL Query Studio

**A fast, lightweight SQL editor built for modern workflows.**

[![Version](https://img.shields.io/github/package-json/v/crsxmilitaru/sqlqs)](https://github.com/crsxmilitaru/sqlqs/releases)
[![License](https://img.shields.io/github/license/crsxmilitaru/sqlqs)](LICENSE)
[![Download Latest](https://img.shields.io/github/v/release/crsxmilitaru/sqlqs?logo=github&logoColor=white&label=Download%20Latest)](https://github.com/crsxmilitaru/sqlqs/releases/latest)

</div>

---

SQL Query Studio is a cross-platform SQL client focused on speed and a great user experience. Built with Tauri and SolidJS, it provides a native desktop feel while remaining highly responsive.

## Features

- **Fast & Lightweight:** Built on Tauri and Rust for native performance.
- **Modern Editor:** Powered by CodeMirror 6, featuring syntax highlighting, a minimap, and auto-formatting.
- **Database Explorer:** Easily navigate your servers, databases, schemas, tables, and views.
- **AI Assistant:** Google GenAI integration to help you write, explain, or optimize SQL queries.
- **Theming:** Multiple built-in themes (Dark, Dracula, Light, Midnight, OLED, Soft Light) to match your setup.
- **Secure by Default:** Uses native OS keychains to safely manage your database credentials.

## Tech Stack

- **Frontend:** [SolidJS](https://www.solidjs.com/) • [TypeScript](https://www.typescriptlang.org/) • [Tailwind CSS v4](https://tailwindcss.com/)
- **Backend:** [Tauri v2](https://tauri.app/) • [Rust](https://www.rust-lang.org/) • .NET sidecar
- **Database Driver:** [Microsoft.Data.SqlClient](https://github.com/dotnet/SqlClient) with SMO for scripting, backup, and restore support
- **Editor:** [CodeMirror 6](https://codemirror.net/)

## Getting Started

### Prerequisites

Make sure you have these installed:

- [Node.js](https://nodejs.org/) (v22+)
- [Rust](https://rustup.rs/) (latest stable)
- [.NET SDK](https://dotnet.microsoft.com/download) matching `global.json`
- OS-specific Tauri dependencies (check the [Tauri setup guide](https://v2.tauri.app/start/prerequisites/))

### Development

1. **Clone the repository:**

   ```bash
   git clone https://github.com/crsxmilitaru/sqlqs.git
   cd sqlqs
   ```

2. **Install dependencies:**

   ```bash
   npm run setup
   ```

3. **Start the development server:**
   ```bash
   npm start
   ```
   This builds the debug sidecar once before Tauri starts.

### Building for Production

Create a standalone executable for your operating system:

```bash
npm run tauri:build
```

Compiled binaries will be available in the `src-tauri/target/release/bundle/` directory.

## License & Support

This project is open-source under the **ISC License**. See the [LICENSE](LICENSE) file.

If you find SQL Query Studio helpful, consider supporting the development!

<a href="https://www.paypal.com/donate?hosted_button_id=MZQS5CZ68NGEW">
  <img src="https://www.paypalobjects.com/en_US/i/btn/btn_donate_LG.gif" alt="Donate with PayPal" />
</a>
