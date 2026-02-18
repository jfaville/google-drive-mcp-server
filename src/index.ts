/**
 * Google Drive MCP Server
 * Main entry point with tool registrations
 */

import dotenv from 'dotenv';
dotenv.config();

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import express from "express";
import { z } from "zod";
import { DriveService } from './services/drive-service.js';
import { drive_v3 } from 'googleapis';
import { formatError, formatFileListMarkdown, formatFileMarkdown, truncateText, buildSearchQuery } from './services/utils.js';
import { ResponseFormat, GOOGLE_DOC_EXPORT_MIME_TYPES } from './constants.js';
import {
  ListFilesInputSchema,
  SearchFilesInputSchema,
  GetFileInputSchema,
  CreateFileInputSchema,
  UpdateFileInputSchema,
  DeleteFileInputSchema,
  CopyFileInputSchema,
  CreateFolderInputSchema
} from './schemas/input-schemas.js';
import {
  FileMetadataOutputSchema,
  FileListOutputSchema,
  DeleteOutputSchema
} from './schemas/output-schemas.js';
import type {
  ListFilesInput,
  SearchFilesInput,
  GetFileInput,
  CreateFileInput,
  UpdateFileInput,
  DeleteFileInput,
  CopyFileInput,
  CreateFolderInput
} from './schemas/input-schemas.js';
import { FileMetadata, FileListResult } from './types.js';

// Initialize MCP server
const server = new McpServer({
  name: "google-drive-mcp-server",
  version: "1.0.0"
});

// Initialize Drive service
const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error('Error: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables are required');
  process.exit(1);
}

const port = parseInt(process.env.PORT || '3000');
const isHttpMode = process.env.TRANSPORT === 'http';

// Use appropriate redirect URI based on transport mode
const redirectUri = isHttpMode
  ? `http://localhost:${port}/oauth/callback`
  : 'http://localhost';
const driveService = new DriveService(clientId, clientSecret, redirectUri);

// Extract project number from client ID (e.g. "566896755544-xxx..." → "566896755544")
// Required by Google Picker API to register file access grants under drive.file scope
const appId = clientId.split('-')[0];

// Helper function to ensure authentication
function ensureAuthenticated(): void {
  if (!driveService.isAuthenticated()) {
    throw new Error(
      isHttpMode
        ? 'Not authenticated. Ask the user to visit http://localhost:3000 and sign in with Google.'
        : 'Not authenticated. Call gdrive_authenticate to get an auth URL, then ask the user to visit it and provide the code to gdrive_set_credentials.'
    );
  }
}

/**
 * Tool: gdrive_authenticate
 * Initiate OAuth authentication flow
 */
