/**
 * Zod validation schemas for tool inputs
 */

import { z } from 'zod';
import { ResponseFormat, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../constants.js';

export const ListFilesInputSchema = z.object({
  parent_id: z.string()
    .optional()
    .describe('Optional parent folder ID to list files from'),
  page_size: z.number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE)
    .describe(`Number of results to return (1-${MAX_PAGE_SIZE}, default: ${DEFAULT_PAGE_SIZE})`),
  page_token: z.string()
    .optional()
    .describe('Page token from previous response for pagination'),
  order_by: z.string()
    .optional()
    .describe('Sort order (e.g., "name", "modifiedTime desc", "createdTime")'),
  response_format: z.nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe('Output format: markdown or json')
}).strict();

export type ListFilesInput = z.infer<typeof ListFilesInputSchema>;

export const SearchFilesInputSchema = z.object({
  query: z.string()
    .min(1)
    .describe('Search query to match file names'),
  mime_type: z.string()
    .optional()
    .describe('Filter by MIME type (e.g., "application/vnd.google-apps.folder")'),
  parent_id: z.string()
    .optional()
    .describe('Search within a specific folder'),
  page_size: z.number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE)
    .describe(`Number of results to return (1-${MAX_PAGE_SIZE})`),
  page_token: z.string()
    .optional()
    .describe('Page token for pagination'),
  response_format: z.nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe('Output format: markdown or json')
}).strict();

export type SearchFilesInput = z.infer<typeof SearchFilesInputSchema>;

export const GetFileInputSchema = z.object({
  file_id: z.string()
    .min(1)
    .describe('The ID of the file to retrieve'),
  include_content: z.boolean()
    .default(false)
    .describe('Whether to include file content (for text files)'),
  response_format: z.nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe('Output format: markdown or json')
}).strict();

export type GetFileInput = z.infer<typeof GetFileInputSchema>;

export const CreateFileInputSchema = z.object({
  name: z.string()
    .min(1)
    .max(255)
    .describe('Name of the file to create'),
  mime_type: z.string()
    .default('text/plain')
    .describe('MIME type of the file (default: text/plain)'),
  parent_id: z.string()
    .optional()
    .describe('Parent folder ID (optional)'),
  content: z.string()
    .optional()
    .describe('Text content for the file (optional)')
}).strict();

export type CreateFileInput = z.infer<typeof CreateFileInputSchema>;

export const UpdateFileInputSchema = z.object({
  file_id: z.string()
    .min(1)
    .describe('ID of the file to update'),
  name: z.string()
    .min(1)
    .max(255)
    .optional()
    .describe('New name for the file (optional)'),
  content: z.string()
    .optional()
    .describe('New content for the file (optional)'),
  add_parents: z.array(z.string())
    .optional()
    .describe('Parent folder IDs to add (optional)'),
  remove_parents: z.array(z.string())
    .optional()
    .describe('Parent folder IDs to remove (optional)')
}).strict();

export type UpdateFileInput = z.infer<typeof UpdateFileInputSchema>;

export const DeleteFileInputSchema = z.object({
  file_id: z.string()
    .min(1)
    .describe('ID of the file to delete')
}).strict();

export type DeleteFileInput = z.infer<typeof DeleteFileInputSchema>;

export const CopyFileInputSchema = z.object({
  file_id: z.string()
    .min(1)
    .describe('ID of the file to copy'),
  name: z.string()
    .optional()
    .describe('Name for the copied file (defaults to "Copy of [original name]")'),
  parent_id: z.string()
    .optional()
    .describe('Parent folder ID for the copy (optional)')
}).strict();

export type CopyFileInput = z.infer<typeof CopyFileInputSchema>;

export const CreateFolderInputSchema = z.object({
  name: z.string()
    .min(1)
    .max(255)
    .describe('Name of the folder to create'),
  parent_id: z.string()
    .optional()
    .describe('Parent folder ID (optional)')
}).strict();

export type CreateFolderInput = z.infer<typeof CreateFolderInputSchema>;
