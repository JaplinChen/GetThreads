/**
 * /consolidate — discover cross-note connections and generate knowledge insights.
 * Hybrid: statistical entity graph for connections + LLM for semantic synthesis.
 */
import type { Context } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import { scanVaultNotes, loadKnowledge, saveKnowledge } from '../knowledge/knowledge-store.js';
import { consolidateVault } from '../knowledge/consolidator.js';
import { formatConsolidationReport, saveConsolidationNote } from '../knowledge/consolidation-report.js';

const TELEGRAM_MSG_LIMIT = 4096;

function splitMessage(text: string): string[] {
  if (text.length <= TELEGRAM_MSG_LIMIT) return [text];
  const chunks: string[] = [];
  const lines = text.split('\n');
  let current = '';
  for (const line of lines) {
    if (current.length + line.length + 1 > TELEGRAM_MSG_LIMIT) {
      chunks.push(current);
      current = line;
    } else {
      current += (current ? '\n' : '') + line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/** /consolidate handler */
export async function handleConsolidate(ctx: Context, config: AppConfig): Promise<void> {
  const knowledge = await loadKnowledge();
  if (Object.keys(knowledge.notes).length === 0) {
    await ctx.reply('知識庫為空，請先執行 /analyze 進行深度分析。');
    return;
  }

  await ctx.reply('🧠 正在整合最近 7 天的知識…');

  const notes = await scanVaultNotes(config.vaultPath);
  const report = await consolidateVault(notes, knowledge);

  if (report.clusterCount === 0 && report.newNoteCount === 0) {
    await ctx.reply('近 7 天沒有新筆記。');
    return;
  }

  // Save Vault note
  const notePath = await saveConsolidationNote(config.vaultPath, report);

  // Persist lastConsolidatedAt
  await saveKnowledge(knowledge);

  // Send Telegram summary
  const text = formatConsolidationReport(report);
  for (const chunk of splitMessage(text)) {
    await ctx.reply(chunk);
  }

  await ctx.reply(`📝 整合筆記已存到 Vault：${notePath.split('GetThreads')[1] ?? notePath}`);
}
