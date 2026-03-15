/** Keyword-based content classifier — returns a Traditional Chinese category label */
import { classifyWithLearnedRules } from './learning/dynamic-classifier.js';
import { CATEGORIES, type CategoryRule } from './classifier-categories.js';

/** 短 ASCII 關鍵字（≤3 字元）用 word boundary，避免 'ai' 匹配 'Aitken' 等 substring 誤判 */
function keywordMatch(h: string, kw: string): boolean {
  const k = kw.toLowerCase();
  return k.length <= 3 && /^[a-z0-9]+$/.test(k) ? new RegExp(`\\b${k}\\b`).test(h) : h.includes(k);
}

/** 檢查該分類的 exclude 關鍵字是否命中（命中 = 應排除此分類） */
function isExcluded(cat: CategoryRule, titleH: string, bodyH: string): boolean {
  if (!cat.exclude?.length) return false;
  return cat.exclude.some(kw => keywordMatch(titleH, kw) || keywordMatch(bodyH, kw));
}

/** 計算分類的關鍵字命中分數：標題命中 ×2，本文命中 ×1 */
function scoreCategory(cat: CategoryRule, titleH: string, bodyH: string): number {
  let score = 0;
  for (const kw of cat.keywords) {
    if (keywordMatch(titleH, kw)) score += 2;
    else if (bodyH && keywordMatch(bodyH, kw)) score += 1;
  }
  return score;
}

export function classifyContent(title: string, text: string): string {
  // Step 0：優先使用 vault 學習到的規則（信心 >= 0.75）
  const learned = classifyWithLearnedRules(title, text);
  if (learned) return learned;

  const titleH = title.toLowerCase();
  const bodyH = text.toLowerCase();

  // 計分制：遍歷所有分類，累加分數，最高分勝出
  const scores = new Map<string, { score: number; order: number }>();

  for (let i = 0; i < CATEGORIES.length; i++) {
    const cat = CATEGORIES[i];
    if (isExcluded(cat, titleH, bodyH)) continue;

    const score = scoreCategory(cat, titleH, bodyH);
    if (score <= 0) continue;

    const existing = scores.get(cat.name);
    if (existing) {
      existing.score += score; // 同名分類累加
    } else {
      scores.set(cat.name, { score, order: i });
    }
  }

  // 最高分勝出，同分按 CATEGORIES 順序（越前面優先級越高）
  let bestName = '';
  let bestScore = 0;
  let bestOrder = Infinity;

  for (const [name, { score, order }] of scores) {
    if (score > bestScore || (score === bestScore && order < bestOrder)) {
      bestName = name;
      bestScore = score;
      bestOrder = order;
    }
  }

  return bestName || '其他';
}

/** 從內容中提取命中的所有關鍵詞（最多 5 個），供 frontmatter keywords 欄位使用 */
export function extractKeywords(title: string, text: string): string[] {
  const titleH = title.toLowerCase();
  const bodyH = text.toLowerCase();
  const matched: string[] = [];
  for (const cat of CATEGORIES) {
    if (isExcluded(cat, titleH, bodyH)) continue;
    for (const kw of cat.keywords) {
      if (keywordMatch(titleH, kw) || keywordMatch(bodyH, kw)) {
        matched.push(kw);
        if (matched.length >= 5) return matched;
      }
    }
  }
  return matched;
}
