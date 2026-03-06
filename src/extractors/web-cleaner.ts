/**
 * Web content cleaning — text-level post-processing for Jina Reader markdown.
 *
 * ARCHITECTURE: The heavy lifting is done at the HTML level by Jina's
 * X-Remove-Selector header (defined in web-extractor.ts). This module only
 * handles residual text-level noise that CSS selectors can't catch:
 *   - Jina metadata lines
 *   - Inline tracking URLs / ad payloads
 *   - Footer section truncation
 *   - Duplicate titles
 *   - Embedded JSON blocks
 */

/** Lines that are clearly non-content at the text level */
const NOISE_LINE_RE = [
  // Login/register prompts (handles markdown links between 登入 and 註冊)
  /登入[\s\S]*註冊|登录[\s\S]*注册/i,
  /sign\s*in[\s\S]*sign\s*up/i,
  /^\[?(skip to (?:main )?content|跳至主要內容)\]?(\(https?:\/\/[^)]+\))?\s*$/i,
  /^(cookie|privacy|terms|disclaimer|copyright|©)\b/i,
  // Separators and empty markers
  /^={3,}\s*$/, /^-{5,}\s*$/, /^\*\s*$/, /^\*\s+\*\s+\*\s*$/,
  /^\d+\s*$/,  // lone numbers (view counts)
  // Subscription filler
  /^(subscribe|訂閱|by subscribing|謝謝訂閱|掌握最新)/i,
  /^(gmail|hotmail|yahoo|outlook)\.(com|tw)/i,
  /^(祝你有美好的一天|請稍等|loading|載入中)\s*$/i,
  // Substack-specific
  /^(discover more from|over\s+[\d,]+\s+subscribers)/i,
  /^substack\s+is\s+the\s+home/i,
  /^(comments?\s+restacks?|see\s+all)\s*$/i,
  /^by\s+.{2,30}\s+·\s+(launched|started)\s/i,
  // Share/bookmark buttons
  /^(分享|收藏|share|bookmark)\s*$/i,
  /^\[view original\]/i,
  // Ad markers & UI chrome
  /^advertisements?\s*$/i,
  /^(展開|收起)\s*(收起|展開)?\s*$/,
  // Interactive / AI sections
  /^(你想知道哪些|ai\s*來解答|ask\s*(our\s*)?ai)/i,
];

/** Section headings that signal "footer zone" — everything after is removed */
const FOOTER_RE = [
  /^#{1,6}\s*(相關文章|延伸閱讀|推薦閱讀|related\s*(articles?|posts?)|you may also like)/i,
  /^(相關文章|延伸閱讀|推薦閱讀|related\s*(articles?|posts?))\s*$/i,
  /^#{1,6}\s*(留言|comments?|discussion)\s/i,
  /^#{1,6}\s*(免責聲明|disclaimer)\s*$/i,
  /^(你想知道哪些|ai\s*來解答)/i,
  /^#{1,6}\s*(ready for more|see\s+all)\s*\??\s*$/i,
  /^#{1,6}\s*subscribe to\s/i,
];

/** URL patterns indicating ad/tracking links */
const AD_URL_RE = /\/ads\/click|itadapi\.|doubleclick|googlesyndication|adservice|taboola|outbrain/i;

/** Truncate everything after a "footer zone" heading */
export function stripFooterSections(text: string): string {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (FOOTER_RE.some(p => p.test(lines[i].trim()))) {
      let end = i;
      while (end > 0 && !lines[end - 1].trim()) end--;
      return lines.slice(0, end).join('\n');
    }
  }
  return text;
}

