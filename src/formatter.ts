import type { ExtractedContent } from './extractors/types.js';
import { extractKeywords } from './classifier.js';

const PLATFORM_LABELS: Record<string, string> = {
  x: 'X (Twitter)',
  threads: 'Threads',
  youtube: 'YouTube',
  github: 'GitHub',
  reddit: 'Reddit',
  web: 'Web',
};

/** Build an Obsidian-compatible Markdown note from extracted content */
export function formatAsMarkdown(
  content: ExtractedContent,
  localImagePaths: string[],
): string {
  const platformLabel = PLATFORM_LABELS[content.platform] ?? content.platform;
  const tag = content.platform;

  const category = content.category ?? '其他';
  const categoryTag = category.replace(/\s+/g, '-');

  // Build tags list: base tags + any extra platform tags (e.g. GitHub topics)
  const allTags = [tag, 'archive', categoryTag, ...(content.extraTags ?? [])];

  const frontmatterLines: string[] = [
    '---',
    `title: "${escape(content.title)}"`,
    `source: ${platformLabel}`,
    `author: "${escape(content.authorHandle)}"`,
    `date: ${content.date}`,
    `url: "${content.url}"`,
    `tags: [${allTags.join(', ')}]`,
    `category: ${category}`,
    `keywords: [${(content.enrichedKeywords ?? extractKeywords(content.title, content.text)).join(', ')}]`,
    `summary: "${escape(stripMarkdown(content.enrichedSummary ?? content.text.slice(0, 150))).replace(/\n/g, ' ')}"`,
  ];
  if (content.stars != null) frontmatterLines.push(`stars: ${content.stars}`);
  frontmatterLines.push('---');

  // body (README 等長文) 優先用 text（已含 description+stats），避免取到 HTML badge
  const summaryText = content.enrichedSummary ?? content.text.slice(0, 300);

  const lines: string[] = [
    ...frontmatterLines,
    '',
    `> **${content.authorHandle}** | ${content.date}`,
    '',
    linkifyUrls(content.text),
    '',
  ];

  // Only show 重點摘要 if AI-enriched (not a duplicate of the body text)
  if (content.enrichedSummary) {
    lines.push('## 重點摘要', '');
    lines.push(summaryText.replace(/\n/g, ' ').trim());
    lines.push('');
  }

  if (content.body) {
    lines.push('## README', '', content.body, '');
  }

  // Embed local images
  if (localImagePaths.length > 0) {
    lines.push('## Images', '');
    for (const imgPath of localImagePaths) {
      lines.push(`![](${imgPath})`, '');
    }
  }

  // Embed videos as links (can't embed mp4 directly in Obsidian)
  if (content.videos.length > 0) {
    lines.push('## Videos', '');
    for (let i = 0; i < content.videos.length; i++) {
      const v = content.videos[i];
      const label = v.type === 'gif' ? 'GIF'
        : content.platform === 'youtube' ? `▶ 在 YouTube 觀看`
        : `Video ${i + 1}`;
      lines.push(`- [${label}](${v.url})`, '');
    }
  }

  // Engagement stats
  const stats: string[] = [];
  if (content.likes != null) stats.push(`Likes: ${content.likes}`);
  if (content.reposts != null) stats.push(`Reposts: ${content.reposts}`);
  if (stats.length > 0) {
    lines.push('---', '', stats.join(' | '), '');
  }

  // Comments section (populated by /comments command)
  if (content.comments && content.comments.length > 0) {
    lines.push('## 評論', '');
    for (const c of content.comments.slice(0, 20)) {
      const likes = c.likes ? ` ❤️${c.likes}` : '';
      lines.push(`**${c.author}** \`${c.authorHandle}\`${likes}`);
      lines.push(c.text);
      if (c.replies?.length) {
        for (const r of c.replies.slice(0, 3)) {
          lines.push(`> **${r.author}**: ${r.text.slice(0, 200)}`);
        }
      }
      lines.push('');
    }
    if (content.commentCount && content.commentCount > content.comments.length) {
      lines.push(`_共 ${content.commentCount} 則，顯示前 ${content.comments.length} 則_`, '');
    }
  }

  // Source link
  lines.push(`[View original](${content.url})`, '');

  return lines.join('\n');
}

function escape(s: string): string {
  return s.replace(/"/g, '\\"');
}

/** Strip basic Markdown syntax for plain-text fields like summary */
function stripMarkdown(s: string): string {
  return s
    .replace(/!\[.*?\]\(.*?\)/g, '')   // images
    .replace(/\[([^\]]+)\]\(.*?\)/g, '$1') // links → text only
    .replace(/#{1,6}\s+/g, '')          // headings
    .replace(/[*_`>]/g, '')             // bold/italic/code/quote
    .replace(/\s+/g, ' ')
    .trim();
}

/** Convert bare URLs in text to Markdown links, skipping already-linked ones */
function linkifyUrls(text: string): string {
  // Match https?:// URLs not already inside []() or <>
  return text.replace(
    /(?<!\]\()(?<![<])(https?:\/\/[^\s\)\]\>,'"]+)/g,
    '[$1]($1)',
  );
}
