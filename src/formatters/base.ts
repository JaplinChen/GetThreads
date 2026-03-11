import type { ExtractedContent } from '../extractors/types.js';
import type { PlatformFormatter } from './types.js';
import {
  buildFrontmatter,
  buildLinkedContent,
  buildStats,
  buildComments,
} from './shared.js';

function toPlainText(input: string): string {
  return input
    .replace(/!\[.*?\]\(.*?\)/g, ' ')
    .replace(/\[([^\]]+)\]\(.*?\)/g, '$1')
    .replace(/[\*_`>#]/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripStatsPrefix(input: string): string {
  return input
    .replace(/\*\*Duration:\*\*.*(?:\r?\n|$)/gi, ' ')
    .replace(/\*\*Stats:\*\*.*(?:\r?\n|$)/gi, ' ')
    .replace(/Duration:\s*\d+:\d{2}.*?(?=\s{2,}|$)/gi, ' ')
    .replace(/Stats:\s*Views:.*?(?=\s{2,}|$)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitSentences(input: string): string[] {
  return input
    .split(/[。！？!?\n；;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isLikelyStatsLine(input: string): boolean {
  const s = input.toLowerCase();
  return s.includes('views:')
    || s.includes('likes:')
    || s.includes('comments:')
    || s.includes('duration:')
    || /[0-9]{2,}/.test(s) && /(views|likes|comments|stats|duration)/i.test(s);
}

function collectContentSentences(content: ExtractedContent, displayText: string): string[] {
  const transcriptSentences = splitSentences(content.transcript ?? '')
    .filter((s) => s.length >= 10 && !isLikelyStatsLine(s));
  if (transcriptSentences.length > 0) return transcriptSentences;

  return splitSentences(stripStatsPrefix(toPlainText(displayText)))
    .filter((s) => s.length >= 10 && !isLikelyStatsLine(s));
}

function looksGeneric(input: string): boolean {
  const text = input.trim();
  if (!text) return true;
  const genericPhrases = [
    '先掌握影片核心主題',
    '整理可立即執行的步驟',
    '回看原片驗證關鍵細節',
    '建議先看重點整理',
    '影片已完成擷取',
    '影片已下載並附加到筆記',
  ];
  return genericPhrases.some((p) => text.includes(p));
}

function isReadableText(input: string): boolean {
  const text = input.trim();
  if (!text) return false;
  if (/[�]|嚙|銝|蝯|撌亙||/.test(text)) return false;

  const compact = text.replace(/\s+/g, '');
  if (!compact) return false;

  const safeChars = (compact.match(/[A-Za-z0-9\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af.,!?;:()\[\]{}'"`~@#$%^&*+\-_=\\/|]/g) ?? []).length;
  return safeChars / compact.length >= 0.6;
}

/** 在標點或空格邊界處截斷，避免句子斷在詞中間 */
function truncateAtBoundary(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const cut = text.slice(0, maxLen);
  const last = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('，'), cut.lastIndexOf('！'),
    cut.lastIndexOf('？'), cut.lastIndexOf('；'), cut.lastIndexOf(' '));
  return last > maxLen * 0.4 ? cut.slice(0, last + 1) : cut;
}

function fallbackSummary(content: ExtractedContent, displayText: string): string {
  const sentences = collectContentSentences(content, displayText);
  if (sentences.length > 0) {
    return truncateAtBoundary(sentences.slice(0, 3).join('。'), 200);
  }
  return '';
}

function fallbackAnalysis(content: ExtractedContent, displayText: string): string {
  const sentences = collectContentSentences(content, displayText);
  if (sentences.length >= 2) {
    const top = sentences.slice(0, 3);
    return [
      `影片重點聚焦在：${truncateAtBoundary(top[0], 80)}。`,
      `可落地的做法：${truncateAtBoundary(top[1], 80)}。`,
      top[2] ? `補充觀點：${truncateAtBoundary(top[2], 80)}。` : null,
    ].filter(Boolean).join(' ');
  }
  return '';
}

