/**
 * CLI: Generate related note suggestions and write to vault.
 *
 * Usage:
 *   npx ts-node scripts/suggest-links.ts [--dry-run] [--index-only] [--note-path <path>]
 */
import 'dotenv/config';
import { suggestAllLinks, loadNoteIndex, suggestLinks } from '../src/vault/link-suggester.js';
import { writeSuggestionsToNote, writeIndexNote } from '../src/vault/link-writer.js';

const vaultPath = process.env.VAULT_PATH;
if (!vaultPath) {
  console.error('❌ VAULT_PATH 未設定');
  process.exit(1);
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const indexOnly = args.includes('--index-only');
const notePathIdx = args.indexOf('--note-path');
const notePath = notePathIdx >= 0 ? args[notePathIdx + 1] : undefined;

async function main(): Promise<void> {
  console.log(`📂 Vault: ${vaultPath}`);
  console.log(`⚙️  模式: ${dryRun ? 'dry-run' : indexOnly ? 'index-only' : '完整寫入'}`);

  if (notePath) {
    // Single note mode
    const noteIndex = await loadNoteIndex(vaultPath);
    const note = noteIndex.find(n => n.filePath.includes(notePath));
    if (!note) {
      console.error(`❌ 找不到筆記: ${notePath}`);
      process.exit(1);
    }
    const suggestions = await suggestLinks(note.url, noteIndex);
    console.log(`\n📝 ${note.title}`);
    for (const s of suggestions) {
      console.log(`  → [${s.method}] ${s.title} (${s.score.toFixed(1)}, ${s.sharedKeywords.join(', ')})`);
    }
    if (!dryRun && suggestions.length > 0) {
      await writeSuggestionsToNote(note.filePath, suggestions);
      console.log('✅ 已寫入筆記');
    }
    return;
  }

  // Full scan mode
  const allSuggestions = await suggestAllLinks(vaultPath);
  console.log(`\n📊 共 ${allSuggestions.size} 篇筆記有推薦`);

  if (dryRun) {
    let shown = 0;
    for (const [filePath, suggestions] of allSuggestions) {
      if (shown >= 10) { console.log(`... 還有 ${allSuggestions.size - shown} 篇`); break; }
      const title = filePath.split(/[/\\]/).pop()?.replace('.md', '') ?? '';
      console.log(`\n📝 ${title}`);
      for (const s of suggestions.slice(0, 3)) {
        console.log(`  → [${s.method}] ${s.title} (${s.score.toFixed(1)})`);
      }
      shown++;
    }
    return;
  }

  // Write to notes (unless index-only)
  if (!indexOnly) {
    let written = 0;
    for (const [filePath, suggestions] of allSuggestions) {
      if (await writeSuggestionsToNote(filePath, suggestions)) written++;
    }
    console.log(`✅ 已寫入 ${written} 篇筆記`);
  }

  // Generate index
  const indexPath = await writeIndexNote(vaultPath, allSuggestions);
  console.log(`📋 索引已生成: ${indexPath}`);
}

main().catch((err) => {
  console.error('❌ 執行失敗:', err);
  process.exit(1);
});
