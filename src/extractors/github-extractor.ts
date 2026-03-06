/**
 * GitHub extractor — uses GitHub REST API (no auth required for public repos).
 * Based on Agent-Reach's GitHubChannel: https://github.com/Panniantong/Agent-Reach
 * Supports: repos, issues, PRs, and README fallback.
 */
import type { ExtractedContent, Extractor } from './types.js';
import { fetchWithTimeout } from '../utils/fetch-with-timeout.js';

const GITHUB_PATTERN = /github\.com\/([\w.-]+)\/([\w.-]+)(?:\/(?:issues|pull)\/(\d+))?/i;

interface GhRepo {
  name: string;
  full_name: string;
  description: string | null;
  owner: { login: string };
  stargazers_count: number;
  forks_count: number;
  language: string | null;
  topics: string[];
  html_url: string;
  created_at: string;
  pushed_at: string;
  default_branch: string;
}

interface GhReadme {
  content: string; // base64-encoded
  encoding: string;
}

interface GhIssue {
  title: string;
  body: string | null;
  user: { login: string };
  state: string;
  created_at: string;
  html_url: string;
  comments: number;
  labels: Array<{ name: string }>;
}

type GhApiResponse = GhRepo | GhIssue;

async function ghFetch<T>(endpoint: string): Promise<T> {
  const res = await fetchWithTimeout(`https://api.github.com${endpoint}`, 30_000, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'GetThreads-Bot/1.0',
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

/** Fetch and base64-decode README; returns null if unavailable */
async function fetchReadme(owner: string, repo: string): Promise<string | null> {
  try {
    const data = await ghFetch<GhReadme>(`/repos/${owner}/${repo}/readme`);
    if (data.encoding !== 'base64') return null;
    // GitHub API includes newlines in the base64 string — strip before decoding
    const decoded = Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf-8');
    // Truncate to 5000 chars to keep notes manageable
    return decoded.length > 5000 ? decoded.slice(0, 5000) + '\n\n...(truncated)' : decoded;
  } catch {
    return null;
  }
}

function buildRepoText(repo: GhRepo): string {
  const lines: string[] = [];

  if (repo.description) lines.push(repo.description, '');

  const stats: string[] = [
    `⭐ Stars: ${repo.stargazers_count.toLocaleString()}`,
    `🍴 Forks: ${repo.forks_count.toLocaleString()}`,
  ];
  if (repo.language) stats.push(`Language: ${repo.language}`);
  lines.push(stats.join(' | '), '');

  if (repo.topics.length > 0) {
    lines.push(`**Topics:** ${repo.topics.join(', ')}`, '');
  }

  lines.push(`**Last push:** ${repo.pushed_at.split('T')[0]}`);

  return lines.join('\n');
}

function buildIssueText(issue: GhIssue): string {
  const lines: string[] = [];

  lines.push(`**State:** ${issue.state}`);
  lines.push(`**Comments:** ${issue.comments}`);

  if (issue.labels.length > 0) {
    lines.push(`**Labels:** ${issue.labels.map((l) => l.name).join(', ')}`);
  }

  lines.push('');

  if (issue.body) {
    lines.push(issue.body.length > 3000 ? issue.body.slice(0, 3000) + '\n...' : issue.body);
  }

  return lines.join('\n');
}

export const githubExtractor: Extractor = {
  platform: 'github',

  match(url: string): boolean {
    return GITHUB_PATTERN.test(url);
  },

  parseId(url: string): string | null {
    const m = url.match(GITHUB_PATTERN);
    if (!m) return null;
    return m[3] ? `${m[1]}-${m[2]}-${m[3]}` : `${m[1]}-${m[2]}`;
  },

  async extract(url: string): Promise<ExtractedContent> {
    const m = url.match(GITHUB_PATTERN);
    if (!m) throw new Error(`Invalid GitHub URL: ${url}`);

    const [, owner, repo, number] = m;
    const isIssue = url.includes('/issues/');
    const isPR = url.includes('/pull/');

    let text: string;
    let title: string;
    let author: string;
    let date: string;

    if ((isIssue || isPR) && number) {
      const endpoint = isIssue
        ? `/repos/${owner}/${repo}/issues/${number}`
        : `/repos/${owner}/${repo}/pulls/${number}`;

      const issue = await ghFetch<GhIssue>(endpoint);
      const kind = isPR ? 'PR' : 'Issue';
      title = `[${kind} #${number}] ${issue.title}`;
      author = issue.user.login;
      date = issue.created_at.split('T')[0];
      text = buildIssueText(issue);
    } else {
      const repoData = await ghFetch<GhRepo>(`/repos/${owner}/${repo}`);
      title = `${repoData.full_name}`;
      if (repoData.description) title += ` — ${repoData.description}`.slice(0, 100);
      author = repoData.owner.login;
      date = repoData.pushed_at.split('T')[0]; // last push is more useful than created_at
      text = buildRepoText(repoData);

      const readme = await fetchReadme(owner, repo);

      return {
        platform: 'github',
        author,
        authorHandle: `@${author}`,
        title,
        text,
        body: readme ?? undefined,
        images: [],
        videos: [],
        date,
        url,
        stars: repoData.stargazers_count,
        extraTags: repoData.topics.length > 0 ? repoData.topics : undefined,
      };
    }

    return {
      platform: 'github',
      author,
      authorHandle: `@${author}`,
      title,
      text,
      images: [],
      videos: [],
      date,
      url,
    };
  },
};