server.registerTool(
  "gdrive_authenticate",
  {
    title: "Authenticate with Google Drive",
    description: `Initiate OAuth2 authentication to access Google Drive.

⚠️ IMPORTANT: This tool returns a URL or instructions that require HUMAN action. The LLM cannot click URLs or interact with a browser. Always relay the instructions to the user and wait for them to complete the step.

In HTTP mode: Returns a localhost URL for the user to open in their browser. Authentication completes automatically via the OAuth callback — no code entry needed.

In stdio mode: Returns a Google OAuth URL. After the user authorises the app, they must copy the code from the redirect URL and pass it to gdrive_set_credentials.

Returns:
  Instructions and/or URL for the user to complete authentication.

Don't use when: The server is already authenticated (other tools will succeed without re-authenticating).`,
    inputSchema: z.object({}).strict(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  },
  async () => {
    try {
      if (isHttpMode) {
        return {
          content: [{
            type: "text",
            text: `Ask the user to open this URL in their browser to sign in:\n\nhttp://localhost:${port}\n\nThey will be redirected back automatically after authorising — no code entry needed.`
          }]
        };
      } else {
        const authUrl = driveService.getAuthUrl();
        return {
          content: [{
            type: "text",
            text: `Ask the user to open this URL in their browser:\n\n${authUrl}\n\nAfter authorising, they should copy the authorization code from the redirect URL and provide it. Then call gdrive_set_credentials with that code.`
          }]
        };
      }
    } catch (error) {
      return {
        content: [{ type: "text", text: formatError(error) }],
        isError: true
      };
    }
  }
);

/**
 * Tool: gdrive_set_credentials
 * Complete OAuth authentication with authorization code (stdio mode only)
 */
server.registerTool(
  "gdrive_set_credentials",
  {
    title: "Set Google Drive Credentials",
    description: `Complete OAuth2 authentication by exchanging an authorization code for tokens.

⚠️ stdio mode only. In HTTP mode, authentication completes automatically via the browser OAuth callback at /oauth/callback — this tool is not needed and will not work.

Args:
  - code (string): The authorization code extracted from the redirect URL after the user authorised the app via gdrive_authenticate.

Returns:
  Confirmation that authentication succeeded.

Don't use when: Running in HTTP mode (TRANSPORT=http). Use gdrive_authenticate to direct the user to the browser flow instead.`,
    inputSchema: z.object({
      code: z.string().min(1).describe('Authorization code from the OAuth redirect URL')
    }).strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  async ({ code }: { code: string }) => {
    try {
      await driveService.setCredentials(code);
      
      return {
        content: [{
          type: "text",
          text: 'Successfully authenticated with Google Drive! You can now use other Google Drive tools.'
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: formatError(error)
        }],
        isError: true
      };
    }
  }
);

/**
 * Tool: gdrive_list_files
 * List files accessible with drive.file scope
 */
server.registerTool(
  "gdrive_list_files",
  {
    title: "List Google Drive Files",
    description: `List files and folders accessible to this app in Google Drive.

Due to the drive.file scope, only files created by this app or explicitly opened via the Picker are returned. This is not a full Drive listing.

Args:
  - parent_id (string, optional): Limit results to files inside this folder ID
  - page_size (number, optional): Number of results (1-100, default: 20)
  - page_token (string, optional): Pagination token from a previous response's next_page_token
  - order_by (string, optional): Sort order (e.g., "name", "modifiedTime desc", "createdTime")
  - response_format ('markdown' | 'json', optional): Output format (default: markdown)

Returns:
  { total, count, files: [{ id, name, mimeType, size, createdTime, modifiedTime, webViewLink, ... }], has_more, next_page_token }

Examples:
  - List all accessible files: {}
  - List files in a folder: { parent_id: "abc123" }
  - Get next page: { page_token: "token_from_previous" }

Don't use when: You need to search by name — use gdrive_search_files instead. Don't use when you expect to see files the user hasn't yet opened via the Picker.`,
    inputSchema: ListFilesInputSchema,
    outputSchema: FileListOutputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  async (params: ListFilesInput) => {
    try {
      ensureAuthenticated();
      const drive = driveService.getDrive();
      
      const query = buildSearchQuery({
        parent_id: params.parent_id,
        trashed: false
      });
      
      const response = await drive.files.list({
        q: query,
        pageSize: params.page_size,
        pageToken: params.page_token,
        orderBy: params.order_by,
        fields: 'nextPageToken, files(id, name, mimeType, size, createdTime, modifiedTime, webViewLink, parents, description, starred)'
      });
      
      const files: FileMetadata[] = (response.data.files || []).map(file => ({
        id: file.id!,
        name: file.name!,
        mimeType: file.mimeType!,
        createdTime: file.createdTime || undefined,
        modifiedTime: file.modifiedTime || undefined,
        size: file.size || undefined,
        webViewLink: file.webViewLink || undefined,
        parents: file.parents || undefined,
        description: file.description || undefined,
        starred: file.starred || undefined
      }));
      
      const result: FileListResult = {
        total: files.length,
        count: files.length,
        files,
        has_more: !!response.data.nextPageToken,
        // Drive API uses opaque cursor tokens, not numeric offsets.
        // Pass this value as page_token on the next call to get the next page.
        next_page_token: response.data.nextPageToken || undefined
      };
      
      const text = params.response_format === ResponseFormat.JSON
        ? JSON.stringify(result, null, 2)
        : formatFileListMarkdown(result);
      return {
        content: [{ type: "text", text }],
        structuredContent: result
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: formatError(error) }],
        isError: true
      };
    }
  }
);

/**
 * Tool: gdrive_search_files
 * Search for files by name
 */
server.registerTool(
  "gdrive_search_files",
  {
    title: "Search Google Drive Files",
    description: `Search accessible Google Drive files by name, with optional MIME type and folder filters.

Due to the drive.file scope, results are limited to files this app created or that the user explicitly opened via the Picker.

Args:
  - query (string): Name search string (partial matches supported)
  - mime_type (string, optional): Filter by MIME type (e.g., "application/vnd.google-apps.document", "application/vnd.google-apps.folder")
  - parent_id (string, optional): Limit search to files inside this folder ID
  - page_size (number, optional): Number of results (1-100, default: 20)
  - page_token (string, optional): Pagination token from a previous response's next_page_token
  - response_format ('markdown' | 'json', optional): Output format (default: markdown)

Returns:
  { total, count, files: [{ id, name, mimeType, size, modifiedTime, webViewLink, ... }], has_more, next_page_token }

Examples:
  - Find documents named "report": { query: "report", mime_type: "application/vnd.google-apps.document" }
  - Find all folders: { query: "project", mime_type: "application/vnd.google-apps.folder" }
  - Search within a folder: { query: "data", parent_id: "abc123" }

Don't use when: You want to list all files without filtering — use gdrive_list_files instead. Don't expect results for files not yet opened via the Picker.`,
    inputSchema: SearchFilesInputSchema,
    outputSchema: FileListOutputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  async (params: SearchFilesInput) => {
    try {
      ensureAuthenticated();
      const drive = driveService.getDrive();
      
      const query = buildSearchQuery({
        query: params.query,
        mime_type: params.mime_type,
        parent_id: params.parent_id,
        trashed: false
      });
      
      const response = await drive.files.list({
        q: query,
        pageSize: params.page_size,
        pageToken: params.page_token,
        fields: 'nextPageToken, files(id, name, mimeType, size, createdTime, modifiedTime, webViewLink, parents, description, starred)'
      });

      const files: FileMetadata[] = (response.data.files || []).map(file => ({
        id: file.id!,
        name: file.name!,
        mimeType: file.mimeType!,
        createdTime: file.createdTime || undefined,
        modifiedTime: file.modifiedTime || undefined,
        size: file.size || undefined,
        webViewLink: file.webViewLink || undefined,
        parents: file.parents || undefined,
        description: file.description || undefined,
        starred: file.starred || undefined
      }));
      
      const result: FileListResult = {
        total: files.length,
        count: files.length,
        files,
        has_more: !!response.data.nextPageToken,
        // Drive API uses opaque cursor tokens, not numeric offsets.
        // Pass this value as page_token on the next call to get the next page.
        next_page_token: response.data.nextPageToken || undefined
      };

      const text = params.response_format === ResponseFormat.JSON
        ? JSON.stringify(result, null, 2)
        : formatFileListMarkdown(result);
      return {
        content: [{ type: "text", text }],
        structuredContent: result
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: formatError(error) }],
        isError: true
      };
    }
  }
);

