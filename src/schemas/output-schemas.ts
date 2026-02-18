/**
 * Zod output schemas for MCP tool structured responses.
 * These are passed as `outputSchema` in registerTool and must match
 * the shape of `structuredContent` returned by each tool handler.
 */

import { z } from 'zod';

export const FileMetadataOutputSchema = {
  id: z.string().describe('File ID'),
  name: z.string().describe('File name'),
  mimeType: z.string().describe('MIME type'),
  createdTime: z.string().optional().describe('ISO creation timestamp'),
  modifiedTime: z.string().optional().describe('ISO last-modified timestamp'),
  size: z.string().optional().describe('File size in bytes (as string)'),
  webViewLink: z.string().optional().describe('Google Drive web URL'),
  parents: z.array(z.string()).optional().describe('Parent folder IDs'),
  description: z.string().optional().describe('File description'),
  starred: z.boolean().optional().describe('Whether the file is starred'),
  content: z.string().optional().describe('Text content (only present when include_content=true)'),
};

export const FileListOutputSchema = {
  total: z.number().describe('Total number of files in this response'),
  count: z.number().describe('Number of files in this response'),
  files: z.array(z.object(FileMetadataOutputSchema)).describe('Array of file metadata objects'),
  has_more: z.boolean().describe('Whether more results are available via pagination'),
  next_page_token: z.string().optional().describe('Token to pass as page_token for the next page'),
};

export const DeleteOutputSchema = {
  id: z.string().describe('ID of the deleted file'),
  name: z.string().describe('Name of the deleted file'),
};
