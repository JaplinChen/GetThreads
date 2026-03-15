/**
 * Vault self-healer — scans notes for common issues and auto-fixes them.
 * Fixes: empty summaries, HTML remnants, missing frontmatter fields.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getAllMdFiles } from '../vault/frontmatter-utils.js';
import type { VaultIssue } from './health-types.js';
import { logger } from '../core/logger.js';

const HTML_TAG_RE = /<(?:div|span|br|p|a|img|table|tr|td|th|ul|ol|li|h[1-6])\b[^>]*\/?>/gi;
const HTML_CLOSE_RE = /<\/(?:div|span|p|a|table|tr|td|th|ul|ol|li|h[1-6])>/gi;

/** Strip HTML tags from text, preserving content */
function stripHtml(text: string): string {
  return text
    .replace(HTML_TAG_RE, '')
    .replace(HTML_CLOSE_RE, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Parse frontmatter and body from raw markdown */
function splitNote(raw: string): { frontmatter: string; body: string; fmEnd: number } | null {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  return {
    frontmatter: match[1],
    body: raw.slice(match[0].length),
    fmEnd: match[0].length,
  };
}

interface ScanResult {
  issues: VaultIssue[];
  totalNotes: number;
  autoFixed: number;
}

/** Scan and auto-fix vault issues */
export async function healVault(vaultPath: string, dryRun: boolean = false): Promise<ScanResult> {
  const rootDir = join(vaultPath, 'GetThreads');
  const files = await getAllMdFiles(rootDir);
  const issues: VaultIssue[] = [];
  let autoFixed = 0;

  for (const filePath of files) {
    try {
      const raw = await readFile(filePath, 'utf-8');
      const parsed = splitNote(raw);
      if (!parsed) continue;

      const relPath = filePath.replace(/.*GetThreads[\\/]/, '');
      let modified = false;
      let newContent = raw;

      // Fix 1: HTML remnants in body
      if (HTML_TAG_RE.test(parsed.body)) {
        HTML_TAG_RE.lastIndex = 0; // reset regex state
        const cleanBody = stripHtml(parsed.body);
        if (cleanBody !== parsed.body) {
          newContent = raw.slice(0, parsed.fmEnd) + cleanBody;
          modified = true;
          issues.push({ file: relPath, issue: 'HTML 殘留（已修復）', autoFixable: true, fixed: true });
        }
      }

      // Fix 2: Broken image links (![](path) where path has backslashes)
      const brokenImgRe = /!\[([^\]]*)\]\(([^)]*\\[^)]*)\)/g;
      if (brokenImgRe.test(newContent)) {
        brokenImgRe.lastIndex = 0;
        newContent = newContent.replace(brokenImgRe, (_m, alt, path) => {
          return `![${alt}](${path.replace(/\\/g, '/')})`;
        });
        modified = true;
        issues.push({ file: relPath, issue: '圖片路徑反斜線（已修復）', autoFixable: true, fixed: true });
      }

      // Fix 3: Excess blank lines (>3 consecutive)
      const excessBlankRe = /\n{4,}/g;
      if (excessBlankRe.test(newContent)) {
        newContent = newContent.replace(excessBlankRe, '\n\n\n');
        modified = true;
        issues.push({ file: relPath, issue: '過多空行（已修復）', autoFixable: true, fixed: true });
      }

      // Report-only: missing fields (not auto-fixable)
      if (!parsed.frontmatter.match(/^summary:\s*.+/m)) {
        issues.push({ file: relPath, issue: '空白摘要', autoFixable: false });
      }

      if (modified && !dryRun) {
        await writeFile(filePath, newContent, 'utf-8');
        autoFixed++;
      }
    } catch {
      // Skip unreadable files
    }
  }

  logger.info('vault-healer', '掃描完成', {
    total: files.length,
    issues: issues.length,
    fixed: autoFixed,
  });

  return { issues, totalNotes: files.length, autoFixed };
}
