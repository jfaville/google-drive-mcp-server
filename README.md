# Google Drive MCP Server

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that provides secure Google Drive access using the restrictive `drive.file` OAuth scope — the server can only access files it creates or files the user explicitly selects via the built-in Google Picker. It can never access the rest of a user's Drive.

---

## How It Works

```
MCP Client (Claude Code, etc.)
        │
        │  JSON-RPC (stdio or HTTP)
        ▼
  Google Drive MCP Server
     ├── /mcp          → MCP protocol endpoint
     ├── /             → Login + Picker web UI
     └── /oauth/callback → OAuth redirect handler
        │
        │  Google Drive API v3 (drive.file scope)
        ▼
    Google Drive
  (permitted files only)
```

**Two transport modes:**
- **stdio** — for local MCP clients that launch the server as a subprocess (e.g. Claude Desktop). Authentication via manual OAuth code flow.
- **http** — exposes the server at `http://localhost:PORT/mcp`, plus a browser-based login and Picker UI at `http://localhost:PORT`. This is the recommended mode for interactive use.

---

## Prerequisites

- Node.js 18+
- A Google Cloud project with the Drive API enabled
- OAuth 2.0 credentials (Desktop application type)

---

## Google Cloud Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create or select a project
3. Enable the **Google Drive API** under *APIs & Services → Library*
4. Create credentials under *APIs & Services → Credentials*:
   - Click *Create Credentials → OAuth 2.0 Client ID*
   - Application type: **Desktop app**
   - Copy the **Client ID** and **Client Secret**