/**
 * Tool: gdrive_get_file
 * Get file metadata and optionally content
 */
server.registerTool(
  "gdrive_get_file",
  {
    title: "Get Google Drive File",
    description: `Retrieve metadata and optionally text content of a Google Drive file.

Supports Google Workspace files (Docs exported as plain text, Sheets as CSV, Slides as plain text) and regular text/JSON files. Binary files (images, PDFs, etc.) return metadata only.

Args:
  - file_id (string): The Drive file ID (visible in the file URL or from list/search results)
  - include_content (boolean, optional): Fetch and return text content (default: false)
  - response_format ('markdown' | 'json', optional): Output format (default: markdown)

Returns:
  { id, name, mimeType, size, createdTime, modifiedTime, webViewLink, parents, description, starred, content? }

Examples:
  - Get metadata only: { file_id: "abc123" }
  - Get a Google Doc's text: { file_id: "abc123", include_content: true }
  - Get JSON response: { file_id: "abc123", include_content: true, response_format: "json" }

Don't use when: The file hasn't been opened via the Picker — you'll get a 404 error. Use gdrive_open_picker to grant access first. Don't use for listing multiple files — use gdrive_list_files or gdrive_search_files instead.`,
    inputSchema: GetFileInputSchema,
    outputSchema: FileMetadataOutputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  async (params: GetFileInput) => {
    try {
      ensureAuthenticated();
      const drive = driveService.getDrive();
      
      const response = await drive.files.get({
        fileId: params.file_id,
        fields: 'id, name, mimeType, size, createdTime, modifiedTime, webViewLink, parents, description, starred'
      });
      
      const file: FileMetadata = {
        id: response.data.id!,
        name: response.data.name!,
        mimeType: response.data.mimeType!,
        createdTime: response.data.createdTime || undefined,
        modifiedTime: response.data.modifiedTime || undefined,
        size: response.data.size || undefined,
        webViewLink: response.data.webViewLink || undefined,
        parents: response.data.parents || undefined,
        description: response.data.description || undefined,
        starred: response.data.starred || undefined
      };
      
      let content: string | undefined;
      
      if (params.include_content) {
        const mimeType = response.data.mimeType!;
        
        // Check if it's a Google Workspace doc that needs export
        if (mimeType in GOOGLE_DOC_EXPORT_MIME_TYPES) {
          const exportMimeType = GOOGLE_DOC_EXPORT_MIME_TYPES[mimeType as keyof typeof GOOGLE_DOC_EXPORT_MIME_TYPES];
          const exportResponse = await drive.files.export({
            fileId: params.file_id,
            mimeType: exportMimeType
          }, { responseType: 'text' });
          content = exportResponse.data as string;
        } else if (mimeType.startsWith('text/') || mimeType.includes('json')) {
          // Regular text file
          const downloadResponse = await drive.files.get({
            fileId: params.file_id,
            alt: 'media'
          }, { responseType: 'text' });
          content = downloadResponse.data as string;
        }
        
        if (content) {
          content = truncateText(content);
        }
      }
      
      const structured = content ? { ...file, content } : file;
      let text: string;
      if (params.response_format === ResponseFormat.JSON) {
        text = JSON.stringify(structured, null, 2);
      } else {
        text = formatFileMarkdown(file);
        if (content) text += `\n\n## Content\n\n${content}`;
      }
      return {
        content: [{ type: "text", text }],
        structuredContent: structured
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: formatError(error) }],
        isError: true
      };
    }
  }
);

