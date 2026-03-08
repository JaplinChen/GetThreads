import type { ExtractedContent } from '../extractors/types.js';
import type { SaveResult } from '../saver.js';

export function formatUnsupportedUrlMessage(url: string): string {
  return `\u4e0d\u652f\u63f4\u7684\u9023\u7d50\uff1a${url}`;
}

export function formatProcessingMessage(platform: string): string {
  return `\u6b63\u5728\u8655\u7406 ${platform} \u9023\u7d50...`;
}

export function formatDuplicateMessage(mdPath: string): string {
  return `\u5df2\u5132\u5b58\u904e\uff0c\u7565\u904e\uff1a\n${mdPath}`;
}

export function formatSavedSummary(content: ExtractedContent, result: SaveResult): string {
  return [
    `\u5df2\u5132\u5b58\uff1a${content.author} (${content.authorHandle})`,
    `\u5206\u985e\uff1a${content.category}`,
    '',
    content.text.length > 200 ? content.text.slice(0, 200) + '...' : content.text,
    '',
    `\u5716\u7247\uff1a${result.imageCount} | \u5f71\u7247\uff1a${result.videoCount}${content.comments?.length ? ` | \u8a55\u8ad6\uff1a${content.comments.length}` : ''}`,
    `\u6a94\u6848\uff1a${result.mdPath}`,
  ].join('\n');
}

export const AI_TRANSCRIPT_PREFIX = '\n\n\u6587\u5b57\u7a3f\uff1a';
