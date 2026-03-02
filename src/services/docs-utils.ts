/**
 * Utility functions for Google Docs API tools
 */

import { docs_v1 } from 'googleapis';
import { CHARACTER_LIMIT } from '../constants.js';

/** Simplified paragraph with formatting info */
export interface SimplifiedParagraph {
  startIndex: number;
  endIndex: number;
  text: string;
  namedStyleType?: string;
  alignment?: string;
  listInfo?: {
    listId: string;
    nestingLevel: number;
    ordered: boolean;
    glyphFormat?: string;
  };
  elements: SimplifiedTextRun[];
}

/** Simplified text run with formatting info */
export interface SimplifiedTextRun {
  content: string;
  startIndex: number;
  endIndex: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  fontSize?: number;
  fontFamily?: string;
  link?: string;
  footnoteId?: string;
}

/** Simplified tab info */
export interface SimplifiedTab {
  tabId: string;
  title: string;
  index: number;
  childTabs?: SimplifiedTab[];
}

/** Simplified document metadata */
export interface SimplifiedDocument {
  [key: string]: unknown;
  documentId: string;
  title: string;
  revisionId?: string;
  activeTabId?: string;
  tabs?: SimplifiedTab[];
  body?: {
    content: SimplifiedParagraph[];
  };
  footnotes?: Record<string, {
    content: SimplifiedParagraph[];
  }>;
}

/** Result of a batch update */
export interface BatchUpdateResult {
  [key: string]: unknown;
  documentId: string;
  replies: unknown[];
}

/** Result of a replace-all operation */
export interface ReplaceAllResult {
  [key: string]: unknown;
  documentId: string;
  occurrencesChanged: number;
}

/**
 * Flatten a tab tree into a list of SimplifiedTab objects
 */
function flattenTabs(tabs: any[]): SimplifiedTab[] {
  return tabs.map((tab: any) => {
    const props = tab.tabProperties || {};
    const simplified: SimplifiedTab = {
      tabId: props.tabId || '',
      title: props.title || '',
      index: props.index ?? 0,
    };
    if (tab.childTabs && tab.childTabs.length > 0) {
      simplified.childTabs = flattenTabs(tab.childTabs);
    }
    return simplified;
  });
}

/**
 * Find a tab by ID in a tab tree (recursive)
 */