/**
 * Tool: gdrive_create_file
 * Create a new file in Google Drive
 */
server.registerTool(
  "gdrive_create_file",
  {
    title: "Create Google Drive File",
    description: `Create a new file in Google Drive. The created file is automatically accessible under the drive.file scope — no Picker step needed.

Args:
  - name (string): File name (1-255 characters)
  - mime_type (string, optional): MIME type (default: "text/plain")
  - parent_id (string, optional): ID of parent folder; omit to create in Drive root
  - content (string, optional): Text content to write into the file

Returns:
  { id, name, mimeType, modifiedTime, webViewLink }

Examples:
  - Create a plain text file: { name: "notes.txt", content: "Hello world" }
  - Create in a specific folder: { name: "report.txt", parent_id: "abc123", content: "..." }
  - Create an empty Google Doc: { name: "My Doc", mime_type: "application/vnd.google-apps.document" }

Don't use when: The file already exists and should be updated — use gdrive_update_file instead. Don't use when creating a folder — use gdrive_create_folder instead.`,
    inputSchema: CreateFileInputSchema,
    outputSchema: FileMetadataOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    }
  },
  async (params: CreateFileInput) => {
    try {
      ensureAuthenticated();
      const drive = driveService.getDrive();
      
      const fileMetadata: drive_v3.Schema$File = {
        name: params.name,
        mimeType: params.mime_type
      };
      
      if (params.parent_id) {
        fileMetadata.parents = [params.parent_id];
      }
      
      const media = params.content ? {
        mimeType: params.mime_type,
        body: params.content
      } : undefined;
      
      const response = await drive.files.create({
        requestBody: fileMetadata,
        media,
        fields: 'id, name, mimeType, webViewLink, createdTime'
      });
      
      const file: FileMetadata = {
        id: response.data.id!,
        name: response.data.name!,
        mimeType: response.data.mimeType!,
        webViewLink: response.data.webViewLink || undefined,
        createdTime: response.data.createdTime || undefined
      };
      
      return {
        content: [{ type: "text", text: `Successfully created file: ${file.name}\nID: ${file.id}\nLink: ${file.webViewLink || 'N/A'}` }],
        structuredContent: file
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: formatError(error) }],
        isError: true
      };
    }
  }
);

