/** Keyword-based content classifier — returns a Traditional Chinese category label */
import { classifyWithLearnedRules } from './learning/dynamic-classifier.js';

// ── AI 子分類精煉：當通用 AI 命中時，用寬鬆關鍵詞嘗試歸入更精確的子分類 ──
const AI_SUBCATEGORY_REFINEMENT: Array<{ name: string; keywords: string[] }> = [
  {
    name: 'AI/Claude',
    keywords: ['claude code', 'cowork', 'claude cowork', 'openwork', '辦公協作'],
  },
  {
    name: 'AI/OpenAI',
    keywords: ['codex', 'openai codex', 'gpt-5', 'chatgpt'],
  },
  {
    name: 'AI/Google',
    keywords: ['gemini', 'notebooklm', 'notebook lm', 'nano banana', 'google ai'],
  },
  {
    name: 'AI/OpenClaw',
    keywords: ['openclaw', 'open claw', 'clawbot', '龍蝦'],
  },
  {
    name: 'AI/工具',
    keywords: [
      '工具', 'tool', 'tools', '助手', 'assistant', 'bot',
      '自動化', 'automation', '圖片生成', '圖片放大', 'image generat',
      'image enhance', '會議記錄', '摘要', '放大',
      'open-sable', 'autoglm', 'fine grain', 'desk mate', 'luna desk',
    ],
  },
  {
    name: 'AI/Agent',
    keywords: [
      'agent', 'multi-agent', 'agent orchestration', 'agent 軍團',
      'agent 架構', 'agent monitoring',
    ],
  },
  {
    name: 'AI/應用',
    keywords: [
      '應用', '賺錢', '情報', '模板', 'template', 'workflow',
    ],
  },
  {
    name: 'AI/學習',
    keywords: [
      'api範例', 'api 範例', 'api教學', 'api 教學', 'api tutorial',
      '貢獻榜', '開源貢獻',
    ],
  },
  {
    name: 'AI/提示詞',
    keywords: [
      '優化技巧', '細節優化', '生成技巧',
    ],
  },
  {
    name: 'AI/模型',
    keywords: [
      '大模型', '模型api', '模型 api', 'api聚合', 'api 聚合',
    ],
  },
];

/** 短 ASCII 關鍵字（≤3 字元）用 word boundary，避免 'ai' 匹配 'Aitken' 等 substring 誤判 */
function keywordMatch(h: string, kw: string): boolean {
  const k = kw.toLowerCase();
  return k.length <= 3 && /^[a-z0-9]+$/.test(k) ? new RegExp(`\\b${k}\\b`).test(h) : h.includes(k);
}

/** 當初次分類命中通用 AI 時，用 title+body 合併文本精煉到子分類 */
function refineAISubcategory(title: string, body: string): string | null {
  const titleLower = title.toLowerCase();
  const bodyLower = body.toLowerCase();

  for (const sub of AI_SUBCATEGORY_REFINEMENT) {
    // 標題命中 → 直接歸類（高信心）
    if (sub.keywords.some((kw) => keywordMatch(titleLower, kw))) {
      return sub.name;
    }
  }

  // Body 命中需要至少 2 個不同關鍵詞才歸類（避免偶然提及）
  for (const sub of AI_SUBCATEGORY_REFINEMENT) {
    const matchCount = sub.keywords.filter(
      (kw) => keywordMatch(bodyLower, kw),
    ).length;
    if (matchCount >= 2) {
      return sub.name;
    }
  }
  return null;
}

