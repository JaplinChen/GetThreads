/** Keyword-based content classifier — returns a Traditional Chinese category label */
import { classifyWithLearnedRules } from './learning/dynamic-classifier.js';

// ── AI 子分類精煉：當通用 AI 命中時，用寬鬆關鍵詞嘗試歸入更精確的子分類 ──
const AI_SUBCATEGORY_REFINEMENT: Array<{ name: string; keywords: string[] }> = [
  {
    name: 'AI/Claude Code',
    keywords: ['claude code', 'cowork', 'claude cowork'],
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

/** 當初次分類命中通用 AI 時，用 title+body 合併文本精煉到子分類 */
function refineAISubcategory(title: string, body: string): string | null {
  const titleLower = title.toLowerCase();
  const bodyLower = body.toLowerCase();

  for (const sub of AI_SUBCATEGORY_REFINEMENT) {
    // 標題命中 → 直接歸類（高信心）
    if (sub.keywords.some((kw) => titleLower.includes(kw.toLowerCase()))) {
      return sub.name;
    }
  }

  // Body 命中需要至少 2 個不同關鍵詞才歸類（避免偶然提及）
  for (const sub of AI_SUBCATEGORY_REFINEMENT) {
    const matchCount = sub.keywords.filter(
      (kw) => bodyLower.includes(kw.toLowerCase()),
    ).length;
    if (matchCount >= 2) {
      return sub.name;
    }
  }
  return null;
}

const CATEGORIES: Array<{ name: string; keywords: string[] }> = [
  // ── AI 子分類（必須排在通用 AI 之前，越精確的越前面）──────────────────────
  {
    // Claude Code / Cowork 相關教程與工具整合
    name: 'AI/Claude Code',
    keywords: [
      'claude code', 'cowork', 'claude cowork',
    ],
  },
  {
    // OpenClaw 生態：安裝、設定、使用指南
    name: 'AI/OpenClaw',
    keywords: [
      'openclaw', 'open claw', 'openclaws', 'clawbot',
      '龍蝦', '龙虾',
    ],
  },
  {
    // 其他具體 AI 工具的使用、設定、安裝
    name: 'AI/工具',
    keywords: [
      'clawdbot',
      'cursor', 'windsurf', 'cline', 'mcp server', 'mcp tool', 'mcp ',
      'perplexity', 'midjourney', 'stable diffusion', 'comfyui',
      'n8n', 'make.com', 'telegram bot', 'obsidian plugin',
      'skill清单', 'skill 清單',
    ],
  },
  {
    // Obsidian 知識管理（排在通用生產力之前，攔截 Obsidian 專屬內容）
    name: '生產力/Obsidian',
    keywords: [
      'obsidian', 'pkm', 'zettelkasten',
      '第二大腦', '第二大脑', '筆記軟體', '笔记软件', '筆記工具', '笔记工具',
      '雙向連結', '雙向鏈結', '知識圖譜', '知識網路', '知識網絡',
    ],
  },
  {
    // 教學/入門內容：強調步驟、教程、新手
    // 注意：移除裸字「入門/入门」以防過廣命中（如「Prompt Engineering 入門」誤分為學習）
    // 保留複合詞「入門指南」「入門教學」「零基礎入門」避免誤傷真正的教學文
    name: 'AI/學習',
    keywords: [
      '完全教程', '教程', '小白', '新手',
      '入門指南', '入门指南', '入門完全', '入门完全', '入門教學', '入门教学',
      '从0开始', '从零开始', '零基礎', '零基础', '零基礎入門', '零基础入门',
      'getting started', '安装后必看', '手把手', '3分钟', '0代码',
    ],
  },
  {
    // Prompt / 調教 / 角色扮演
    name: 'AI/提示詞',
    keywords: [
      'prompt engineering', 'system prompt', '提示词', '提示詞',
      '调教', '調教', '角色扮演', 'role play', 'jailbreak',
      'few-shot', 'zero-shot', 'chain of thought', 'cot',
    ],
  },
  {
    // 模型本身：評測、比較、新模型發布
    name: 'AI/模型',
    keywords: [
      'minimax', 'deepseek', 'qwen', 'llama', 'mistral', 'gemma',
      'phi-', 'gpt-4o', 'gpt-5', 'o1', 'o3', 'claude 3', 'claude 4',
      'benchmark', 'leaderboard', '模型评测', '模型評測', '免费 claude', '免費 claude',
    ],
  },
  {
    // AI Agent 工程、框架、多代理系統
    name: 'AI/Agent',
    keywords: [
      'ai agent', 'agentic engineer', 'agent工程', 'agent engineer',
      'multi-agent', 'agent orchestration', 'agent 軍團', 'agent 架構',
      'agent framework', 'agent monitoring',
    ],
  },
  {
    // 應用場景、最佳實踐、RAG
    name: 'AI/應用',
    keywords: [
      'best practices', '最佳实践', '最佳實踐', '工程指南',
      'rag', 'retrieval', 'vector database', 'embedding',
      'langchain', 'langgraph', '数据抓取', '資料抓取',
    ],
  },
  {
    // 通用 AI（兜底，排在子分類後面）
    name: 'AI',
    keywords: [
      'ai', 'gpt', 'llm', 'claude', 'gemini', 'openai', 'anthropic',
      'copilot', 'diffusion', 'chatbot', '人工智慧', '大語言模型',
      '大语言模型', '機器學習', 'machine learning', 'deep learning',
    ],
  },

  // ── 其他頂層分類 ───────────────────────────────────────────────────────────
  {
    name: '科技',
    keywords: [
      'hardware', 'chip', 'semiconductor', '晶片', '半導體',
      '硬體', '科技新聞', 'apple silicon', '休眠機制',
    ],
  },
  {
    name: '程式設計',
    keywords: [
      'programming', 'javascript', 'typescript',
      'python', 'rust', 'react', 'nextjs',
      '程式設計', 'backend', 'frontend', 'database', '訂閱管理',
    ],
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
    keywords: [
      'ux design', 'ui design', 'figma', 'typography', 'brand design', 'logo',
      'visual design', '排版', '品牌設計', '視覺設計', 'prototype', 'wireframe',
    ],
  },
  {
    name: '行銷',
    keywords: [
      'marketing', 'seo', 'google ads', 'facebook ads', 'growth hack', 'content marketing',
      'social media marketing', 'campaign', '行銷', '廣告', '流量', 'viral',
    ],
  },
  {
    // 平台專用關鍵詞優先級高於「筆記/工具」等通用詞
    name: '中文媒體',
    keywords: [
      '微博', 'weibo',
      '小紅書', '小红书', 'xiaohongshu', '紅書', 'xhs',
      'bilibili', 'b站', '嗶哩嗶哩', '哔哩哔哩',
      '抖音', 'douyin', '今日頭條', '今日头条', 'toutiao', 'tiktok',
      '知乎', 'zhihu', '豆瓣', 'douban',
    ],
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
    keywords: [
      'news', 'breaking', 'report', 'election', 'government', 'policy',
      'war', '新聞', '時事', '政策', '政府', '選舉', '戰爭', '國際',
    ],
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
    if (cat.keywords.some((kw) => titleHaystack.includes(kw.toLowerCase()))) {
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
    if (cat.keywords.some((kw) => bodyHaystack.includes(kw.toLowerCase()))) {
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
      if (haystack.includes(kw.toLowerCase())) {
        matched.push(kw);
        if (matched.length >= 5) return matched;
      }
    }
  }
  return matched;
}