/**
 * Tool: gdrive_create_folder
 * Create a new folder in Google Drive
 */
server.registerTool(
  "gdrive_create_folder",
  {
    title: "Create Google Drive Folder",
    description: `Create a new folder in Google Drive. The folder is immediately accessible under the drive.file scope.

Args:
  - name (string): Folder name (1-255 characters)
  - parent_id (string, optional): ID of parent folder; omit to create in Drive root

Returns:
  { id, name, mimeType, webViewLink, createdTime }

Examples:
  - Create a top-level folder: { name: "My Project" }
  - Create a nested folder: { name: "Archive", parent_id: "abc123" }

Don't use when: Creating a file — use gdrive_create_file instead.`,
    inputSchema: CreateFolderInputSchema,
    outputSchema: FileMetadataOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    }
  },
  async (params: CreateFolderInput) => {
    try {
      ensureAuthenticated();
      const drive = driveService.getDrive();
      
      const fileMetadata: drive_v3.Schema$File = {
        name: params.name,
        mimeType: 'application/vnd.google-apps.folder'
      };
      
      if (params.parent_id) {
        fileMetadata.parents = [params.parent_id];
      }
      
      const response = await drive.files.create({
        requestBody: fileMetadata,
        fields: 'id, name, mimeType, webViewLink, createdTime'
      });
      
      const folder: FileMetadata = {
        id: response.data.id!,
        name: response.data.name!,
        mimeType: response.data.mimeType!,
        webViewLink: response.data.webViewLink || undefined,
        createdTime: response.data.createdTime || undefined
      };
      
      return {
        content: [{ type: "text", text: `Successfully created folder: ${folder.name}\nID: ${folder.id}\nLink: ${folder.webViewLink || 'N/A'}` }],
        structuredContent: folder
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: formatError(error) }],
        isError: true
      };
    }
  }
);

/**
 * Tool: gdrive_update_file
 * Update an existing file
 */
server.registerTool(
  "gdrive_update_file",
  {
    title: "Update Google Drive File",
    description: `Update an existing file's name, text content, or parent folder(s).

The file must have been created by this app or previously opened via the Picker.

Args:
  - file_id (string): ID of the file to update
  - name (string, optional): New file name
  - content (string, optional): New text content (replaces existing content entirely)
  - add_parents (array of strings, optional): IDs of folders to add the file to
  - remove_parents (array of strings, optional): IDs of folders to remove the file from

Returns:
  { id, name, mimeType, modifiedTime, webViewLink }

Examples:
  - Rename a file: { file_id: "abc123", name: "new-name.txt" }
  - Update content: { file_id: "abc123", content: "Updated text" }
  - Move to folder: { file_id: "abc123", add_parents: ["folder_id"], remove_parents: ["old_folder_id"] }

Don't use when: The file doesn't exist yet — use gdrive_create_file instead.`,
    inputSchema: UpdateFileInputSchema,
    outputSchema: FileMetadataOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  async (params: UpdateFileInput) => {
    try {
      ensureAuthenticated();
      const drive = driveService.getDrive();
      
      const metadata: drive_v3.Schema$File = {};
      if (params.name) {
        metadata.name = params.name;
      }

      const media = params.content ? {
        mimeType: 'text/plain',
        body: params.content
      } : undefined;
      
      const response = await drive.files.update({
        fileId: params.file_id,
        requestBody: metadata,
        media,
        addParents: params.add_parents?.join(','),
        removeParents: params.remove_parents?.join(','),
        fields: 'id, name, mimeType, modifiedTime, webViewLink'
      });
      
      const file: FileMetadata = {
        id: response.data.id!,
        name: response.data.name!,
        mimeType: response.data.mimeType!,
        modifiedTime: response.data.modifiedTime || undefined,
        webViewLink: response.data.webViewLink || undefined
      };
      
      return {
        content: [{ type: "text", text: `Successfully updated file: ${file.name}\nID: ${file.id}` }],
        structuredContent: file
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: formatError(error) }],
        isError: true
      };
    }
  }
);

/**
 * Tool: gdrive_delete_file
 * Delete a file
 */
