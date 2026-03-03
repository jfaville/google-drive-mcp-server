/**
 * Zod output schemas for Google Docs MCP tool structured responses.
 */

import { z } from 'zod';

const TextRunOutputSchema = z.object({
  content: z.string(),
  startIndex: z.number(),
  endIndex: z.number(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strikethrough: z.boolean().optional(),
  fontSize: z.number().optional(),
  fontFamily: z.string().optional(),
  link: z.string().optional(),
});

const ParagraphOutputSchema = z.object({
  startIndex: z.number(),
  endIndex: z.number(),
  text: z.string(),
  namedStyleType: z.string().optional(),
  alignment: z.string().optional(),
  elements: z.array(TextRunOutputSchema),
});

const DocumentBodyOutputSchema = z.object({
  content: z.array(ParagraphOutputSchema),
});

export const DocumentMetadataOutputSchema = {
  documentId: z.string().describe('Document ID'),
  title: z.string().describe('Document title'),
  revisionId: z.string().optional().describe('Current revision ID'),
  body: DocumentBodyOutputSchema.optional().describe('Document body (when include_content=true)'),
};

export const BatchUpdateResultOutputSchema = {
  documentId: z.string().describe('Document ID'),
  replies: z.array(z.unknown()).describe('Array of reply objects for each request'),
};

export const ReplaceAllResultOutputSchema = {
  documentId: z.string().describe('Document ID'),
  occurrencesChanged: z.number().describe('Number of occurrences replaced'),
};