5. Under *APIs & Services → OAuth consent screen*:
   - Add your Google account email as a **Test user** (required while the app's publishing status is "Testing")

---

## Installation

```bash
# From archive
tar -xzf google-drive-mcp-server.tar.gz
cd google-drive-mcp-server

# Install dependencies
npm install

# Build
npm run build
```

---

## Configuration

Copy `.env.example` to `.env` and set your credentials:

```bash
cp .env.example .env
```

```env
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret

# Transport: 'http' (recommended) or 'stdio'
TRANSPORT=http

# Port for HTTP transport (default: 3000)
PORT=3000
```

OAuth tokens are saved automatically to `.tokens.json` after first login. On subsequent starts the server reloads them — **you only need to authenticate once**.

---

## Running

```bash
npm start
```

### HTTP mode (recommended)

Opens `http://localhost:3000`.

**First run:**
1. Open `http://localhost:3000` in your browser
2. Click **Sign in with Google** — you'll be redirected to Google and back automatically
3. The Picker loads — select any files you want the MCP server to access
4. Done. The MCP tools can now access those files

**Subsequent runs:** Tokens are loaded from `.tokens.json`, landing directly on the Picker.

### stdio mode

```bash
TRANSPORT=stdio npm start
```

In an MCP client: call `gdrive_authenticate` to get an auth URL, have the user visit it, then pass the code from the redirect URL to `gdrive_set_credentials`.

### Development (hot reload)

```bash
npm run dev
```

Uses `tsx watch` for automatic server restart on file changes.

---

## The `drive.file` Scope and the Picker

This server uses `https://www.googleapis.com/auth/drive.file` — the most restrictive Drive scope:

| Can access | Cannot access |
|---|---|
| Files created by this app | Any other file in the user's Drive |
| Files selected via the Google Picker | Files from other apps |

**The Picker** is the mechanism that grants access to existing files. When a user selects a file through the Picker UI, Google's backend registers that this OAuth client can access it. Subsequent Drive API calls for that file succeed.

**Important implementation detail:** The Picker requires `setAppId` to be set to the Google Cloud project number (the numeric prefix of the Client ID). Without this, file access grants are not registered correctly. The server extracts this automatically from `GOOGLE_CLIENT_ID`.

---

## MCP Tools Reference

> **Note on human-action tools:** `gdrive_authenticate` and `gdrive_open_picker` return URLs that require a human to open in a browser. LLMs cannot click URLs — always relay them to the user.

### Authentication

| Tool | Mode | Description |
|------|------|-------------|
| `gdrive_authenticate` | All | Returns login instructions. In HTTP mode: directs the user to `http://localhost:PORT`. In stdio mode: returns a Google OAuth URL and instructs the user to pass the code to `gdrive_set_credentials`. |
| `gdrive_set_credentials` | stdio only | Exchanges an OAuth code for tokens. **Not needed in HTTP mode** — the browser callback handles this automatically. |

### File Access

| Tool | Description |
|------|-------------|
| `gdrive_open_picker` | Returns the Picker URL (`http://localhost:PORT`). HTTP mode only. The user must open it and select files before those files are accessible to other tools. |

### Read Operations

| Tool | Description |
|------|-------------|
| `gdrive_list_files` | List accessible files. Supports pagination (`page_token`), sorting (`order_by`), and filtering by parent folder. |
| `gdrive_search_files` | Search accessible files by name, with optional MIME type and folder filters. |
| `gdrive_get_file` | Get metadata and optionally text content of a file. Supports Google Docs (plain text), Sheets (CSV), Slides (plain text), and regular text/JSON files. |

### Write Operations

| Tool | Description |
|------|-------------|
| `gdrive_create_file` | Create a new file with optional text content. Created files are immediately accessible without the Picker. |
| `gdrive_create_folder` | Create a new folder. |
| `gdrive_update_file` | Update a file's name, text content, and/or parent folder. |
| `gdrive_copy_file` | Copy a file, optionally renaming it or placing it in a different folder. |
| `gdrive_delete_file` | **Permanently delete** a file. Fetches the name first so the confirmation shows what was removed. |

All list/search tools support `response_format: "markdown"` (default, human-readable) or `"json"` (structured, machine-readable). All tools return `structuredContent` for programmatic access by MCP clients.

---

## Project Structure

```
src/
├── index.ts                  # MCP tool registration, Express routes, transport setup
├── constants.ts              # Shared constants (OAuth scopes, limits, MIME type map)
├── types.ts                  # TypeScript interfaces (FileMetadata, FileListResult, etc.)
├── schemas/
│   ├── input-schemas.ts      # Zod input schemas for all tool parameters
│   └── output-schemas.ts     # Zod output schemas for tool structured responses
├── services/
│   ├── drive-service.ts      # OAuth2 client, token persistence, Drive API wrapper
│   └── utils.ts              # Formatting helpers, error handling, query builder
└── tests/
    └── utils.test.ts         # Unit tests for utility functions
```

**Generated / git-ignored files:**
- `dist/` — compiled JavaScript output
- `.env` — credentials and transport config
- `.tokens.json` — saved OAuth tokens (auto-created after first login)

---

## Running Tests

```bash
npm test
```

Uses Node.js built-in test runner (`node:test`). Tests cover `buildSearchQuery`, `truncateText`, and `formatError` including edge cases like query injection protection and Picker guidance in 404 errors.

---

## Configuring with Claude Desktop

Add to `~/.config/claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "google-drive": {
      "command": "node",
      "args": ["/absolute/path/to/google-drive-mcp-server/dist/index.js"],
      "env": {
        "GOOGLE_CLIENT_ID": "your-client-id.apps.googleusercontent.com",
        "GOOGLE_CLIENT_SECRET": "your-client-secret",
        "TRANSPORT": "stdio"
      }
    }
  }
}
```

---

## Security Notes

- `.env` and `.tokens.json` are both git-ignored — never commit them
- `drive.file` is the least-privileged Drive scope; Google does not require app verification for it
- The server binds only to `localhost` — it is not intended to be exposed to the internet
- OAuth tokens include a refresh token and are reloaded on restart; delete `.tokens.json` to force re-authentication
- MIME type and name values in Drive API search queries are single-quote-escaped to prevent query injection
