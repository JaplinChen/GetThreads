/**
 * /analyze, /knowledge, /gaps, /skills — knowledge system commands.
 * /analyze: guides user to Claude Code /vault-analyze skill.
 * /knowledge: reads pre-computed knowledge from vault-knowledge.json.
 * /gaps: shows knowledge gaps detected in the vault.
 * /skills: shows high-density topics that can become Claude Code commands.
 */
import type { Context } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import { loadKnowledge } from '../knowledge/knowledge-store.js';
import { aggregateKnowledge, formatKnowledgeSummary } from '../knowledge/knowledge-aggregator.js';
import { detectKnowledgeGaps, formatGapsSummary } from '../knowledge/knowledge-graph.js';
import { detectHighDensityTopics, formatTopicsSummary } from '../knowledge/skill-generator.js';

/** /analyze — guide user to Claude Code skill */
export async function handleAnalyze(ctx: Context, _config: AppConfig): Promise<void> {
  const knowledge = await loadKnowledge();
  const noteCount = Object.keys(knowledge.notes).length;

  const lines = [
    '🔍 知識分析請在 Claude Code 中執行：',
    '',
    '```',
    '/vault-analyze              # 增量分析',
    '/vault-analyze --full       # 全量重新分析',
    '```',
    '',
    '分析完成後會自動：',
    '• 更新 vault-knowledge.json',
    '• 產生 Obsidian 知識庫摘要筆記',
    '',
    '使用 /knowledge 查看目前知識庫。',
  ];

  if (noteCount > 0) {
    lines.push('', `📊 目前知識庫：${knowledge.stats.analyzedNotes} 篇已分析，${knowledge.stats.totalEntities} 個實體`);
  }

  await ctx.reply(lines.join('\n'));
}

/** /knowledge — show knowledge summary */
export async function handleKnowledge(ctx: Context, _config: AppConfig): Promise<void> {
  const knowledge = await loadKnowledge();
  if (Object.keys(knowledge.notes).length === 0) {
    await ctx.reply(
      '知識庫為空。\n\n' +
      '請在 Claude Code 中執行 /vault-analyze 進行深度分析。',
    );
    return;
  }
  aggregateKnowledge(knowledge);
  await ctx.reply(formatKnowledgeSummary(knowledge));
}

/** /gaps — show knowledge gaps */
export async function handleGaps(ctx: Context, _config: AppConfig): Promise<void> {
  const knowledge = await loadKnowledge();
  if (Object.keys(knowledge.notes).length === 0) {
    await ctx.reply('知識庫為空，請先執行 /vault-analyze');
    return;
  }
  aggregateKnowledge(knowledge);
  const gaps = detectKnowledgeGaps(knowledge);
  await ctx.reply(formatGapsSummary(gaps));
}

/** /skills — show high-density topics suitable for skill generation */
export async function handleSkills(ctx: Context, _config: AppConfig): Promise<void> {
  const knowledge = await loadKnowledge();
  if (Object.keys(knowledge.notes).length === 0) {
    await ctx.reply('知識庫為空，請先執行 /vault-analyze');
    return;
  }
  aggregateKnowledge(knowledge);
  const topics = detectHighDensityTopics(knowledge);
  await ctx.reply(formatTopicsSummary(topics));
}
