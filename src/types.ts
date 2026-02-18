/**
 * Type definitions for Google Drive MCP Server
 */

export interface FileMetadata {
  [key: string]: unknown;
  id: string;
  name: string;
  mimeType: string;
  createdTime?: string;
  modifiedTime?: string;
  size?: string;
  webViewLink?: string;
  parents?: string[];
  trashed?: boolean;
  starred?: boolean;
  description?: string;
}

export interface FileListResult {
  [key: string]: unknown;
  total: number;
  count: number;
  files: FileMetadata[];
  has_more: boolean;
  next_page_token?: string;
}

export interface FileContent {
  id: string;
  name: string;
  mimeType: string;
  content: string;
}

export interface CreateFileParams {
  name: string;
  mimeType?: string;
  parent_id?: string;
  content?: string;
}

export interface UpdateFileParams {
  file_id: string;
  name?: string;
  content?: string;
  add_parents?: string[];
  remove_parents?: string[];
}

export interface SearchParams {
  query?: string;
  mime_type?: string;
  parent_id?: string;
  page_size?: number;
  page_token?: string;
  order_by?: string;
}
