/**
 * Zod validation schemas for Google Docs tool inputs
 */

import { z } from 'zod';
import { ResponseFormat, MAX_BATCH_REQUESTS } from '../constants.js';

export const GetDocumentInputSchema = z.object({
  document_id: z.string().min(1).describe('The ID of the Google Doc'),
  include_content: z.boolean()
    .default(false)
    .describe('Whether to include the full document body with formatting info'),
  tab_id: z.string().optional()
    .describe('Tab ID to read content from. If omitted, reads the first tab. Use gdocs_list_tabs to see available tabs.'),
  suggestions_view_mode: z.enum([
    'SUGGESTIONS_INLINE',
    'PREVIEW_SUGGESTIONS_ACCEPTED',
    'PREVIEW_WITHOUT_SUGGESTIONS'
  ]).optional()
    .describe('How to render suggestions: SUGGESTIONS_INLINE (default, required for correct indices), PREVIEW_SUGGESTIONS_ACCEPTED, or PREVIEW_WITHOUT_SUGGESTIONS'),
  response_format: z.nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe('Output format: markdown or json')
}).strict();

export const ListTabsInputSchema = z.object({
  document_id: z.string().min(1).describe('The ID of the Google Doc'),
  response_format: z.nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe('Output format: markdown or json')
}).strict();

export type ListTabsInput = z.infer<typeof ListTabsInputSchema>;

export type GetDocumentInput = z.infer<typeof GetDocumentInputSchema>;

export const CreateDocumentInputSchema = z.object({
  title: z.string().min(1).max(255).describe('Title for the new document'),
  content: z.string().optional()
    .describe('Optional initial text content to insert into the document body')
}).strict();

export type CreateDocumentInput = z.infer<typeof CreateDocumentInputSchema>;

export const InsertTextInputSchema = z.object({
  document_id: z.string().min(1).describe('The ID of the Google Doc'),
  text: z.string().min(1).describe('The text to insert'),
  index: z.number().int().min(1).optional()
    .describe('1-based index (in UTF-16 code units) at which to insert'),
  segment_id: z.string().default('')
    .describe('Segment to insert into: empty string for body (default), or a header/footer/footnote ID'),
  tab_id: z.string().optional()
    .describe('Tab ID to insert into. If omitted, inserts into the first tab.'),
  insert_at_end: z.boolean().default(false)
    .describe('If true, insert at the end of the segment instead of at a specific index')
}).strict().refine(
  data => (data.index !== undefined) !== data.insert_at_end,
  { message: 'Provide either index or set insert_at_end to true, but not both' }
);

export type InsertTextInput = z.infer<typeof InsertTextInputSchema>;

export const DeleteRangeInputSchema = z.object({
  document_id: z.string().min(1).describe('The ID of the Google Doc'),
  start_index: z.number().int().min(1)
    .describe('Start index (inclusive) in UTF-16 code units'),
  end_index: z.number().int().min(2)
    .describe('End index (exclusive) in UTF-16 code units'),
  segment_id: z.string().default('')
    .describe('Segment: empty string for body (default), or a header/footer/footnote ID'),
  tab_id: z.string().optional()
    .describe('Tab ID to delete from. If omitted, operates on the first tab.')
}).strict().refine(
  data => data.end_index > data.start_index,
  { message: 'end_index must be greater than start_index' }
);

export type DeleteRangeInput = z.infer<typeof DeleteRangeInputSchema>;

const RgbColorSchema = z.object({
  red: z.number().min(0).max(1),
  green: z.number().min(0).max(1),
  blue: z.number().min(0).max(1)
});

export const UpdateTextStyleInputSchema = z.object({
  document_id: z.string().min(1).describe('The ID of the Google Doc'),
  start_index: z.number().int().min(1)
    .describe('Start index (inclusive) in UTF-16 code units'),
  end_index: z.number().int().min(2)
    .describe('End index (exclusive) in UTF-16 code units'),
  segment_id: z.string().default('')
    .describe('Segment: empty string for body (default), or a header/footer/footnote ID'),
  tab_id: z.string().optional()
    .describe('Tab ID to apply style in. If omitted, operates on the first tab.'),
  bold: z.boolean().optional().describe('Set bold'),
  italic: z.boolean().optional().describe('Set italic'),
  underline: z.boolean().optional().describe('Set underline'),
  strikethrough: z.boolean().optional().describe('Set strikethrough'),
  font_size: z.number().positive().optional()
    .describe('Font size in points (e.g., 12)'),
  font_family: z.string().optional()
    .describe('Font family (e.g., "Arial", "Times New Roman")'),
  foreground_color: RgbColorSchema.optional()
    .describe('Text color as RGB (each 0-1)'),
  background_color: RgbColorSchema.optional()
    .describe('Text highlight color as RGB (each 0-1)'),
  link_url: z.string().url().optional()
    .describe('URL to link the text to')
}).strict().refine(
  data => data.end_index > data.start_index,
  { message: 'end_index must be greater than start_index' }
);