const CATEGORIES: Array<{ name: string; keywords: string[] }> = [
  // ── AI 子分類（越精確越前面，通用 AI 排最後）──
  {
    name: 'AI/Claude',
    keywords: [
      'claude code', 'cowork', 'claude cowork', 'openwork', '辦公協作',
    ],
  },
  {
    name: 'AI/OpenAI',
    keywords: [
      'codex', 'openai codex', 'gpt-5', 'chatgpt',
    ],
  },
  {
    name: 'AI/Google',
    keywords: [
      'gemini', 'notebooklm', 'notebook lm', 'nano banana', 'google ai',
    ],
  },
  {
    name: 'AI/OpenClaw',
    keywords: [
      'openclaw', 'open claw', 'openclaws', 'clawbot',
      '龍蝦', '龙虾',
    ],
  },
  {
    name: 'AI/工具',
    keywords: [
      'clawdbot',
      'cursor', 'windsurf', 'cline', 'mcp server', 'mcp tool', 'mcp ',
      'perplexity', 'midjourney', 'stable diffusion', 'comfyui',
      'n8n', 'make.com', 'telegram bot', 'obsidian plugin',
      'skill清单', 'skill 清單',
    ],
  },
  { // Obsidian 排在通用生產力之前
    name: '生產力/Obsidian',
    keywords: [
      'obsidian', 'pkm', 'zettelkasten',
      '第二大腦', '第二大脑', '筆記軟體', '笔记软件', '筆記工具', '笔记工具',
      '雙向連結', '雙向鏈結', '知識圖譜', '知識網路', '知識網絡',
    ],
  },
  { // 教學/入門（裸字「入門」過廣，只保留複合詞）
    name: 'AI/學習',
    keywords: [
      '完全教程', '教程', '小白', '新手',
      '入門指南', '入门指南', '入門完全', '入门完全', '入門教學', '入门教学',
      '从0开始', '从零开始', '零基礎', '零基础', '零基礎入門', '零基础入门',
      'getting started', '安装后必看', '手把手', '3分钟', '0代码',
    ],
  },
  {
    name: 'AI/提示詞',
    keywords: [
      'prompt engineering', 'system prompt', '提示词', '提示詞',
      '调教', '調教', '角色扮演', 'role play', 'jailbreak',
      'few-shot', 'zero-shot', 'chain of thought', 'cot',
    ],
  },
  {
    name: 'AI/模型',
    keywords: [
      'minimax', 'deepseek', 'qwen', 'llama', 'mistral', 'gemma',
      'phi-', 'gpt-4o', 'gpt-5', 'o1', 'o3', 'claude 3', 'claude 4',
      'benchmark', 'leaderboard', '模型评测', '模型評測', '免费 claude', '免費 claude',
    ],
  },
  {
    name: 'AI/Agent',
    keywords: [
      'ai agent', 'agentic engineer', 'agent工程', 'agent engineer',
      'multi-agent', 'agent orchestration', 'agent 軍團', 'agent 架構',
      'agent framework', 'agent monitoring',
    ],
  },
  {
    name: 'AI/應用',
    keywords: [
      'best practices', '最佳实践', '最佳實踐', '工程指南',
      'rag', 'retrieval', 'vector database', 'embedding',
      'langchain', 'langgraph', '数据抓取', '資料抓取',
    ],
  },
  { // 通用 AI（兜底）
    name: 'AI',
    keywords: [
      'ai', 'gpt', 'llm', 'claude', 'openai', 'anthropic',
      'copilot', 'diffusion', 'chatbot', '人工智慧', '大語言模型',
      '大语言模型', '機器學習', 'machine learning', 'deep learning',
    ],
  },

  // ── 其他頂層分類 ──
  { // Apple 產品排在通用科技之前
    name: '科技/Apple',
    keywords: ['mac', 'macbook', 'iphone', 'ipad', 'macos', 'apple silicon', 'apple watch', 'ios ', 'mac mini', 'mac studio', 'mac pro', 'imac', 'macwhisper', 'orbstack'],
  },
  {
    name: '科技',
    keywords: ['hardware', 'chip', 'semiconductor', '晶片', '半導體', '硬體', '科技新聞', '休眠機制'],
  },
  {
    name: '程式設計',
    keywords: ['programming', 'javascript', 'typescript', 'python', 'rust', 'react', 'nextjs', '程式設計', 'backend', 'frontend', 'database', '訂閱管理'],
  },
  {
    name: '投資理財',
    keywords: [
      'stock', 'etf', 'crypto', 'bitcoin', 'invest', 'portfolio',
      'dividend', '股票', '基金', '投資', '理財', '加密貨幣',
      '比特幣', '報酬', '資產', 'finance', 'market', '市場',
    ],
  },
  {
    name: '創業商業',
    keywords: [
      'startup', 'founder', 'vc', 'venture', 'saas', 'product',
      'revenue', 'mrr', 'arr', 'b2b', '創業', '創辦人', '商業',
      '商業模式', 'business', 'entrepreneur', '產品',
    ],
  },
  {
    name: '設計',
    keywords: ['ux design', 'ui design', 'figma', 'typography', 'brand design', 'logo', 'visual design', '排版', '品牌設計', '視覺設計', 'prototype', 'wireframe'],
  },
  {
    name: '行銷',
    keywords: ['marketing', 'seo', 'google ads', 'facebook ads', 'growth hack', 'content marketing', 'social media marketing', 'campaign', '行銷', '廣告', '流量', 'viral'],
  },
  {
    name: '中文媒體',
    keywords: ['微博', 'weibo', '小紅書', '小红书', 'xiaohongshu', '紅書', 'xhs', 'bilibili', 'b站', '嗶哩嗶哩', '哔哩哔哩', '抖音', 'douyin', '今日頭條', '今日头条', 'toutiao', 'tiktok', '知乎', 'zhihu', '豆瓣', 'douban'],
  },
  {
    name: '生產力',
    keywords: [
      'productivity', 'habit', 'focus', '生產力', '工作流',
      '效率', 'notion', 'syncthing', '檔案同步', '磁盤清理', '系統優化',
    ],
  },
  {
    name: '新聞時事',
    keywords: ['news', 'breaking', 'report', 'election', 'government', 'policy', 'war', '新聞', '時事', '政策', '政府', '選舉', '戰爭', '國際'],
  },
  {
    name: '生活',
    keywords: [
      'food', 'travel', 'health', 'fitness', 'workout', 'recipe',
      'book', 'movie', '飲食', '旅遊', '健康', '運動', '閱讀', '電影', '生活', 'lifestyle',
    ],
  },
];