server.registerTool(
  "gdrive_delete_file",
  {
    title: "Delete Google Drive File",
    description: `Permanently delete a file or folder from Google Drive. This cannot be undone.

The file must have been created by this app or previously opened via the Picker.

Args:
  - file_id (string): ID of the file or folder to delete

Returns:
  { id, name } of the deleted file, confirming what was removed

Examples:
  - Delete a file: { file_id: "abc123" }

Don't use when: You want to move a file to trash instead of permanently deleting it (the Drive API does not support trashing via drive.file scope without additional permissions). Double-check the file ID before calling — deletion is permanent.`,
    inputSchema: DeleteFileInputSchema,
    outputSchema: DeleteOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  async (params: DeleteFileInput) => {
    try {
      ensureAuthenticated();
      const drive = driveService.getDrive();
      
      // Fetch name before deletion so we can confirm what was removed
      const { data: fileMeta } = await drive.files.get({ fileId: params.file_id, fields: 'name' });
      await drive.files.delete({ fileId: params.file_id });
      const deleted = { id: params.file_id, name: fileMeta.name! };
      return {
        content: [{ type: "text", text: `Successfully deleted "${deleted.name}" (ID: ${deleted.id})` }],
        structuredContent: deleted
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: formatError(error) }],
        isError: true
      };
    }
  }
);

/**
 * Tool: gdrive_copy_file
 * Copy a file
 */
server.registerTool(
  "gdrive_copy_file",
  {
    title: "Copy Google Drive File",
    description: `Create a copy of an existing Google Drive file. The copy is immediately accessible under the drive.file scope.

Args:
  - file_id (string): ID of the file to copy
  - name (string, optional): Name for the copy (default: "Copy of [original name]")
  - parent_id (string, optional): ID of the folder to place the copy in; omit to copy to Drive root

Returns:
  { id, name, mimeType, webViewLink, createdTime } of the new copy

Examples:
  - Duplicate a file: { file_id: "abc123" }
  - Copy and rename: { file_id: "abc123", name: "Backup of Report" }
  - Copy into a folder: { file_id: "abc123", parent_id: "folder456" }

Don't use when: You want to move a file — use gdrive_update_file with add_parents/remove_parents instead.`,
    inputSchema: CopyFileInputSchema,
    outputSchema: FileMetadataOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    }
  },
  async (params: CopyFileInput) => {
    try {
      ensureAuthenticated();
      const drive = driveService.getDrive();
      
      const metadata: drive_v3.Schema$File = {};
      if (params.name) {
        metadata.name = params.name;
      }
      if (params.parent_id) {
        metadata.parents = [params.parent_id];
      }
      
      const response = await drive.files.copy({
        fileId: params.file_id,
        requestBody: metadata,
        fields: 'id, name, mimeType, webViewLink, createdTime'
      });
      
      const file: FileMetadata = {
        id: response.data.id!,
        name: response.data.name!,
        mimeType: response.data.mimeType!,
        webViewLink: response.data.webViewLink || undefined,
        createdTime: response.data.createdTime || undefined
      };
      
      return {
        content: [{ type: "text", text: `Successfully copied file: ${file.name}\nNew ID: ${file.id}\nLink: ${file.webViewLink || 'N/A'}` }],
        structuredContent: file
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: formatError(error) }],
        isError: true
      };
    }
  }
);

/**
 * Tool: gdrive_open_picker
 * Open Google Picker to select files for access
 */
server.registerTool(
  "gdrive_open_picker",
  {
    title: "Open Google Drive Picker",
    description: `Returns the URL of the Google Drive file Picker web UI. The user must open this URL in their browser, select files, and confirm — after which those files become accessible to all MCP tools under the drive.file scope.

⚠️ HTTP mode only. In stdio mode (TRANSPORT=stdio) there is no web server and the Picker URL will not work.

⚠️ Requires HUMAN action. The LLM cannot open URLs. Always relay the URL to the user.

Args:
  None

Returns:
  URL of the Picker page (http://localhost:PORT)

Don't use when: Running in stdio mode. Don't use when the file was already selected previously and should still be accessible — try gdrive_get_file first.`,
    inputSchema: z.object({}),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  async () => {
    try {
      if (!isHttpMode) {
        return {
          content: [{ type: "text", text: "Error: The Google Picker is only available in HTTP mode (TRANSPORT=http). In stdio mode, files can only be accessed if they were created by this app." }],
          isError: true
        };
      }
      ensureAuthenticated();
      return {
        content: [{
          type: "text",
          text: `Ask the user to open this URL in their browser to select files:\n\nhttp://localhost:${port}\n\nAfter they select files and see the confirmation, those files will be accessible via gdrive_get_file, gdrive_search_files, and other tools.`
        }]
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: formatError(error) }],
        isError: true
      };
    }
  }
);

