/** Keyword-based content classifier — returns a Traditional Chinese category label */
import { classifyWithLearnedRules } from './learning/dynamic-classifier.js';

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
    // 教學/入門內容：強調步驟、教程、新手
    // 注意：移除裸字「入門/入门」以防過廣命中（如「Prompt Engineering 入門」誤分為學習）
    // 保留複合詞「入門指南」「入門教學」「零基礎入門」避免誤傷真正的教學文
    name: 'AI/學習',
    keywords: [
      '完全教程', '教程', '教學', '小白', '新手',
      '入門指南', '入门指南', '入門完全', '入门完全', '入門教學', '入门教学',
      '从0开始', '从零开始', '零基礎', '零基础', '零基礎入門', '零基础入门',
      'tutorial', 'getting started', '安装后必看', '手把手', '3分钟', '0代码',
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
    // Agent 工程、架構、最佳實踐、RAG
    name: 'AI/應用',
    keywords: [
      'agentic engineer', 'agent工程', 'agent engineer', 'multi-agent',
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
      'tech', 'software', 'hardware', 'apple', 'google', 'microsoft',
      'meta', 'nvidia', 'chip', 'semiconductor', '晶片', '半導體',
      '軟體', '硬體', '科技', 'developer', 'github', 'open source',
    ],
  },
  {
    name: '程式設計',
    keywords: [
      'code', 'coding', 'programming', 'javascript', 'typescript',
      'python', 'rust', 'react', 'nextjs', 'node', 'api', 'framework',
      'library', '程式', '開發', 'backend', 'frontend', 'database',
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
      'design', 'ux', 'ui', 'figma', 'typography', 'brand', 'logo',
      'visual', '設計', '排版', '品牌', '視覺', 'prototype', 'wireframe',
    ],
  },
  {
    name: '行銷',
    keywords: [
      'marketing', 'seo', 'ads', 'growth', 'content', 'social media',
      'campaign', '行銷', '廣告', '成長', '內容', '流量', 'viral', '病毒',
    ],
  },
  {
    // 平台專用關鍵詞優先級高於「筆記/工具」等通用詞
    name: '中文媒體',
    keywords: [
      '微博', 'weibo',
      '小紅書', '小红书', 'xiaohongshu', '紅書', 'xhs',
      'bilibili', 'b站', '嗶哩嗶哩', '哔哩哔哩',
      '抖音', 'douyin', '今日頭條', '今日头条', 'toutiao',
      '知乎', 'zhihu', '豆瓣', 'douban',
    ],
  },
  {
    name: '生產力',
    keywords: [
      'productivity', 'workflow', 'obsidian', 'notion', 'pkm',
      'zettelkasten', 'habit', 'focus', '生產力', '工作流', '筆記',
      '效率', 'automation', '自動化', 'tool', '工具',
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
      return cat.name;
    }
  }

  // Pass 2：本文 fallback（標題無命中時）
  for (const cat of CATEGORIES) {
    if (cat.keywords.some((kw) => bodyHaystack.includes(kw.toLowerCase()))) {
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
