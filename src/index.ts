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
import { formatError, formatFileListMarkdown, formatFileMarkdown, truncateText, buildSearchQuery, escapeHtml } from './services/utils.js';
import { ResponseFormat, GOOGLE_DOC_EXPORT_MIME_TYPES } from './constants.js';

/** Escape a string for safe interpolation into HTML. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Build comment/reply content with optional prefix and anchor quote.
 * Controlled by env vars COMMENT_PREFIX and COMMENT_SHOW_ANCHOR_QUOTE.
 */
function buildCommentContent(content: string, quotedText?: string): string {
  const prefix = process.env.COMMENT_PREFIX;
  const showAnchor = process.env.COMMENT_SHOW_ANCHOR_QUOTE === 'true';

  const parts: string[] = [];
  if (prefix) parts.push(prefix);
  if (showAnchor && quotedText) parts.push(`_Re: '${quotedText.trim()}'_`);
  parts.push(content);

  return parts.join('\n\n');
}
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
import { DocsService } from './services/docs-service.js';
import {
  GetDocumentInputSchema,
  ListTabsInputSchema,
  CreateDocumentInputSchema,
  InsertTextInputSchema,
  DeleteRangeInputSchema,
  UpdateTextStyleInputSchema,
  UpdateParagraphStyleInputSchema,
  ReplaceAllTextInputSchema,
  BatchUpdateInputSchema
} from './schemas/docs-input-schemas.js';
import {
  DocumentMetadataOutputSchema,
  BatchUpdateResultOutputSchema,
  ReplaceAllResultOutputSchema
} from './schemas/docs-output-schemas.js';
import type {
  GetDocumentInput,
  ListTabsInput,
  CreateDocumentInput,
  InsertTextInput,
  DeleteRangeInput,
  UpdateTextStyleInput,
  UpdateParagraphStyleInput,
  ReplaceAllTextInput,
  BatchUpdateInput
} from './schemas/docs-input-schemas.js';
import {
  simplifyDocument,
  formatDocumentMarkdown,
  buildTextStyle,
  truncateDocContent
} from './services/docs-utils.js';
import type { SimplifiedDocument, BatchUpdateResult, ReplaceAllResult } from './services/docs-utils.js';
import {
  ListCommentsInputSchema,
  GetCommentInputSchema,
  AddCommentInputSchema,
  UpdateCommentInputSchema,
  DeleteCommentInputSchema as DeleteCommentInputSchemaComments,
  ReplyToCommentInputSchema,
  ResolveCommentInputSchema,
  ListRepliesInputSchema,
} from './schemas/comments-input-schemas.js';
import type {
  ListCommentsInput,
  GetCommentInput,
  AddCommentInput,
  UpdateCommentInput,
  DeleteCommentInput as DeleteCommentInputType,
  ReplyToCommentInput,
  ResolveCommentInput,
  ListRepliesInput,
} from './schemas/comments-input-schemas.js';
import {
  CommentDetailOutputSchema,
  CommentListOutputSchema,
  ReplyDetailOutputSchema,
  ReplyListOutputSchema,
  DeleteCommentOutputSchema,
} from './schemas/comments-output-schemas.js';
import {
  mapComment,
  mapReply,
  formatCommentMarkdown,
  formatCommentListMarkdown,
  extractTextFromDocBody,
  buildCommentAnchor,
} from './services/comments-utils.js';
import type { CommentData, CommentListResult, ReplyListResult } from './services/comments-utils.js';
import {
  InsertTableInputSchema,
  InsertPageBreakInputSchema,
  InsertImageInputSchema,
} from './schemas/additional-docs-input-schemas.js';
import type {
  InsertTableInput,
  InsertPageBreakInput,
  InsertImageInput,
} from './schemas/additional-docs-input-schemas.js';

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
const docsService = new DocsService(driveService.getOAuth2Client());

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

// ============================================================
// Google Docs API Tools
// ============================================================

/**
 * Tool: gdocs_get_document
 * Get document metadata and optionally structured content
 */