function fallbackKeyTakeaways(content: ExtractedContent, displayText: string): string[] {
  return collectContentSentences(content, displayText)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8 && isReadableText(s) && !looksGeneric(s))
    .slice(0, 5)
    .map((s) => truncateAtBoundary(s, 60).replace(/[。.!?]+$/g, ''));
}

export function assembleNote(
  content: ExtractedContent,
  localImagePaths: string[],
  localVideoPaths: string[],
  imageUrlMap: Map<string, string> | undefined,
  formatter: PlatformFormatter,
): string {
  const t = content.translation;
  const displayTitle = t?.translatedTitle ?? content.title;
  const displayText = t ? t.translatedText : content.text;

  const lines: string[] = [
    ...buildFrontmatter(content, displayTitle, displayText),
    '',
    `> **${content.authorHandle}** | ${content.date}`,
    '',
  ];

  if (t) {
    const langLabel: Record<string, string> = {
      en: 'English',
      'zh-CN': 'Chinese (Simplified)',
      'zh-TW': 'Chinese (Traditional)',
      ja: 'Japanese',
      ko: 'Korean',
      other: 'Other',
    };
    lines.push(`> Translated from: ${langLabel[t.detectedLanguage] ?? 'Other'}`, '');
  }

  const { text: bodyText, usedPaths, inlinedVideoIndices: bodyInlinedVideos } = formatter.formatBody(displayText, imageUrlMap, localVideoPaths, content.videos);
  lines.push(bodyText, '');

  const cleanSummary = content.enrichedSummary
    && isReadableText(content.enrichedSummary)
    && !looksGeneric(content.enrichedSummary)
    ? content.enrichedSummary
    : fallbackSummary(content, displayText);
  if (cleanSummary) {
    lines.push('## 重點摘要', '', cleanSummary.slice(0, 300).replace(/\n/g, ' ').trim(), '');
  }

  const cleanAnalysis = content.enrichedAnalysis
    && isReadableText(content.enrichedAnalysis)
    && !looksGeneric(content.enrichedAnalysis)
    ? content.enrichedAnalysis
    : fallbackAnalysis(content, displayText);
  if (cleanAnalysis) {
    lines.push('## 內容分析', '', cleanAnalysis.replace(/\n/g, ' ').trim(), '');
  }

  const cleanKeyPoints = (content.enrichedKeyPoints ?? [])
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && isReadableText(s))
    .slice(0, 5);
  const keyTakeaways = cleanKeyPoints.length > 0 ? cleanKeyPoints : fallbackKeyTakeaways(content, displayText);
  if (keyTakeaways.length > 0) {
    lines.push('## 重點整理（條列）', '');
    for (const point of keyTakeaways) lines.push(`- ${point}`);
    lines.push('');
  }

  lines.push(...formatter.extraSections(content));
  lines.push(...buildLinkedContent(content.linkedContent));

  const remainingImages = formatter.filterRemainingImages(localImagePaths, usedPaths);
  if (remainingImages.length > 0) {
    lines.push('## Images', '');
    for (const imgPath of remainingImages) lines.push(`![](${imgPath})`, '');
  }

  const inlinedVideoIndices = new Set<number>(bodyInlinedVideos);
  for (let i = 0; i < localVideoPaths.length; i++) {
    if (usedPaths.has(localVideoPaths[i])) inlinedVideoIndices.add(i);
  }
  const remainingVideos = content.videos.filter((_, i) => !inlinedVideoIndices.has(i));
  const remainingVideoPaths = localVideoPaths.filter((_, i) => !inlinedVideoIndices.has(i));
  const videoLines = formatter.formatVideos(remainingVideos, remainingVideoPaths);
  if (videoLines.length > 0) lines.push('## Videos', '', ...videoLines);

  lines.push(...buildStats(content.reposts));
  lines.push(...buildComments(content.comments, content.commentCount));

  const category = content.category ?? 'other';
  const categoryLink = category.replace(/\//g, '-');
  lines.push(`Category: [[${categoryLink}]]`, '');
  lines.push(`[View original](${content.url})`, '');

  return lines.join('\n');
}