/** Remove duplicate title lines — Jina often repeats the page title */
export function deduplicateTitle(text: string, title: string): string {
  if (!title || title === 'Untitled') return text;
  const norm = (s: string) => s.replace(/^#+\s*/, '').replace(/\s*[|｜–—].{0,30}$/, '').trim();
  const nt = norm(title);
  if (nt.length < 10) return text;
  let seen = 0;
  return text.split('\n').filter(line => {
    if (norm(line.trim()) === nt) { seen++; return seen <= 1; }
    return true;
  }).join('\n');
}

/**
 * Strip HTML tags from markdown content (GitHub README, etc.).
 * Keeps inner text, removes badges/shields, alignment wrappers.
 */
export function stripHtmlTags(text: string): string {
  return text
    // HTML comments
    .replace(/<!--[\s\S]*?-->/g, '')
    // Badge links: <a href="..."><img ...shields.io...></a>
    .replace(/<a[^>]*>\s*<img[^>]*(?:shields\.io|badge|img\.shields)[^>]*\/?>\s*<\/a>/gi, '')
    // Standalone badge/shield images
    .replace(/<img[^>]*(?:shields\.io|badge)[^>]*\/?>/gi, '')
    // Self-closing tags (br, hr, img without useful alt)
    .replace(/<(?:br|hr)\s*\/?>/gi, '\n')
    .replace(/<img[^>]*\/?>/gi, '')
    // Block-level wrappers: extract inner text (p, div, h1-h6, center, details, summary)
    .replace(/<(p|div|center|h[1-6]|details|summary)[^>]*>([\s\S]*?)<\/\1>/gi, '$2\n')
    // Remaining opening/closing tags
    .replace(/<\/?[a-z][a-z0-9]*[^>]*>/gi, '')
    // HTML entities
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    // Clean up whitespace
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Remove embedded JSON blocks (SEO structured data leaked by Jina) */
export function stripJsonBlocks(text: string): string {
  return text.split('\n').filter(line => {
    const t = line.trim();
    if (t.startsWith('{') && t.endsWith('}') && t.length > 80) {
      try { JSON.parse(t); return false; } catch { /* keep */ }
    }
    return true;
  }).join('\n');
}

/**
 * Text-level cleanup — handles residual noise that Jina's CSS selectors miss.
 * Kept minimal because the heavy filtering is done at the HTML level.
 */
export function cleanWebChrome(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) { result.push(lines[i]); continue; }

    // Pattern-based noise
    if (NOISE_LINE_RE.some(p => p.test(trimmed))) continue;

    // Ad/tracking URLs
    if (AD_URL_RE.test(trimmed)) continue;

    // Extremely long lines (tracking payloads, minified code)
    if (trimmed.length > 1000) continue;

    // Empty-text links: [](url) — ad/promo blocks
    if (/^\[\]\(https?:\/\//.test(trimmed)) continue;

    // Sponsored markers (Taboola, Outbrain)
    if (/\bSponsored\b/i.test(trimmed) && /taboola|outbrain|popup\./i.test(trimmed)) continue;

    // Multi-link nav lines (3+ markdown links on one line)
    const linkHits = trimmed.match(/\]\(https?:\/\//g);
    if (linkHits && linkHits.length >= 3 && trimmed.length < 500) continue;

    // Adjacent short links without text between them: [a](url)[b](url)
    if (linkHits && linkHits.length >= 2 && /\)\[/.test(trimmed) && trimmed.length < 200) continue;

    // Short pure-text nav labels (≤6 chars, letters only, not headings)
    if (trimmed.length <= 6 && /^[\p{L}]+$/u.test(trimmed) && !trimmed.startsWith('#')) continue;

    // Linked images with tooltips: [![...](img)](link) or [![...](img)Name](url)
    if (/^\[!\[.*?\]\(.+?\)[^\]]{0,30}\]\(.+?\)\s*$/.test(trimmed)) continue;

    // Small standalone images (avatars, logos, decorations)
    if (/^!\[Image \d+[:\]]/i.test(trimmed) && trimmed.length < 120) continue;
    if (/^!\[.*?\]\(https?:\/\/[^)]*\/(logo|icon|avatar|badge|circled)[^)]*\)/i.test(trimmed)) continue;

    // Short link-only lines in blocks (nav/promo)
    if (/^\[?.{1,35}\]?\(https?:\/\/[^)]+\)\s*$/.test(trimmed)) {
      const prev = i > 0 ? lines[i - 1].trim() : '';
      const next = i < lines.length - 1 ? lines[i + 1].trim() : '';
      const isLink = (s: string) => /\]\(https?:\/\//.test(s) && s.length < 80;
      if (isLink(prev) || isLink(next) || !prev) continue;
    }

    // Bullet link items in clusters (related articles/questions nav)
    if (/^\*\s+\[.{1,80}\]\(https?:\/\/[^)]+\)\s*$/.test(trimmed)) {
      const prev = i > 0 ? lines[i - 1].trim() : '';
      const next = i < lines.length - 1 ? lines[i + 1].trim() : '';
      if (/^\*\s+\[/.test(prev) || /^\*\s+\[/.test(next)) continue;
    }

    // Ordered list nav: 1. [text](url) in clusters
    if (/^\d+\.\s+\[.{1,60}\]\(https?:\/\/[^)]+.*\)\s*$/.test(trimmed)) {
      const prev = i > 0 ? lines[i - 1].trim() : '';
      const next = i < lines.length - 1 ? lines[i + 1].trim() : '';
      if (/^\d+\.\s+\[/.test(prev) || /^\d+\.\s+\[/.test(next)) continue;
    }

    // Date+category metadata line: 2026.02.19|[category](url)
    if (/^\d{4}\.\d{2}\.\d{2}\s*\|?\s*\[/.test(trimmed) && trimmed.length < 100) continue;

    // Hashtag links: [＃tag](url) or [#tag](url)
    if (/^\[[\#＃].{1,20}\]\(https?:\/\/[^)]+\)\s*$/.test(trimmed)) continue;

    // Short non-content lines (nav text clusters like "問答 文章 Tag 邦友")
    if (trimmed.length < 30 && /^[\p{L}\s]+$/u.test(trimmed) && trimmed.split(/\s+/).length >= 3) continue;

    // Long recommendation cards (> 200 chars, single link block)
    if (/^\[.*?\]\(https?:\/\/[^)]*\)\s*$/.test(trimmed) && trimmed.length > 200) continue;

    result.push(lines[i]);
  }

  return result.join('\n').replace(/\n{4,}/g, '\n\n\n');
}
