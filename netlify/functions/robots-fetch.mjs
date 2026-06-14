// lilRobots fetcher.
// Grabs a site's robots.txt, llms.txt, and llms-full.txt server-side
// (browsers can't read cross-origin text files) and returns the raw contents.
// All parsing and grading happens client-side.

const TIMEOUT_MS = 9000;
const MAX_TEXT = 150000;

function isBlockedHost(hostname) {
  const h = (hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = +m[1], b = +m[2];
    if (a === 0 || a === 127 || a === 10) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }
  return false;
}

const json = (statusCode, obj) => ({
  statusCode,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  body: JSON.stringify(obj),
});

const UA = 'Mozilla/5.0 (compatible; lilRobots/1.0; +https://lilrobots.netlify.app)';

async function fetchText(url, signal) {
  let current = url;
  for (let i = 0; i < 5; i++) {
    const host = (() => { try { return new URL(current).hostname; } catch { return ''; } })();
    if (isBlockedHost(host)) return { status: 0, text: '', error: 'blocked' };
    let r;
    try {
      r = await fetch(current, { method: 'GET', redirect: 'manual', signal, headers: { 'user-agent': UA, accept: 'text/plain,*/*;q=0.8' } });
    } catch (e) {
      return { status: 0, text: '', error: e.name === 'AbortError' ? 'timeout' : 'unreachable' };
    }
    const loc = r.headers.get('location');
    if (r.status >= 300 && r.status < 400 && loc) {
      try { current = new URL(loc, current).toString(); } catch { current = loc; }
      continue;
    }
    if (r.status >= 400) return { status: r.status, text: '' };
    let text = '';
    try { text = (await r.text()).slice(0, MAX_TEXT); } catch { text = ''; }
    // An HTML page at robots.txt is a soft miss, not a robots file.
    const looksHtml = /^\s*<!doctype html|^\s*<html/i.test(text);
    return { status: r.status, text: looksHtml ? '' : text, soft: looksHtml || undefined };
  }
  return { status: 0, text: '', error: 'too many redirects' };
}

export const handler = async (event) => {
  const raw = (event.queryStringParameters && event.queryStringParameters.url || '').trim();
  if (!raw) return json(400, { error: 'Enter a domain to scan.' });
  const start = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;

  let origin;
  try { origin = new URL(start).origin; } catch { return json(400, { error: 'That does not look like a valid domain.' }); }
  if (!/^https?:/.test(origin)) return json(400, { error: 'Only http and https can be scanned.' });
  if (isBlockedHost(new URL(origin).hostname)) return json(400, { error: 'For safety, local and private addresses cannot be scanned.' });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const [robots, llms, llmsFull] = await Promise.all([
      fetchText(origin + '/robots.txt', controller.signal),
      fetchText(origin + '/llms.txt', controller.signal),
      fetchText(origin + '/llms-full.txt', controller.signal),
    ]);
    if (robots.error === 'unreachable' && llms.error === 'unreachable') {
      return json(502, { error: 'Could not reach that site. Check the domain and try again.' });
    }
    return json(200, { origin, robots, llms, llmsFull: { status: llmsFull.status, present: llmsFull.status === 200 && !!llmsFull.text } });
  } finally {
    clearTimeout(timer);
  }
};