server.registerTool(
  "gdocs_get_document",
  {
    title: "Get Google Doc",
    description: `Retrieve metadata and optionally the full structured content of a Google Doc, including text, formatting (bold, italic, etc.), heading styles, and character indices.

Args:
  - document_id (string): The Google Doc ID
  - include_content (boolean, optional): Include full body with formatting info (default: false)
  - suggestions_view_mode (string, optional): How to render suggestions — one of: SUGGESTIONS_INLINE (default, required for correct character indices), PREVIEW_SUGGESTIONS_ACCEPTED, PREVIEW_WITHOUT_SUGGESTIONS
  - response_format ('markdown' | 'json', optional): Output format (default: markdown)

Returns:
  { documentId, title, revisionId, body?: { content: [{ startIndex, endIndex, text, namedStyleType?, elements: [{ content, startIndex, endIndex, bold?, italic?, ... }] }] } }

The body includes character indices for every paragraph and text run — use these indices with gdocs_insert_text, gdocs_delete_range, and gdocs_update_text_style.

Important: If the document contains suggestions (tracked changes), use suggestions_view_mode to control how they appear. SUGGESTIONS_INLINE is the only mode that returns correct character indices for subsequent batchUpdate operations.

Don't use when: The doc hasn't been opened via the Picker or created by this app — you'll get a 403/404.`,
    inputSchema: GetDocumentInputSchema,
    outputSchema: DocumentMetadataOutputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  async (params: GetDocumentInput) => {
    try {
      ensureAuthenticated();
      const docs = docsService.getDocs();

      const getParams: any = { documentId: params.document_id, includeTabsContent: true };
      if (params.suggestions_view_mode) {
        getParams.suggestionsViewMode = params.suggestions_view_mode;
      }
      const response = await docs.documents.get(getParams);

      const simplified = simplifyDocument(response.data, params.include_content, params.tab_id);

      let text: string;
      if (params.response_format === ResponseFormat.JSON) {
        text = truncateDocContent(JSON.stringify(simplified, null, 2));
      } else {
        text = truncateDocContent(formatDocumentMarkdown(simplified));
      }

      return {
        content: [{ type: "text", text }],
        structuredContent: simplified
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
 * Tool: gdocs_list_tabs
 * List all tabs in a Google Doc
 */
server.registerTool(
  "gdocs_list_tabs",
  {
    title: "List Tabs in Google Doc",
    description: `List all tabs in a Google Doc, including their IDs, titles, and nesting structure.

Args:
  - document_id (string): The Google Doc ID
  - response_format ('markdown' | 'json', optional): Output format (default: markdown)

Returns:
  { documentId, title, tabs: [{ tabId, title, index, childTabs? }] }

Use tab IDs from this tool to target specific tabs in other gdocs tools.

Don't use when: The doc hasn't been opened via the Picker or created by this app — you'll get a 403/404.`,
    inputSchema: ListTabsInputSchema,
    outputSchema: DocumentMetadataOutputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  async (params: ListTabsInput) => {
    try {
      ensureAuthenticated();
      const docs = docsService.getDocs();

      const response = await docs.documents.get({
        documentId: params.document_id,
        includeTabsContent: true
      });

      const simplified = simplifyDocument(response.data, false);

      let text: string;
      if (params.response_format === ResponseFormat.JSON) {
        text = JSON.stringify({ documentId: simplified.documentId, title: simplified.title, tabs: simplified.tabs }, null, 2);
      } else {
        const parts: string[] = [`**${simplified.title}**`, `- Document ID: \`${simplified.documentId}\``, '', '## Tabs', ''];
        const formatTab = (tab: any, depth: number) => {
          const indent = '  '.repeat(depth);
          parts.push(`${indent}- **${tab.title}** (ID: \`${tab.tabId}\`, index: ${tab.index})`);
          if (tab.childTabs) {
            for (const child of tab.childTabs) formatTab(child, depth + 1);
          }
        };
        for (const tab of simplified.tabs || []) formatTab(tab, 0);
        text = parts.join('\n');
      }

      return {
        content: [{ type: "text", text }],
        structuredContent: { documentId: simplified.documentId, title: simplified.title, tabs: simplified.tabs }
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
 * Tool: gdocs_create_document
 * Create a new Google Doc
 */
server.registerTool(
  "gdocs_create_document",
  {
    title: "Create Google Doc",
    description: `Create a new Google Doc with a title and optional initial text content.

Args:
  - title (string): Document title (1-255 characters)
  - content (string, optional): Initial text to insert into the document body

Returns:
  { documentId, title, revisionId }

The created document is automatically accessible under the drive.file scope — no Picker step needed.

Don't use when: The document already exists — use gdocs_insert_text or gdocs_replace_all_text instead.`,
    inputSchema: CreateDocumentInputSchema,
    outputSchema: DocumentMetadataOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    }
  },
  async (params: CreateDocumentInput) => {
    try {
      ensureAuthenticated();
      const docs = docsService.getDocs();

      const createResponse = await docs.documents.create({
        requestBody: { title: params.title }
      });

      const docId = createResponse.data.documentId!;

      if (params.content) {
        await docs.documents.batchUpdate({
          documentId: docId,
          requestBody: {
            requests: [{
              insertText: {
                text: params.content,
                endOfSegmentLocation: { segmentId: '' }
              }
            }]
          }
        });
      }

      const simplified: SimplifiedDocument = {
        documentId: docId,
        title: createResponse.data.title!,
        revisionId: createResponse.data.revisionId || undefined,
      };

      return {
        content: [{ type: "text", text: `Successfully created document: ${simplified.title}\nID: ${simplified.documentId}` }],
        structuredContent: simplified
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
 * Tool: gdocs_insert_text
 * Insert text at a specific position
 */
server.registerTool(
  "gdocs_insert_text",
  {
    title: "Insert Text in Google Doc",
    description: `Insert text at a specific position in a Google Doc.

Args:
  - document_id (string): The Google Doc ID
  - text (string): The text to insert
  - index (number, optional): 1-based index at which to insert (use gdocs_get_document with include_content=true to see current indices)
  - insert_at_end (boolean, optional): If true, insert at the end of the segment
  - segment_id (string, optional): Segment ID (default: '' for document body)

Provide either index OR set insert_at_end=true, not both.

Note: Inserting text shifts all subsequent indices. If you need multiple operations, use gdocs_batch_update for atomicity.`,
    inputSchema: InsertTextInputSchema,
    outputSchema: BatchUpdateResultOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    }
  },
  async (params: InsertTextInput) => {
    try {
      ensureAuthenticated();
      const docs = docsService.getDocs();

      const insertRequest: any = { text: params.text };
      if (params.insert_at_end) {
        const loc: any = { segmentId: params.segment_id };
        if (params.tab_id) loc.tabId = params.tab_id;
        insertRequest.endOfSegmentLocation = loc;
      } else {
        const loc: any = { index: params.index, segmentId: params.segment_id };
        if (params.tab_id) loc.tabId = params.tab_id;
        insertRequest.location = loc;
      }

      const response = await docs.documents.batchUpdate({
        documentId: params.document_id,
        requestBody: {
          requests: [{ insertText: insertRequest }]
        }
      });

      const result: BatchUpdateResult = {
        documentId: response.data.documentId!,
        replies: response.data.replies || [],
      };

      return {
        content: [{ type: "text", text: `Successfully inserted text into document ${result.documentId}` }],
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
 * Tool: gdocs_delete_range
 * Delete text in a range
 */
server.registerTool(
  "gdocs_delete_range",
  {
    title: "Delete Text Range in Google Doc",
    description: `Delete text in a specific index range within a Google Doc.

Args:
  - document_id (string): The Google Doc ID
  - start_index (number): Start index (inclusive)
  - end_index (number): End index (exclusive)
  - segment_id (string, optional): Segment ID (default: '' for document body)

Use gdocs_get_document with include_content=true to see current indices before deleting.

Note: Deleting text shifts all subsequent indices. If you need multiple operations, use gdocs_batch_update for atomicity.`,
    inputSchema: DeleteRangeInputSchema,
    outputSchema: BatchUpdateResultOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  async (params: DeleteRangeInput) => {
    try {
      ensureAuthenticated();
      const docs = docsService.getDocs();

      const response = await docs.documents.batchUpdate({
        documentId: params.document_id,
        requestBody: {
          requests: [{
            deleteContentRange: {
              range: {
                startIndex: params.start_index,
                endIndex: params.end_index,
                segmentId: params.segment_id,
                ...(params.tab_id && { tabId: params.tab_id })
              }
            }
          }]
        }
      });

      const result: BatchUpdateResult = {
        documentId: response.data.documentId!,
        replies: response.data.replies || [],
      };

      return {
        content: [{ type: "text", text: `Successfully deleted range ${params.start_index}-${params.end_index} from document ${result.documentId}` }],
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
 * Tool: gdocs_update_text_style
 * Apply text formatting to a range
 */
server.registerTool(
  "gdocs_update_text_style",
  {
    title: "Format Text in Google Doc",
    description: `Apply text formatting (bold, italic, underline, font size, color, etc.) to a range in a Google Doc.

Args:
  - document_id (string): The Google Doc ID
  - start_index (number): Start index (inclusive)
  - end_index (number): End index (exclusive)
  - segment_id (string, optional): Segment ID (default: '' for document body)
  - bold (boolean, optional): Set bold
  - italic (boolean, optional): Set italic
  - underline (boolean, optional): Set underline
  - strikethrough (boolean, optional): Set strikethrough
  - font_size (number, optional): Font size in points
  - font_family (string, optional): Font family name
  - foreground_color ({ red, green, blue }, optional): Text color (RGB, each 0-1)
  - background_color ({ red, green, blue }, optional): Highlight color (RGB, each 0-1)
  - link_url (string, optional): URL to link the text to

Only the properties you provide will be changed; others remain unchanged.

Use gdocs_get_document with include_content=true to see current indices and formatting.`,
    inputSchema: UpdateTextStyleInputSchema,
    outputSchema: BatchUpdateResultOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  async (params: UpdateTextStyleInput) => {
    try {
      ensureAuthenticated();
      const docs = docsService.getDocs();

      const { textStyle, fields } = buildTextStyle(params);

      if (!fields) {
        return {
          content: [{ type: "text", text: "Error: No style properties provided. Specify at least one of: bold, italic, underline, strikethrough, font_size, font_family, foreground_color, background_color, link_url." }],
          isError: true
        };
      }

      const response = await docs.documents.batchUpdate({
        documentId: params.document_id,
        requestBody: {
          requests: [{
            updateTextStyle: {
              textStyle,
              range: {
                startIndex: params.start_index,
                endIndex: params.end_index,
                segmentId: params.segment_id,
                ...(params.tab_id && { tabId: params.tab_id })
              },
              fields
            }
          }]
        }
      });

      const result: BatchUpdateResult = {
        documentId: response.data.documentId!,
        replies: response.data.replies || [],
      };

      return {
        content: [{ type: "text", text: `Successfully applied text style (${fields}) to range ${params.start_index}-${params.end_index} in document ${result.documentId}` }],
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
 * Tool: gdocs_update_paragraph_style
 * Apply paragraph-level formatting
 */
server.registerTool(
  "gdocs_update_paragraph_style",
  {
    title: "Format Paragraph in Google Doc",
    description: `Apply paragraph-level formatting (heading style, alignment) to a range in a Google Doc.

Args:
  - document_id (string): The Google Doc ID
  - start_index (number): Start index (inclusive)
  - end_index (number): End index (exclusive)
  - segment_id (string, optional): Segment ID (default: '' for document body)
  - named_style_type (string, optional): Heading style — one of: NORMAL_TEXT, TITLE, SUBTITLE, HEADING_1 through HEADING_6
  - alignment (string, optional): Paragraph alignment — one of: START, CENTER, END, JUSTIFIED

At least one of named_style_type or alignment must be provided.

The range should cover at least one full paragraph (from its startIndex to endIndex as shown by gdocs_get_document).`,
    inputSchema: UpdateParagraphStyleInputSchema,
    outputSchema: BatchUpdateResultOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  async (params: UpdateParagraphStyleInput) => {
    try {
      ensureAuthenticated();
      const docs = docsService.getDocs();

      const paragraphStyle: any = {};
      const fieldsList: string[] = [];

      if (params.named_style_type !== undefined) {
        paragraphStyle.namedStyleType = params.named_style_type;
        fieldsList.push('namedStyleType');
      }
      if (params.alignment !== undefined) {
        paragraphStyle.alignment = params.alignment;
        fieldsList.push('alignment');
      }

      if (fieldsList.length === 0) {
        return {
          content: [{ type: "text", text: "Error: No paragraph style properties provided. Specify at least one of: named_style_type, alignment." }],
          isError: true
        };
      }

      const response = await docs.documents.batchUpdate({
        documentId: params.document_id,
        requestBody: {
          requests: [{
            updateParagraphStyle: {
              paragraphStyle,
              range: {
                startIndex: params.start_index,
                endIndex: params.end_index,
                segmentId: params.segment_id,
                ...(params.tab_id && { tabId: params.tab_id })
              },
              fields: fieldsList.join(',')
            }
          }]
        }
      });

      const result: BatchUpdateResult = {
        documentId: response.data.documentId!,
        replies: response.data.replies || [],
      };

      return {
        content: [{ type: "text", text: `Successfully applied paragraph style (${fieldsList.join(',')}) to range ${params.start_index}-${params.end_index} in document ${result.documentId}` }],
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
 * Tool: gdocs_replace_all_text
 * Find and replace all occurrences
 */
server.registerTool(
  "gdocs_replace_all_text",
  {
    title: "Find and Replace in Google Doc",
    description: `Find and replace all occurrences of a string in a Google Doc.

Args:
  - document_id (string): The Google Doc ID
  - find_text (string): The text to find
  - replace_text (string): The replacement text (can be empty to delete all matches)
  - match_case (boolean, optional): Case-sensitive search (default: true)

Returns:
  { documentId, occurrencesChanged }`,
    inputSchema: ReplaceAllTextInputSchema,
    outputSchema: ReplaceAllResultOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  async (params: ReplaceAllTextInput) => {
    try {
      ensureAuthenticated();
      const docs = docsService.getDocs();

      const response = await docs.documents.batchUpdate({
        documentId: params.document_id,
        requestBody: {
          requests: [{
            replaceAllText: {
              containsText: {
                text: params.find_text,
                matchCase: params.match_case
              },
              replaceText: params.replace_text,
              ...(params.tab_ids && { tabsCriteria: { tabIds: params.tab_ids } })
            }
          }]
        }
      });

      const replies = response.data.replies || [];
      const occurrencesChanged = (replies[0] as any)?.replaceAllText?.occurrencesChanged || 0;

      const result: ReplaceAllResult = {
        documentId: response.data.documentId!,
        occurrencesChanged,
      };

      return {
        content: [{ type: "text", text: `Replaced ${result.occurrencesChanged} occurrence(s) of "${params.find_text}" with "${params.replace_text}" in document ${result.documentId}` }],
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
 * Tool: gdocs_batch_update
 * Send multiple document operations atomically
 */
server.registerTool(
  "gdocs_batch_update",
  {
    title: "Batch Update Google Doc",
    description: `Send multiple document operations in a single atomic request. This is the power tool for complex edits.

Args:
  - document_id (string): The Google Doc ID
  - requests (array, max 100): Array of request objects. Each can contain one of:
    - insertText: { text, location?: { index, segmentId }, endOfSegmentLocation?: { segmentId } }
    - deleteContentRange: { range: { startIndex, endIndex, segmentId } }
    - updateTextStyle: { textStyle: {...}, range: { startIndex, endIndex, segmentId }, fields: "bold,italic,..." }
    - replaceAllText: { containsText: { text, matchCase }, replaceText }
    - updateParagraphStyle: { paragraphStyle: {...}, range: { startIndex, endIndex, segmentId }, fields: "namedStyleType,..." }

Important: Operations are applied in order. insertText and deleteContentRange shift indices — account for this when combining operations. When deleting and inserting, process from end-of-document to start to avoid index shifts affecting subsequent operations.`,
    inputSchema: BatchUpdateInputSchema,
    outputSchema: BatchUpdateResultOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    }
  },
  async (params: BatchUpdateInput) => {
    try {
      ensureAuthenticated();
      const docs = docsService.getDocs();

      const response = await docs.documents.batchUpdate({
        documentId: params.document_id,
        requestBody: {
          requests: params.requests as any[]
        }
      });

      const result: BatchUpdateResult = {
        documentId: response.data.documentId!,
        replies: response.data.replies || [],
      };

      return {
        content: [{ type: "text", text: `Successfully executed ${params.requests.length} operation(s) on document ${result.documentId}` }],
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

// ============================================================
// Google Drive Comments & Replies Tools
// ============================================================

/**
 * Tool: gdrive_list_comments
 * List all comments on a file
 */
server.registerTool(
  "gdrive_list_comments",
  {
    title: "List Comments",
    description: `List comments on a Google Drive file, including author, content, resolved status, quoted text, and reply threads.

Due to the drive.file scope, only files created by this app or opened via the Picker are accessible.

Args:
  - file_id (string): The Drive file ID
  - page_size (number, optional): Number of comments to return (1-100, default: 20)
  - page_token (string, optional): Pagination token from a previous response
  - include_resolved (boolean, optional): Whether to include resolved comments (default: true)

Returns:
  { count, comments: [{ id, content, author, createdTime, resolved, quotedText, replies }], has_more, next_page_token }

Don't use when: The file hasn't been opened via the Picker — you'll get a 404.`,
    inputSchema: ListCommentsInputSchema,
    outputSchema: CommentListOutputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  async (params: ListCommentsInput) => {
    try {
      ensureAuthenticated();
      const drive = driveService.getDrive();

      const response = await drive.comments.list({
        fileId: params.file_id,
        pageSize: params.page_size,
        pageToken: params.page_token,
        fields: 'nextPageToken,comments(id,content,quotedFileContent,author,createdTime,modifiedTime,resolved,replies(id,content,author,createdTime,modifiedTime,action))',
      });

      let comments = (response.data.comments || []).map(mapComment);
      if (!params.include_resolved) {
        comments = comments.filter(c => !c.resolved);
      }

      const result: CommentListResult = {
        count: comments.length,
        comments,
        has_more: !!response.data.nextPageToken,
        next_page_token: response.data.nextPageToken || undefined,
      };

      const text = formatCommentListMarkdown(result);
      return { content: [{ type: "text", text }], structuredContent: result };
    } catch (error) {
      return { content: [{ type: "text", text: formatError(error) }], isError: true };
    }
  }
);

/**
 * Tool: gdrive_get_comment
 * Get a specific comment with its reply thread
 */
server.registerTool(
  "gdrive_get_comment",
  {
    title: "Get Comment",
    description: `Retrieve a specific comment on a Google Drive file, optionally including the full reply thread.

Args:
  - file_id (string): The Drive file ID
  - comment_id (string): The comment ID (from gdrive_list_comments)
  - include_replies (boolean, optional): Whether to include the full reply thread (default: true)

Returns:
  { id, content, author, createdTime, resolved, quotedText, replies? }

Don't use when: You want to list all comments — use gdrive_list_comments instead.`,
    inputSchema: GetCommentInputSchema,
    outputSchema: CommentDetailOutputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  async (params: GetCommentInput) => {
    try {
      ensureAuthenticated();
      const drive = driveService.getDrive();

      let fields = 'id,content,quotedFileContent,author,createdTime,modifiedTime,resolved';
      if (params.include_replies) {
        fields += ',replies(id,content,author,createdTime,modifiedTime,action)';
      }

      const response = await drive.comments.get({
        fileId: params.file_id,
        commentId: params.comment_id,
        fields,
        includeDeleted: false,
      });

      const comment = mapComment(response.data);
      const text = formatCommentMarkdown(comment);
      return { content: [{ type: "text", text }], structuredContent: comment };
    } catch (error) {
      return { content: [{ type: "text", text: formatError(error) }], isError: true };
    }
  }
);

/**
 * Tool: gdrive_add_comment
 * Create a comment, optionally anchored to a text range in a Google Doc
 */
server.registerTool(
  "gdrive_add_comment",
  {
    title: "Add Comment",
    description: `Create a comment on a Google Drive file. For Google Docs, you can anchor the comment to a specific text range.

Args:
  - file_id (string): The Drive file ID
  - content (string): The comment text
  - document_id (string, optional): The Google Doc ID (same as file_id for Docs). Required for anchored comments.
  - start_index (number, optional): Start index (1-based, from gdocs_get_document) of the text to anchor to
  - end_index (number, optional): End index (exclusive) of the text to anchor to
  - quoted_text (string, optional): The exact quoted text. If omitted with start/end indices, extracted automatically.

For anchored comments, all three of document_id, start_index, and end_index must be provided.

Note: Programmatically created anchored comments appear in the comments panel but may not show visual anchoring in the Docs UI (Google API limitation).

Examples:
  - Unanchored comment: { file_id: "abc123", content: "Great work!" }
  - Anchored comment: { file_id: "abc123", content: "Rephrase this", document_id: "abc123", start_index: 5, end_index: 20 }

Don't use when: Replying to an existing comment — use gdrive_reply_to_comment instead.`,
    inputSchema: AddCommentInputSchema,
    outputSchema: CommentDetailOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    }
  },
  async (params: AddCommentInput) => {
    try {
      ensureAuthenticated();
      const drive = driveService.getDrive();

      const requestBody: any = {};
      let quotedText: string | undefined;

      if (params.document_id && params.start_index !== undefined && params.end_index !== undefined) {
        requestBody.anchor = buildCommentAnchor(params.document_id, params.start_index, params.end_index);

        quotedText = params.quoted_text;
        if (!quotedText) {
          const docs = docsService.getDocs();
          const docResponse = await docs.documents.get({ documentId: params.document_id });
          if (docResponse.data.body) {
            quotedText = extractTextFromDocBody(docResponse.data.body, params.start_index, params.end_index);
          }
        }

        if (quotedText) {
          requestBody.quotedFileContent = {
            mimeType: 'text/html',
            value: quotedText,
          };
        }
      }

      requestBody.content = buildCommentContent(params.content, quotedText);

      const response = await drive.comments.create({
        fileId: params.file_id,
        requestBody,
        fields: 'id,content,quotedFileContent,author,createdTime,resolved',
      });

      const comment = mapComment(response.data);
      const text = `Comment created on file ${params.file_id}\n${formatCommentMarkdown(comment)}`;
      return { content: [{ type: "text", text }], structuredContent: comment };
    } catch (error) {
      return { content: [{ type: "text", text: formatError(error) }], isError: true };
    }
  }
);

/**
 * Tool: gdrive_update_comment
 * Edit an existing comment's text
 */
server.registerTool(
  "gdrive_update_comment",
  {
    title: "Update Comment",
    description: `Update the text content of an existing comment. Only the comment creator can update it.

Args:
  - file_id (string): The Drive file ID
  - comment_id (string): The comment ID to update
  - content (string): The new comment text

Returns:
  { id, content, author, createdTime, modifiedTime, resolved }

Don't use when: You want to resolve a comment — use gdrive_resolve_comment instead.`,
    inputSchema: UpdateCommentInputSchema,
    outputSchema: CommentDetailOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  async (params: UpdateCommentInput) => {
    try {
      ensureAuthenticated();
      const drive = driveService.getDrive();

      const response = await drive.comments.update({
        fileId: params.file_id,
        commentId: params.comment_id,
        requestBody: { content: buildCommentContent(params.content) },
        fields: 'id,content,author,createdTime,modifiedTime,resolved',
      });

      const comment = mapComment(response.data);
      return {
        content: [{ type: "text", text: `Comment ${comment.id} updated successfully` }],
        structuredContent: comment
      };
    } catch (error) {
      return { content: [{ type: "text", text: formatError(error) }], isError: true };
    }
  }
);

/**
 * Tool: gdrive_delete_comment
 * Permanently delete a comment
 */
server.registerTool(
  "gdrive_delete_comment",
  {
    title: "Delete Comment",
    description: `Permanently delete a comment and all its replies from a Google Drive file. This cannot be undone. Only the comment creator can delete it.

Args:
  - file_id (string): The Drive file ID
  - comment_id (string): The comment ID to delete

Returns:
  { file_id, comment_id } confirming what was removed

Don't use when: You want to resolve a comment instead of deleting it — use gdrive_resolve_comment.`,
    inputSchema: DeleteCommentInputSchemaComments,
    outputSchema: DeleteCommentOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  async (params: DeleteCommentInputType) => {
    try {
      ensureAuthenticated();
      const drive = driveService.getDrive();

      await drive.comments.delete({
        fileId: params.file_id,
        commentId: params.comment_id,
      });

      const result = { file_id: params.file_id, comment_id: params.comment_id };
      return {
        content: [{ type: "text", text: `Comment ${params.comment_id} deleted from file ${params.file_id}` }],
        structuredContent: result
      };
    } catch (error) {
      return { content: [{ type: "text", text: formatError(error) }], isError: true };
    }
  }
);

/**
 * Tool: gdrive_reply_to_comment
 * Add a reply to an existing comment thread
 */
server.registerTool(
  "gdrive_reply_to_comment",
  {
    title: "Reply to Comment",
    description: `Add a reply to an existing comment thread on a Google Drive file.

Args:
  - file_id (string): The Drive file ID
  - comment_id (string): The comment ID to reply to
  - content (string): The reply text

Returns:
  { id, content, author, createdTime, action }

Don't use when: You want to resolve a comment — use gdrive_resolve_comment instead. Don't use when creating a new top-level comment — use gdrive_add_comment.`,
    inputSchema: ReplyToCommentInputSchema,
    outputSchema: ReplyDetailOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    }
  },
  async (params: ReplyToCommentInput) => {
    try {
      ensureAuthenticated();
      const drive = driveService.getDrive();

      const response = await drive.replies.create({
        fileId: params.file_id,
        commentId: params.comment_id,
        requestBody: { content: buildCommentContent(params.content) },
        fields: 'id,content,author,createdTime,action',
      });

      const reply = mapReply(response.data);
      return {
        content: [{ type: "text", text: `Reply added to comment ${params.comment_id}` }],
        structuredContent: reply
      };
    } catch (error) {
      return { content: [{ type: "text", text: formatError(error) }], isError: true };
    }
  }
);

/**
 * Tool: gdrive_resolve_comment
 * Resolve a comment by creating a reply with action: 'resolve'
 */
server.registerTool(
  "gdrive_resolve_comment",
  {
    title: "Resolve Comment",
    description: `Resolve a comment on a Google Drive file. This creates a reply with action "resolve", which marks the comment as resolved.

Args:
  - file_id (string): The Drive file ID
  - comment_id (string): The comment ID to resolve

Returns:
  { id, content, author, createdTime, action }

Don't use when: You want to delete a comment — use gdrive_delete_comment. Don't use when you want to add a regular reply — use gdrive_reply_to_comment.`,
    inputSchema: ResolveCommentInputSchema,
    outputSchema: ReplyDetailOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  async (params: ResolveCommentInput) => {
    try {
      ensureAuthenticated();
      const drive = driveService.getDrive();

      const response = await drive.replies.create({
        fileId: params.file_id,
        commentId: params.comment_id,
        requestBody: {
          content: buildCommentContent('Resolved'),
          action: 'resolve',
        },
        fields: 'id,content,author,createdTime,action',
      });

      const reply = mapReply(response.data);
      return {
        content: [{ type: "text", text: `Comment ${params.comment_id} resolved` }],
        structuredContent: reply
      };
    } catch (error) {
      return { content: [{ type: "text", text: formatError(error) }], isError: true };
    }
  }
);

/**
 * Tool: gdrive_list_replies
 * List replies on a specific comment
 */
server.registerTool(
  "gdrive_list_replies",
  {
    title: "List Replies",
    description: `List all replies on a specific comment thread.

Args:
  - file_id (string): The Drive file ID
  - comment_id (string): The comment ID
  - page_size (number, optional): Number of replies to return (1-100, default: 20)
  - page_token (string, optional): Pagination token from a previous response

Returns:
  { count, replies: [{ id, content, author, createdTime, action }], has_more, next_page_token }

Don't use when: You want the full comment with its replies — use gdrive_get_comment with include_replies=true instead.`,
    inputSchema: ListRepliesInputSchema,
    outputSchema: ReplyListOutputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  async (params: ListRepliesInput) => {
    try {
      ensureAuthenticated();
      const drive = driveService.getDrive();

      const response = await drive.replies.list({
        fileId: params.file_id,
        commentId: params.comment_id,
        pageSize: params.page_size,
        pageToken: params.page_token,
        fields: 'nextPageToken,replies(id,content,author,createdTime,modifiedTime,action)',
      });

      const replies = (response.data.replies || []).map(mapReply);
      const result: ReplyListResult = {
        count: replies.length,
        replies,
        has_more: !!response.data.nextPageToken,
        next_page_token: response.data.nextPageToken || undefined,
      };

      const parts = [`# Replies (${result.count})\n`];
      for (const reply of result.replies) {
        const authorStr = reply.author ? ` (${reply.author})` : '';
        const actionStr = reply.action ? ` [${reply.action}]` : '';
        parts.push(`- ${reply.content}${authorStr}${actionStr}`);
      }
      if (result.has_more) {
        parts.push(`\n*More replies available. Use next_page_token: \`${result.next_page_token}\`*`);
      }

      return { content: [{ type: "text", text: parts.join('\n') }], structuredContent: result };
    } catch (error) {
      return { content: [{ type: "text", text: formatError(error) }], isError: true };
    }
  }
);

// ============================================================
// Additional Google Docs Tools
// ============================================================

/**
 * Tool: gdocs_insert_table
 * Insert a table into a Google Doc
 */
server.registerTool(
  "gdocs_insert_table",
  {
    title: "Insert Table in Google Doc",
    description: `Insert a table with custom dimensions into a Google Doc.

Args:
  - document_id (string): The Google Doc ID
  - rows (number): Number of rows (1-50)
  - columns (number): Number of columns (1-20)
  - index (number, optional): 1-based index at which to insert the table
  - insert_at_end (boolean, optional): If true, insert at the end of the document

Provide either index OR set insert_at_end=true, not both.

Note: Inserting a table shifts all subsequent indices. Use gdocs_get_document to check current indices.`,
    inputSchema: InsertTableInputSchema,
    outputSchema: BatchUpdateResultOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    }
  },
  async (params: InsertTableInput) => {
    try {
      ensureAuthenticated();
      const docs = docsService.getDocs();

      const insertRequest: any = {
        rows: params.rows,
        columns: params.columns,
      };
      if (params.insert_at_end) {
        const loc: any = { segmentId: '' };
        if (params.tab_id) loc.tabId = params.tab_id;
        insertRequest.endOfSegmentLocation = loc;
      } else {
        const loc: any = { index: params.index };
        if (params.tab_id) loc.tabId = params.tab_id;
        insertRequest.location = loc;
      }

      const response = await docs.documents.batchUpdate({
        documentId: params.document_id,
        requestBody: {
          requests: [{ insertTable: insertRequest }]
        }
      });

      const result: BatchUpdateResult = {
        documentId: response.data.documentId!,
        replies: response.data.replies || [],
      };
      return {
        content: [{ type: "text", text: `Inserted ${params.rows}x${params.columns} table into document ${result.documentId}` }],
        structuredContent: result
      };
    } catch (error) {
      return { content: [{ type: "text", text: formatError(error) }], isError: true };
    }
  }
);

/**
 * Tool: gdocs_insert_page_break
 * Insert a page break into a Google Doc
 */
server.registerTool(
  "gdocs_insert_page_break",
  {
    title: "Insert Page Break in Google Doc",
    description: `Insert a page break at a specific position in a Google Doc.

Args:
  - document_id (string): The Google Doc ID
  - index (number): 1-based index at which to insert the page break
  - segment_id (string, optional): Segment ID (default: '' for document body)

Note: Inserting a page break shifts all subsequent indices.`,
    inputSchema: InsertPageBreakInputSchema,
    outputSchema: BatchUpdateResultOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    }
  },
  async (params: InsertPageBreakInput) => {
    try {
      ensureAuthenticated();
      const docs = docsService.getDocs();

      const response = await docs.documents.batchUpdate({
        documentId: params.document_id,
        requestBody: {
          requests: [{
            insertPageBreak: {
              location: {
                index: params.index,
                segmentId: params.segment_id,
                ...(params.tab_id && { tabId: params.tab_id })
              }
            }
          }]
        }
      });

      const result: BatchUpdateResult = {
        documentId: response.data.documentId!,
        replies: response.data.replies || [],
      };
      return {
        content: [{ type: "text", text: `Inserted page break at index ${params.index} in document ${result.documentId}` }],
        structuredContent: result
      };
    } catch (error) {
      return { content: [{ type: "text", text: formatError(error) }], isError: true };
    }
  }
);

/**
 * Tool: gdocs_insert_image
 * Insert an inline image into a Google Doc
 */
server.registerTool(
  "gdocs_insert_image",
  {
    title: "Insert Image in Google Doc",
    description: `Insert an inline image from a URL into a Google Doc, with optional sizing.

Args:
  - document_id (string): The Google Doc ID
  - image_url (string): The URL of the image (must be publicly accessible)
  - index (number, optional): 1-based index at which to insert the image
  - insert_at_end (boolean, optional): If true, insert at the end of the document
  - width (number, optional): Image width in points (72 points = 1 inch)
  - height (number, optional): Image height in points (72 points = 1 inch)

Provide either index OR set insert_at_end=true, not both.

Note: The image URL must be publicly accessible. Google will fetch the image at the time of insertion.`,
    inputSchema: InsertImageInputSchema,
    outputSchema: BatchUpdateResultOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    }
  },
  async (params: InsertImageInput) => {
    try {
      ensureAuthenticated();
      const docs = docsService.getDocs();

      const insertRequest: any = { uri: params.image_url };
      if (params.insert_at_end) {
        const loc: any = { segmentId: '' };
        if (params.tab_id) loc.tabId = params.tab_id;
        insertRequest.endOfSegmentLocation = loc;
      } else {
        const loc: any = { index: params.index };
        if (params.tab_id) loc.tabId = params.tab_id;
        insertRequest.location = loc;
      }

      if (params.width || params.height) {
        insertRequest.objectSize = {};
        if (params.width) {
          insertRequest.objectSize.width = { magnitude: params.width, unit: 'PT' };
        }
        if (params.height) {
          insertRequest.objectSize.height = { magnitude: params.height, unit: 'PT' };
        }
      }

      const response = await docs.documents.batchUpdate({
        documentId: params.document_id,
        requestBody: {
          requests: [{ insertInlineImage: insertRequest }]
        }
      });

      const result: BatchUpdateResult = {
        documentId: response.data.documentId!,
        replies: response.data.replies || [],
      };
      return {
        content: [{ type: "text", text: `Inserted image into document ${result.documentId}` }],
        structuredContent: result
      };
    } catch (error) {
      return { content: [{ type: "text", text: formatError(error) }], isError: true };
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

  // --- Rate limiting (per-IP, in-memory) ---
  const rateLimitWindow = 60_000; // 1 minute
  const rateLimitMax = 60;        // requests per window
  const rateBuckets = new Map<string, { count: number; resetAt: number }>();

  app.use((req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    let bucket = rateBuckets.get(ip);

    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + rateLimitWindow };
      rateBuckets.set(ip, bucket);
    }

    bucket.count++;
    if (bucket.count > rateLimitMax) {
      res.status(429).json({ error: 'Too many requests. Try again later.' });
      return;
    }
    next();
  });

  // Clean up stale rate-limit buckets every 5 minutes
  setInterval(() => {
    const now = Date.now();
    for (const [ip, bucket] of rateBuckets) {
      if (now >= bucket.resetAt) rateBuckets.delete(ip);
    }
  }, 5 * 60_000).unref();

  // --- Origin checking for mutating endpoints ---
  // ALLOWED_ORIGINS can be set to a comma-separated list of origins
  // (e.g. "http://localhost:3000,https://myserver.example").
  // Falls back to http://localhost:{port} if unset.
  const allowedOrigins = new Set(
    (process.env.ALLOWED_ORIGINS || `http://localhost:${port}`)
      .split(',')
      .map(o => o.trim())
      .filter(Boolean)
  );

  function checkOrigin(req: express.Request, res: express.Response, next: express.NextFunction): void {
    const origin = req.headers['origin'];
    const referer = req.headers['referer'];

    // Allow requests with no Origin header (non-browser clients like curl, MCP SDK)
    if (!origin && !referer) {
      next();
      return;
    }

    // If an Origin or Referer is present, it must match an allowed origin
    if (origin && allowedOrigins.has(origin)) {
      next();
      return;
    }
    if (referer) {
      for (const allowed of allowedOrigins) {
        if (referer.startsWith(allowed + '/') || referer === allowed) {
          next();
          return;
        }
      }
    }

    res.status(403).json({ error: 'Forbidden: cross-origin request rejected.' });
  }

  // Landing page / Picker page (combined)
  app.get('/', async (req, res) => {
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
            <a href="${escapeHtml(driveService.getAuthUrl())}" class="btn">Sign in with Google</a>
          </div>
        </body>
        </html>
      `);
      return;
    }

    // Show picker page — get a fresh (auto-refreshed) access token
    let accessToken: string;
    try {
      accessToken = await driveService.getFreshAccessToken();
    } catch {
      res.redirect('/?error=token_refresh_failed');
      return;
    }
    const clientId = driveService.getClientId();

    res.set('Cache-Control', 'no-store');
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
    const CLIENT_ID = ${JSON.stringify(clientId)};
    const ACCESS_TOKEN = ${JSON.stringify(accessToken)};
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
        .setAppId(${JSON.stringify(appId)})
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
        const strong = document.createElement('strong');
        strong.textContent = file.name;
        const small = document.createElement('small');
        small.textContent = 'ID: ' + file.id;
        li.appendChild(strong);
        li.appendChild(small);
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
          <p>Error: ${escapeHtml(error)}</p>
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
          <p>${escapeHtml(error.message || 'Unknown error occurred')}</p>
          <p>Please try authenticating again.</p>
        </body>
        </html>
      `);
    }
  });

  // API endpoint to "open" files selected via Picker
  app.post('/api/open-files', checkOrigin, async (req, res) => {
    try {
      const { fileIds } = req.body;

      if (!Array.isArray(fileIds) || fileIds.length === 0) {
        res.json({ success: false, error: 'No file IDs provided' });
        return;
      }

      if (fileIds.length > 100) {
        res.json({ success: false, error: 'Too many file IDs (max 100)' });
        return;
      }

      const validId = /^[a-zA-Z0-9_-]+$/;
      if (!fileIds.every((id: unknown) => typeof id === 'string' && validId.test(id))) {
        res.json({ success: false, error: 'Invalid file ID format' });
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

  app.post('/mcp', checkOrigin, async (req, res) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });
    res.on('close', () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.listen(port, '127.0.0.1', () => {
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
