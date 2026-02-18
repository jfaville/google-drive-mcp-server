/**
 * Constants for Google Drive MCP Server
 */

export const API_VERSION = 'v3';
export const CHARACTER_LIMIT = 50000; // Max characters in text responses
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export const GOOGLE_DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file'
];

export enum ResponseFormat {
  MARKDOWN = 'markdown',
  JSON = 'json'
}

export const GOOGLE_DOC_EXPORT_MIME_TYPES = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
  'application/vnd.google-apps.presentation': 'text/plain'
} as const;
