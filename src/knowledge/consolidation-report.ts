/**
 * Consolidation report formatting — Telegram summary and Vault note generation.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ConsolidationReport } from './consolidator.js';

/** Format consolidation report for Telegram message */
export function formatConsolidationReport(report: ConsolidationReport): string {
  const L: string[] = [
    '🧠 知識整合報告',
    `期間 ${report.periodStart} ~ ${report.periodEnd}`,
    `分析 ${report.newNoteCount} 篇新筆記，發現 ${report.clusterCount} 個知識叢集`,
    '',
  ];

  if (report.clusters.length === 0) {
    L.push('近期筆記之間關聯性不足，暫無可整合的叢集。');
    return L.join('\n');
  }

  for (const c of report.clusters.slice(0, 5)) {
    L.push(`━━━ ${c.sharedEntities.slice(0, 3).join(' + ')}（${c.notes.length} 篇）━━━`);
    L.push(`分類：${c.categorySpan.join('、')} | 品質 ${c.avgQuality}/5`);
    for (const n of c.notes.slice(0, 5)) {
      L.push(`  • ${n.title.slice(0, 50)}`);
    }
    if (c.notes.length > 5) L.push(`  ... 還有 ${c.notes.length - 5} 篇`);
    if (c.llmInsight) {
      L.push(`💡 ${c.llmInsight}`);
    }
    L.push('');
  }

  if (report.topNewEntities.length > 0) {
    L.push(`🆕 本期新實體：${report.topNewEntities.slice(0, 10).join('、')}`);
  }

  return L.join('\n');
}

/** Save consolidation report as an Obsidian Vault note */
export async function saveConsolidationNote(
  vaultPath: string,
  report: ConsolidationReport,
): Promise<string> {
  const date = report.periodEnd;
  const outDir = join(vaultPath, 'GetThreads', '知識整合');
  const outPath = join(outDir, `consolidation-${date}.md`);

  const noteLink = (title: string) =>
    `[[${title.replace(/[[\]]/g, '').slice(0, 60)}]]`;

  const L: string[] = [];
  L.push('---');
  L.push(`title: "知識整合報告 ${date}"`);
  L.push(`date: ${date}`);
  L.push('tags: [knowledge, consolidation, auto-generated]');
  L.push('---');
  L.push('');
  L.push('# 知識整合報告');
  L.push(`> 期間 ${report.periodStart} ~ ${report.periodEnd}，分析 ${report.newNoteCount} 篇新筆記，發現 ${report.clusterCount} 個知識叢集。`);
  L.push('');

  for (const c of report.clusters) {
    L.push(`## ${c.sharedEntities.slice(0, 3).join(' + ')}`);
    L.push(`*${c.notes.length} 篇筆記，涵蓋 ${c.categorySpan.join('、')}，品質 ${c.avgQuality}/5*`);
    L.push('');
    L.push('**相關筆記**：');
    for (const n of c.notes) {
      L.push(`- ${noteLink(n.title)}`);
    }
    if (c.llmInsight) {
      L.push('');
      L.push(`**洞察**：${c.llmInsight}`);
    }
    L.push('');
  }

  if (report.topNewEntities.length > 0) {
    L.push('## 本期新實體');
    L.push(report.topNewEntities.map(e => `\`${e}\``).join('、'));
    L.push('');
  }

  L.push('---');
  L.push(`*自動產生 by GetThreads /consolidate — ${report.generatedAt.slice(0, 19)}*`);

  await mkdir(outDir, { recursive: true });
  await writeFile(outPath, L.join('\n'), 'utf-8');
  return outPath;
}