function findTab(tabs: any[], tabId: string): any | null {
  for (const tab of tabs) {
    if (tab.tabProperties?.tabId === tabId) return tab;
    if (tab.childTabs) {
      const found = findTab(tab.childTabs, tabId);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Extract body content from a list of structural elements
 */
function extractParagraphs(content: docs_v1.Schema$StructuralElement[], lists?: Record<string, docs_v1.Schema$List>): SimplifiedParagraph[] {
  const paragraphs: SimplifiedParagraph[] = [];

  for (const element of content) {
    if (element.paragraph) {
      const para = element.paragraph;
      const textRuns: SimplifiedTextRun[] = [];
      let fullText = '';

      for (const el of para.elements || []) {
        if (el.textRun) {
          const style = el.textRun.textStyle || {};
          const run: SimplifiedTextRun = {
            content: el.textRun.content || '',
            startIndex: el.startIndex || 0,
            endIndex: el.endIndex || 0,
          };

          if (style.bold) run.bold = true;
          if (style.italic) run.italic = true;
          if (style.underline) run.underline = true;
          if (style.strikethrough) run.strikethrough = true;
          if (style.fontSize?.magnitude) run.fontSize = style.fontSize.magnitude;
          if (style.weightedFontFamily?.fontFamily) run.fontFamily = style.weightedFontFamily.fontFamily;
          if (style.link?.url) run.link = style.link.url;

          textRuns.push(run);
          fullText += el.textRun.content || '';
        } else if ((el as any).footnoteReference) {
          const fnRef = (el as any).footnoteReference;
          const run: SimplifiedTextRun = {
            content: '\u00B9', // superscript 1 as placeholder
            startIndex: el.startIndex || 0,
            endIndex: el.endIndex || 0,
            footnoteId: fnRef.footnoteId,
          };
          textRuns.push(run);
          fullText += '\u00B9';
        }
      }

      const simplified: SimplifiedParagraph = {
        startIndex: element.startIndex || 0,
        endIndex: element.endIndex || 0,
        text: fullText,
        elements: textRuns,
      };

      const pStyle = para.paragraphStyle;
      if (pStyle?.namedStyleType && pStyle.namedStyleType !== 'NORMAL_TEXT') {
        simplified.namedStyleType = pStyle.namedStyleType;
      }
      if (pStyle?.alignment && pStyle.alignment !== 'START') {
        simplified.alignment = pStyle.alignment;
      }

      if (para.bullet?.listId) {
        const listId = para.bullet.listId;
        const nestingLevel = para.bullet.nestingLevel || 0;
        const listDef = lists?.[listId];
        const levelDef = listDef?.listProperties?.nestingLevels?.[nestingLevel];
        simplified.listInfo = {
          listId,
          nestingLevel,
          ordered: !!levelDef?.glyphType,
          glyphFormat: levelDef?.glyphFormat || undefined,
        };
      }

      paragraphs.push(simplified);
    } else if (element.table) {
      // Recurse into table rows and cells to extract their paragraphs
      for (const row of element.table.tableRows || []) {
        for (const cell of row.tableCells || []) {
          if (cell.content) {
            paragraphs.push(...extractParagraphs(cell.content, lists));
          }
        }
      }
    }
  }

  return paragraphs;
}

/**
 * Simplify a Google Docs API document into a flat, readable structure.
 * When useTabs is true, reads from document.tabs instead of document.body.
 */
export function simplifyDocument(doc: docs_v1.Schema$Document, includeContent: boolean, tabId?: string): SimplifiedDocument {
  const result: SimplifiedDocument = {
    documentId: doc.documentId!,
    title: doc.title!,
    revisionId: doc.revisionId || undefined,
  };

  // If tabs are present (includeTabsContent was used), use tab structure
  const tabs = (doc as any).tabs;
  if (tabs && tabs.length > 0) {
    result.tabs = flattenTabs(tabs);

    if (includeContent) {
      let targetTab: any;
      if (tabId) {
        targetTab = findTab(tabs, tabId);
        if (!targetTab) {
          throw new Error(`Tab with ID '${tabId}' not found. Use gdocs_list_tabs to see available tabs.`);
        }
      } else {
        targetTab = tabs[0]; // default to first tab
      }

      result.activeTabId = targetTab.tabProperties?.tabId;
      const bodyContent = targetTab.documentTab?.body?.content;
      const listsMap = targetTab.documentTab?.lists;
      if (bodyContent) {
        result.body = { content: extractParagraphs(bodyContent, listsMap) };
      }
      // Extract footnote content from tab
      const footnotes = targetTab.documentTab?.footnotes;
      if (footnotes) {
        result.footnotes = {};
        for (const [fnId, fn] of Object.entries(footnotes as Record<string, any>)) {
          if (fn.content) {
            result.footnotes[fnId] = { content: extractParagraphs(fn.content, listsMap) };
          }
        }
      }
    }
  } else if (includeContent && doc.body?.content) {
    // Legacy path: no tabs in response
    result.body = { content: extractParagraphs(doc.body.content, (doc as any).lists) };
    // Extract footnotes from legacy path
    const footnotes = (doc as any).footnotes;
    if (footnotes) {
      result.footnotes = {};
      for (const [fnId, fn] of Object.entries(footnotes as Record<string, any>)) {
        if (fn.content) {
          result.footnotes[fnId] = { content: extractParagraphs(fn.content, (doc as any).lists) };
        }
      }
    }
  }

  return result;
}

/**
 * Format a simplified document as markdown
 */
export function formatDocumentMarkdown(doc: SimplifiedDocument): string {
  const parts: string[] = [];

  parts.push(`**${doc.title}**`);
  parts.push(`- Document ID: \`${doc.documentId}\``);
  if (doc.revisionId) {
    parts.push(`- Revision: \`${doc.revisionId}\``);
  }

  if (doc.body?.content) {
    parts.push('');
    parts.push('## Content');
    parts.push('');

    for (const para of doc.body.content) {
      if (para.text.trim() === '') continue;

      const stylePrefix = para.namedStyleType
        ? `[${para.namedStyleType}] `
        : '';

      const listPrefix = para.listInfo
        ? `[${para.listInfo.ordered ? 'numbered' : 'bullet'}${para.listInfo.nestingLevel > 0 ? `, L${para.listInfo.nestingLevel}` : ''}] `
        : '';

      // Show formatting annotations inline
      const formattedRuns = para.elements.map(run => {
        if (run.footnoteId) {
          return `[footnote:${run.footnoteId}@${run.startIndex}]`;
        }
        const tags: string[] = [];
        if (run.bold) tags.push('B');
        if (run.italic) tags.push('I');
        if (run.underline) tags.push('U');
        if (run.strikethrough) tags.push('S');
        if (run.link) tags.push(`link:${run.link}`);

        const content = run.content.replace(/\n$/, '');
        if (tags.length > 0 && content.trim()) {
          return `[${tags.join(',')}]${content}[/${tags.join(',')}]`;
        }
        return content;
      }).join('');

      parts.push(`${listPrefix}${stylePrefix}(${para.startIndex}-${para.endIndex}) ${formattedRuns}`);
    }
  }

  // Render footnote content
  if (doc.footnotes) {
    parts.push('');
    parts.push('## Footnotes');
    for (const [fnId, fn] of Object.entries(doc.footnotes)) {
      parts.push('');
      parts.push(`### Footnote: ${fnId}`);
      for (const para of fn.content) {
        if (para.text.trim() === '') continue;
        const formattedRuns = para.elements.map(run => {
          const tags: string[] = [];
          if (run.bold) tags.push('B');
          if (run.italic) tags.push('I');
          if (run.underline) tags.push('U');
          if (run.link) tags.push(`link:${run.link}`);
          const content = run.content.replace(/\n$/, '');
          if (tags.length > 0 && content.trim()) {
            return `[${tags.join(',')}]${content}[/${tags.join(',')}]`;
          }
          return content;
        }).join('');
        parts.push(`(${para.startIndex}-${para.endIndex}) ${formattedRuns}`);
      }
    }
  }

  return parts.join('\n');
}

/**
 * Build the fields mask and TextStyle object from input params
 */
export function buildTextStyle(params: {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  font_size?: number;
  font_family?: string;
  foreground_color?: { red: number; green: number; blue: number };
  background_color?: { red: number; green: number; blue: number };
  link_url?: string;
}): { textStyle: docs_v1.Schema$TextStyle; fields: string } {
  const textStyle: docs_v1.Schema$TextStyle = {};
  const fieldsList: string[] = [];

  if (params.bold !== undefined) {
    textStyle.bold = params.bold;
    fieldsList.push('bold');
  }
  if (params.italic !== undefined) {
    textStyle.italic = params.italic;
    fieldsList.push('italic');
  }
  if (params.underline !== undefined) {
    textStyle.underline = params.underline;
    fieldsList.push('underline');
  }
  if (params.strikethrough !== undefined) {
    textStyle.strikethrough = params.strikethrough;
    fieldsList.push('strikethrough');
  }
  if (params.font_size !== undefined) {
    textStyle.fontSize = { magnitude: params.font_size, unit: 'PT' };
    fieldsList.push('fontSize');
  }
  if (params.font_family !== undefined) {
    textStyle.weightedFontFamily = { fontFamily: params.font_family };
    fieldsList.push('weightedFontFamily');
  }
  if (params.foreground_color !== undefined) {
    textStyle.foregroundColor = {
      color: { rgbColor: params.foreground_color }
    };
    fieldsList.push('foregroundColor');
  }
  if (params.background_color !== undefined) {
    textStyle.backgroundColor = {
      color: { rgbColor: params.background_color }
    };
    fieldsList.push('backgroundColor');
  }
  if (params.link_url !== undefined) {
    textStyle.link = { url: params.link_url };
    fieldsList.push('link');
  }

  return { textStyle, fields: fieldsList.join(',') };
}

/**
 * Truncate document content for display
 */
export function truncateDocContent(text: string, limit: number = CHARACTER_LIMIT): string {
  if (text.length <= limit) return text;
  return text.substring(0, limit) +
    `\n\n[... Content truncated. Total length: ${text.length} characters, showing first ${limit}]`;
}