export function classifyContent(title: string, text: string): string {
  // Step 0：優先使用 vault 學習到的規則（信心 >= 0.75）
  const learned = classifyWithLearnedRules(title, text);
  if (learned) return learned;

  const titleHaystack = title.toLowerCase();
  const bodyHaystack = text.toLowerCase();

  // Pass 1：標題優先（精準信號）
  for (const cat of CATEGORIES) {
    if (cat.keywords.some((kw) => keywordMatch(titleHaystack, kw))) {
      // 通用 AI 命中 → 嘗試精煉到子分類
      if (cat.name === 'AI') {
        const refined = refineAISubcategory(titleHaystack, bodyHaystack);
        if (refined) return refined;
      }
      return cat.name;
    }
  }

  // Pass 2：本文 fallback（標題無命中時）
  for (const cat of CATEGORIES) {
    if (cat.keywords.some((kw) => keywordMatch(bodyHaystack, kw))) {
      if (cat.name === 'AI') {
        const refined = refineAISubcategory(titleHaystack, bodyHaystack);
        if (refined) return refined;
      }
      return cat.name;
    }
  }

  return '其他';
}

/** 從內容中提取命中的所有關鍵詞（最多 5 個），供 frontmatter keywords 欄位使用 */
export function extractKeywords(title: string, text: string): string[] {
  const haystack = `${title} ${text}`.toLowerCase();
  const matched: string[] = [];
  for (const cat of CATEGORIES) {
    for (const kw of cat.keywords) {
      if (keywordMatch(haystack, kw)) {
        matched.push(kw);
        if (matched.length >= 5) return matched;
      }
    }
  }
  return matched;
}
