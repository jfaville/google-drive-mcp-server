/**
 * Utility functions for formatting and error handling
 */

import { FileMetadata, FileListResult } from '../types.js';
import { ResponseFormat, CHARACTER_LIMIT } from '../constants.js';

/**
 * Format file metadata as markdown
 */
export function formatFileMarkdown(file: FileMetadata): string {
  const parts: string[] = [];
  
  parts.push(`**${file.name}**`);
  parts.push(`- ID: \`${file.id}\``);
  parts.push(`- Type: ${file.mimeType}`);
  
  if (file.size) {
    parts.push(`- Size: ${formatFileSize(parseInt(file.size))}`);
  }
  
  if (file.createdTime) {
    parts.push(`- Created: ${new Date(file.createdTime).toLocaleString()}`);
  }
  
  if (file.modifiedTime) {
    parts.push(`- Modified: ${new Date(file.modifiedTime).toLocaleString()}`);
  }
  
  if (file.webViewLink) {
    parts.push(`- Link: ${file.webViewLink}`);
  }
  
  if (file.description) {
    parts.push(`- Description: ${file.description}`);
  }
  
  return parts.join('\n');
}

/**
 * Format file list as markdown
 */
export function formatFileListMarkdown(result: FileListResult): string {
  const parts: string[] = [];
  
  parts.push(`# Files (${result.count} of ${result.total})\n`);
  
  result.files.forEach(file => {
    parts.push(formatFileMarkdown(file));
    parts.push(''); // Empty line between files
  });
  
  if (result.has_more) {
    parts.push(`\n*More results available. Use next_page_token: \`${result.next_page_token}\` to fetch the next page.*`);
  }
  
  return parts.join('\n');
}

/**
 * Format file size in human-readable format
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Truncate text to character limit
 */
export function truncateText(text: string, limit: number = CHARACTER_LIMIT): string {
  if (text.length <= limit) {
    return text;
  }
  
  const truncated = text.substring(0, limit);
  return truncated + `\n\n[... Content truncated. Total length: ${text.length} characters, showing first ${limit}]`;
}

/**
 * Format error message with helpful information
 */
export function formatError(error: unknown): string {
  if (error instanceof Error) {
    // Check if it's a Google API error
    if ('code' in error && typeof (error as any).code === 'number') {
      const code = (error as any).code;
      const message = error.message;
      
      switch (code) {
        case 401:
          return 'Authentication failed. Please check your credentials and ensure they are still valid.';
        case 403:
          return `Access forbidden: ${message}. You may not have permission to access this file with the drive.file scope.`;
        case 404:
          return `File not found: ${message}. With drive.file scope, the server can only access files it created or files the user has explicitly selected via the Picker. Ask the user to open the Picker (http://localhost:3000), select the file, then retry.`;
        case 429:
          return 'Rate limit exceeded. Please try again in a few moments.';
        default:
          return `Google Drive API error (${code}): ${message}`;
      }
    }
    
    return `Error: ${error.message}`;
  }
  
  return `Unknown error: ${String(error)}`;
}

/**
 * Build a Google Drive API search query
 */
export function buildSearchQuery(params: {
  mime_type?: string;
  parent_id?: string;
  query?: string;
  trashed?: boolean;
}): string {
  const conditions: string[] = [];
  
  if (params.mime_type) {
    conditions.push(`mimeType='${params.mime_type.replace(/'/g, "\\'")}'`);
  }
  
  if (params.parent_id) {
    conditions.push(`'${params.parent_id}' in parents`);
  }
  
  if (params.query) {
    conditions.push(`name contains '${params.query.replace(/'/g, "\\'")}'`);
  }
  
  if (params.trashed !== undefined) {
    conditions.push(`trashed=${params.trashed}`);
  } else {
    // By default, exclude trashed files
    conditions.push('trashed=false');
  }
  
  return conditions.join(' and ');
}
