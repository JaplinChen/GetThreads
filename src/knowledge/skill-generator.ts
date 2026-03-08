/**
 * Skill auto-generation — detect high-density knowledge topics
 * and generate Claude Code command files from vault knowledge.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { VaultKnowledge, KnowledgeEntity } from './types.js';
import { getInsightsByTopic } from './knowledge-aggregator.js';

/** A cluster of related knowledge around a single topic */
export interface TopicCluster {
  name: string;
  entityType: string;
  entityCount: number;
  noteCount: number;
  insightCount: number;
  topInsights: string[];
  suggestedCommand: string;
}

/** Result of generating a skill file */
export interface GeneratedSkill {
  command: string;
  filePath: string;
  topicName: string;
}

/**
 * Detect high-density topics suitable for skill generation.
 * Criteria: entity mentions ≥ 3 AND related insights ≥ 5.
 */
export function detectHighDensityTopics(knowledge: VaultKnowledge): TopicCluster[] {
  if (!knowledge.globalEntities) return [];

  const clusters: TopicCluster[] = [];

  for (const entity of Object.values(knowledge.globalEntities)) {
    if (entity.mentions < 3) continue;

    const insights = getInsightsByTopic(knowledge, entity.name);
    if (insights.length < 5) continue;

    // Count related entities (co-occurring in same notes)
    const relatedEntities = new Set<string>();
    for (const noteId of entity.noteIds) {
      const note = knowledge.notes[noteId];
      if (!note) continue;
      for (const e of note.entities) {
        if (e.name.toLowerCase() !== entity.name.toLowerCase()) {
          relatedEntities.add(e.name);
        }
      }
    }

    clusters.push({
      name: entity.name,
      entityType: entity.type,
      entityCount: relatedEntities.size,
      noteCount: entity.mentions,
      insightCount: insights.length,
      topInsights: insights.slice(0, 5).map(i => i.content),
      suggestedCommand: toCommandName(entity.name),
    });
  }

  return clusters.sort((a, b) => b.insightCount - a.insightCount);
}

/** Generate Claude Code command markdown content for a topic */
export function generateSkillContent(topic: TopicCluster, knowledge: VaultKnowledge): string {
  const insights = getInsightsByTopic(knowledge, topic.name);
  const entity = knowledge.globalEntities?.[topic.name.toLowerCase().trim()];

  const L: string[] = [];
  L.push(`# /${topic.suggestedCommand} — ${topic.name} 知識查詢`);
  L.push('');
  L.push(`基於 Vault 中 ${topic.noteCount} 篇筆記的深度分析。`);
  L.push('');
  L.push('## 知識摘要');
  L.push('');

  if (entity) {
    L.push(`**${entity.name}** [${entity.type}]`);
    if (entity.aliases.length > 0) {
      L.push(`別名：${entity.aliases.join(', ')}`);
    }
    L.push(`提及：${entity.mentions} 篇筆記`);
    L.push('');
  }

  if (insights.length > 0) {
    L.push('## 核心洞察');
    L.push('');
    for (const ins of insights.slice(0, 8)) {
      L.push(`- ${ins.content}`);
      L.push(`  ← *${ins.sourceTitle.slice(0, 50)}*（信心 ${ins.confidence}）`);
    }
    L.push('');
  }

  // Collect relations
  const relations: Array<{ from: string; to: string; type: string; description: string }> = [];
  const nameLower = topic.name.toLowerCase();
  for (const note of Object.values(knowledge.notes)) {
    for (const r of note.relations) {
      if (r.from.toLowerCase().includes(nameLower) || r.to.toLowerCase().includes(nameLower)) {
        relations.push(r);
      }
    }
  }
  if (relations.length > 0) {
    L.push('## 相關關係');
    L.push('');
    for (const r of relations.slice(0, 6)) {
      L.push(`- ${r.from} → ${r.to}：${r.description}`);
    }
    L.push('');
  }

  L.push('---');
  L.push(`*自動產生 by GetThreads /vault-analyze — ${new Date().toISOString().slice(0, 10)}*`);

  return L.join('\n');
}

/** Generate skill files for all high-density topics */
export async function generateSuggestedSkills(
  projectPath: string,
  knowledge: VaultKnowledge,
): Promise<GeneratedSkill[]> {
  const topics = detectHighDensityTopics(knowledge);
  if (topics.length === 0) return [];

  const skillDir = join(projectPath, '.claude', 'commands');
  await mkdir(skillDir, { recursive: true });

  const results: GeneratedSkill[] = [];
  for (const topic of topics.slice(0, 10)) {
    const content = generateSkillContent(topic, knowledge);
    const filePath = join(skillDir, `${topic.suggestedCommand}.md`);
    await writeFile(filePath, content, 'utf-8');
    results.push({
      command: topic.suggestedCommand,
      filePath,
      topicName: topic.name,
    });
  }

  return results;
}

/** Format high-density topics for Telegram message */
export function formatTopicsSummary(topics: TopicCluster[]): string {
  const lines = ['🎯 高密度知識主題', ''];
  if (topics.length === 0) {
    lines.push('未偵測到符合條件的主題（需 ≥3 篇提及且 ≥5 條洞察）。');
    return lines.join('\n');
  }

  lines.push(`發現 ${topics.length} 個可生成 Skill 的主題：`, '');
  for (const t of topics.slice(0, 10)) {
    lines.push(`• ${t.name} [${t.entityType}]`);
    lines.push(`  ${t.noteCount} 篇 | ${t.insightCount} 洞察 | 指令：/${t.suggestedCommand}`);
  }

  lines.push('', '在 Claude Code 執行 /vault-analyze 可自動產生命令檔案。');
  return lines.join('\n');
}

/** Convert entity name to a valid command name */
function toCommandName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30);
}