// Transport setup functions
async function runStdio() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Google Drive MCP server running on stdio');
}

async function runHTTP() {
  const app = express();
  app.use(express.json());

  // Landing page / Picker page (combined)
  app.get('/', (req, res) => {
    const isAuthenticated = driveService.isAuthenticated();

    if (!isAuthenticated) {
      // Show login page
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Google Drive MCP</title>
          <meta charset="utf-8">
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 20px;
            }
            .card {
              background: white;
              border-radius: 12px;
              padding: 40px;
              max-width: 400px;
              box-shadow: 0 10px 40px rgba(0,0,0,0.2);
              text-align: center;
            }
            h1 { color: #1a73e8; margin-bottom: 30px; }
            .btn {
              display: inline-block;
              background: #1a73e8;
              color: white;
              text-decoration: none;
              padding: 16px 32px;
              border-radius: 8px;
              font-weight: 600;
              transition: all 0.3s;
            }
            .btn:hover { background: #1557b0; transform: translateY(-2px); }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>🗂️ Google Drive MCP</h1>
            <a href="${driveService.getAuthUrl()}" class="btn">Sign in with Google</a>
          </div>
        </body>
        </html>
      `);
      return;
    }

    // Show picker page
    const accessToken = driveService.getAccessToken();
    const clientId = driveService.getClientId();

    res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>Google Drive Picker</title>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 40px 20px;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
    }
    .card {
      background: white;
      border-radius: 12px;
      padding: 30px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.2);
      margin-bottom: 20px;
    }
    h1 { color: #1a73e8; margin-bottom: 20px; }
    .btn {
      background: #1a73e8;
      color: white;
      border: none;
      padding: 14px 28px;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s;
    }
    .btn:hover { background: #1557b0; transform: translateY(-2px); }
    .btn:disabled { background: #ccc; cursor: not-allowed; transform: none; }
    #status {
      padding: 12px;
      border-radius: 8px;
      margin-bottom: 20px;
      font-weight: 500;
    }
    .success { background: #d4edda; color: #155724; }
    .error { background: #f8d7da; color: #721c24; }
    .info { background: #cfe2ff; color: #084298; }
    #fileList {
      list-style: none;
      margin-top: 20px;
    }
    #fileList li {
      padding: 12px;
      margin: 8px 0;
      background: #f8f9fa;
      border-radius: 8px;
      border-left: 4px solid #1a73e8;
    }
    #fileList strong { display: block; margin-bottom: 4px; }
    #fileList small { color: #666; }
  </style>
  <script src="https://apis.google.com/js/api.js"></script>
  <script>
    const CLIENT_ID = '${clientId}';
    const ACCESS_TOKEN = '${accessToken}';
    let pickerApiLoaded = false;

    function onApiLoad() {
      gapi.load('picker', () => {
        pickerApiLoaded = true;
        document.getElementById('openPicker').disabled = false;
        setStatus('Ready! Click the button to select files.', 'info');
      });
    }

    function openPicker() {
      if (!pickerApiLoaded) return;

      const picker = new google.picker.PickerBuilder()
        .setAppId('${appId}')
        .addView(google.picker.ViewId.DOCS)
        .setOAuthToken(ACCESS_TOKEN)
        .setCallback(pickerCallback)
        .build();

      picker.setVisible(true);
    }

    async function pickerCallback(data) {
      if (data.action === google.picker.Action.PICKED) {
        const files = data.docs;
        displayFiles(files);
        setStatus('Processing...', 'info');

        // Send file IDs to server to grant access
        try {
          const fileIds = files.map(f => f.id);
          const response = await fetch('/api/open-files', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileIds })
          });

          const result = await response.json();
          if (result.success) {
            setStatus(\`✓ \${files.length} file(s) now accessible via MCP server!\`, 'success');
          } else {
            setStatus('⚠ ' + (result.error || 'Failed to open files'), 'error');
          }
        } catch (error) {
          setStatus('⚠ Error: ' + error.message, 'error');
        }
      }
    }

    function displayFiles(files) {
      const list = document.getElementById('fileList');
      list.innerHTML = '';
      files.forEach(file => {
        const li = document.createElement('li');
        li.innerHTML = \`<strong>\${file.name}</strong><small>ID: \${file.id}</small>\`;
        list.appendChild(li);
      });
    }

    function setStatus(message, type = '') {
      const status = document.getElementById('status');
      status.textContent = message;
      status.className = type;
    }

    window.onload = onApiLoad;
  </script>
</head>
<body>
  <div class="container">
    <div class="card">
      <h1>🗂️ Select Files</h1>
      <p style="color: #666; margin-bottom: 20px;">Choose files from your Google Drive to access via the MCP server. Selected files will be available to all MCP tools.</p>
      <div id="status">Loading...</div>
      <button id="openPicker" onclick="openPicker()" disabled class="btn">
        Select Files from Google Drive
      </button>
      <ul id="fileList"></ul>
    </div>
  </div>
</body>
</html>
    `);
  });

  // OAuth callback handler
  app.get('/oauth/callback', async (req, res) => {
    const code = req.query.code as string;
    const error = req.query.error as string;

    if (error) {
      res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Authentication Error</title></head>
        <body style="font-family: Arial; max-width: 600px; margin: 50px auto; padding: 20px;">
          <h1 style="color: #d32f2f;">❌ Authentication Failed</h1>
          <p>Error: ${error}</p>
          <p>You can close this window and try again.</p>
        </body>
        </html>
      `);
      return;
    }

    if (!code) {
      res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Authentication Error</title></head>
        <body style="font-family: Arial; max-width: 600px; margin: 50px auto; padding: 20px;">
          <h1 style="color: #d32f2f;">❌ No Authorization Code</h1>
          <p>No authorization code received. Please try again.</p>
        </body>
        </html>
      `);
      return;
    }

    try {
      await driveService.setCredentials(code);
      res.redirect('/?authenticated=true');
    } catch (error: any) {
      res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Authentication Error</title></head>
        <body style="font-family: Arial; max-width: 600px; margin: 50px auto; padding: 20px;">
          <h1 style="color: #d32f2f;">❌ Authentication Error</h1>
          <p>${error.message || 'Unknown error occurred'}</p>
          <p>Please try authenticating again.</p>
        </body>
        </html>
      `);
    }
  });

  // API endpoint to "open" files selected via Picker
  app.post('/api/open-files', async (req, res) => {
    try {
      const { fileIds } = req.body;

      if (!Array.isArray(fileIds) || fileIds.length === 0) {
        res.json({ success: false, error: 'No file IDs provided' });
        return;
      }

      const drive = driveService.getDrive();
      const results = [];

      // Make a metadata request for each file to "open" it and grant access
      for (const fileId of fileIds) {
        try {
          const result = await drive.files.get({
            fileId,
            fields: 'id,name,mimeType',
            supportsAllDrives: true
          });
          console.error(`Opened file: ${result.data.name} (${fileId})`);
          results.push({ fileId, success: true });
        } catch (error: any) {
          console.error(`Failed to open file ${fileId}: HTTP ${error?.response?.status} - ${error.message}`);
          results.push({ fileId, success: false, error: error.message });
        }
      }

      const allSucceeded = results.every(r => r.success);
      res.json({
        success: allSucceeded,
        results,
        message: allSucceeded
          ? `Successfully opened ${fileIds.length} file(s)`
          : 'Some files could not be accessed'
      });
    } catch (error: any) {
      res.json({ success: false, error: error.message });
    }
  });

  app.post('/mcp', async (req, res) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });
    res.on('close', () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.listen(port, () => {
    console.error(`Google Drive MCP server running on http://localhost:${port}/mcp`);
  });
}

// Choose transport based on environment
const transport = process.env.TRANSPORT || 'stdio';
if (transport === 'http') {
  runHTTP().catch(error => {
    console.error("Server error:", error);
    process.exit(1);
  });
} else {
  runStdio().catch(error => {
    console.error("Server error:", error);
    process.exit(1);
  });
}