export type UpdateTextStyleInput = z.infer<typeof UpdateTextStyleInputSchema>;

export const UpdateParagraphStyleInputSchema = z.object({
  document_id: z.string().min(1).describe('The ID of the Google Doc'),
  start_index: z.number().int().min(1)
    .describe('Start index (inclusive) in UTF-16 code units'),
  end_index: z.number().int().min(2)
    .describe('End index (exclusive) in UTF-16 code units'),
  segment_id: z.string().default('')
    .describe('Segment: empty string for body (default), or a header/footer/footnote ID'),
  tab_id: z.string().optional()
    .describe('Tab ID to apply style in. If omitted, operates on the first tab.'),
  named_style_type: z.enum([
    'NORMAL_TEXT', 'TITLE', 'SUBTITLE',
    'HEADING_1', 'HEADING_2', 'HEADING_3',
    'HEADING_4', 'HEADING_5', 'HEADING_6'
  ]).optional().describe('Named paragraph style (e.g., HEADING_1, NORMAL_TEXT)'),
  alignment: z.enum(['START', 'CENTER', 'END', 'JUSTIFIED']).optional()
    .describe('Paragraph alignment')
}).strict().refine(
  data => data.end_index > data.start_index,
  { message: 'end_index must be greater than start_index' }
);

export type UpdateParagraphStyleInput = z.infer<typeof UpdateParagraphStyleInputSchema>;

export const ReplaceAllTextInputSchema = z.object({
  document_id: z.string().min(1).describe('The ID of the Google Doc'),
  find_text: z.string().min(1).describe('The text to find'),
  replace_text: z.string().describe('The replacement text (can be empty to delete matches)'),
  match_case: z.boolean().default(true)
    .describe('Whether the search is case-sensitive (default: true)'),
  tab_ids: z.array(z.string()).optional()
    .describe('Tab IDs to search in. If omitted, searches all tabs.')
}).strict();

export type ReplaceAllTextInput = z.infer<typeof ReplaceAllTextInputSchema>;

const BatchRequestSchema = z.object({
  insertText: z.object({
    text: z.string(),
    location: z.object({
      index: z.number().int().min(1),
      segmentId: z.string().default(''),
      tabId: z.string().optional()
    }).optional(),
    endOfSegmentLocation: z.object({
      segmentId: z.string().default(''),
      tabId: z.string().optional()
    }).optional()
  }).optional(),
  deleteContentRange: z.object({
    range: z.object({
      startIndex: z.number().int().min(1),
      endIndex: z.number().int().min(2),
      segmentId: z.string().default(''),
      tabId: z.string().optional()
    })
  }).optional(),
  updateTextStyle: z.object({
    textStyle: z.record(z.unknown()),
    range: z.object({
      startIndex: z.number().int().min(1),
      endIndex: z.number().int().min(2),
      segmentId: z.string().default(''),
      tabId: z.string().optional()
    }),
    fields: z.string().min(1)
  }).optional(),
  replaceAllText: z.object({
    containsText: z.object({
      text: z.string().min(1),
      matchCase: z.boolean().default(true)
    }),
    replaceText: z.string(),
    tabsCriteria: z.object({
      tabIds: z.array(z.string())
    }).optional()
  }).optional(),
  updateParagraphStyle: z.object({
    paragraphStyle: z.record(z.unknown()),
    range: z.object({
      startIndex: z.number().int().min(1),
      endIndex: z.number().int().min(2),
      segmentId: z.string().default(''),
      tabId: z.string().optional()
    }),
    fields: z.string().min(1)
  }).optional()
}).strict();

export const BatchUpdateInputSchema = z.object({
  document_id: z.string().min(1).describe('The ID of the Google Doc'),
  requests: z.array(BatchRequestSchema)
    .min(1)
    .max(MAX_BATCH_REQUESTS)
    .describe(`Array of document update requests (max ${MAX_BATCH_REQUESTS})`)
}).strict();

export type BatchUpdateInput = z.infer<typeof BatchUpdateInputSchema>;
