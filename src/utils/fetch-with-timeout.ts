/**
 * fetch with AbortController-based timeout.
 * Throws on timeout or network error.
 */
export async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  options: RequestInit = {},
): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: ac.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}
