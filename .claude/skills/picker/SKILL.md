---
name: picker
description: Start the Google Drive Picker so the user can grant the MCP server access to existing Drive files. Use when the user needs to open a file via the Picker.
allowed-tools: Read, Bash
---

# Google Drive Picker

Grant the GDrive MCP server access to existing Google Drive files by running the HTTP instance with the Picker UI.

## Steps

1. Read the project's `.mcp.json` to get `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` from the google-drive server's `env` block.

2. Locate the server entry point (`dist/index.js`) — either from the `args` in `.mcp.json` or relative to this repo's root.

3. Start the HTTP server in the background:
```
GOOGLE_CLIENT_ID="<value>" GOOGLE_CLIENT_SECRET="<value>" TRANSPORT=http PORT=3000 node <path-to-dist/index.js>
```

4. Tell the user to open `http://localhost:3000` in their browser and select files via the Picker.

5. Wait for the user to confirm they're done.

6. Stop the background server.

7. Optionally verify access by listing recent files with `gdrive_list_files`.
