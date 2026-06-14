// lilRobots: scan a site's robots.txt and llms.txt via the /robots-fetch
// Netlify function, grade them in plain English, show an allowed-or-blocked
// grid for the major AI crawlers, and generate clean files of your own.

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ---------- theme (OS-aware, matches the family) ---------- */
const MOON_SVG = '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>';
const SUN_SVG = '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4l1.4-1.4M18 6l1.4-1.4"/></g></svg>';

function setThemeIcon(btn, theme) {
  if (theme === 'dark') { btn.innerHTML = SUN_SVG; btn.setAttribute('aria-label', 'Switch to light mode'); }
  else { btn.innerHTML = MOON_SVG; btn.setAttribute('aria-label', 'Switch to dark mode'); }
}
function initTheme() {
  const btn = $('#ui-theme-btn');
  const current = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  setThemeIcon(btn, current());
  btn.addEventListener('click', () => {
    const next = current() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('lilrobots-theme', next); } catch (e) {}
    setThemeIcon(btn, next);
  });
}

/* ---------- robots.txt parsing ---------- */
function parseRobots(text) {
  const groups = {}; // lowercased UA -> { disallow: [], allow: [], crawlDelay }
  const sitemaps = [];
  let currentUAs = [];
  let lastWasUA = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^([a-zA-Z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === 'user-agent') {
      if (!lastWasUA) currentUAs = [];
      const ua = val.toLowerCase();
      currentUAs.push(ua);
      if (!groups[ua]) groups[ua] = { disallow: [], allow: [], crawlDelay: null };
      lastWasUA = true;
      continue;
    }
    lastWasUA = false;
    if (key === 'sitemap') { if (val) sitemaps.push(val); continue; }
    for (const ua of currentUAs) {
      if (!groups[ua]) groups[ua] = { disallow: [], allow: [], crawlDelay: null };
      if (key === 'disallow') groups[ua].disallow.push(val);
      else if (key === 'allow') groups[ua].allow.push(val);
      else if (key === 'crawl-delay') groups[ua].crawlDelay = val;
    }
  }
  return { groups, sitemaps };
}

// What does the file say about this bot's access to the site root?
function botVerdict(parsed, bot) {
  const ua = bot.toLowerCase();
  const g = parsed.groups[ua] || parsed.groups['*'];
  if (!g) return 'allowed';
  const explicit = !!parsed.groups[ua];
  const blockedAll = g.disallow.some((p) => p === '/') && !g.allow.some((p) => p === '/' || p === '');
  if (blockedAll) return explicit ? 'blocked' : 'blocked-by-default';
  if (g.disallow.some((p) => p && p !== '')) return 'partial';
  return 'allowed';
}

const AI_BOTS = [
  ['GPTBot', 'OpenAI training'],
  ['OAI-SearchBot', 'ChatGPT search'],
  ['ChatGPT-User', 'ChatGPT browsing'],
  ['ClaudeBot', 'Anthropic'],
  ['Claude-User', 'Claude browsing'],
  ['PerplexityBot', 'Perplexity'],
  ['Google-Extended', 'Gemini training'],
  ['Applebot-Extended', 'Apple AI'],
  ['CCBot', 'Common Crawl'],
  ['Bytespider', 'ByteDance'],
  ['meta-externalagent', 'Meta AI'],
];
const SEARCH_BOTS = [['Googlebot', 'Google Search'], ['Bingbot', 'Bing Search']];

/* ---------- render helpers ---------- */
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const ICON = {
  err: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/></svg>',
  warn: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.8 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg>',
  ok: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  info: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
};

function checkCard(c) {
  const rec = c.rec ? `<pre class="rec"><code>${esc(c.rec)}</code></pre>` : '';
  return `<div class="check check--${c.k}">
    <span class="check-ic">${ICON[c.k]}</span>
    <div class="check-body">
      <div class="check-t">${esc(c.t)}</div>
      <div class="check-m">${esc(c.m)}</div>
      ${rec}
    </div>
  </div>`;
}

function note(kind, msg) {
  return `<div class="t-note t-note--${kind}">${esc(msg)}</div>`;
}

function botChip(name, label, verdict) {
  const cls = verdict === 'allowed' ? 'ok' : verdict === 'partial' ? 'warn' : 'err';
  const word = verdict === 'allowed' ? 'allowed' : verdict === 'partial' ? 'partial' : 'blocked';
  return `<div class="bot bot--${cls}"><span class="bot-name">${esc(name)}</span><span class="bot-sub">${esc(label)}</span><span class="bot-state">${word}</span></div>`;
}

function setLoading(target) {
  $('#results').innerHTML = `<div class="t-loading"><span class="spin" aria-hidden="true"></span> Reading robots.txt and llms.txt from ${esc(target)}&hellip;</div>`;
}

/* ---------- scan ---------- */
async function run() {
  const raw = $('#f-url').value.trim();
  if (!raw) { $('#f-url').focus(); return; }
  const btn = $('#check-btn');
  btn.disabled = true;
  setLoading(raw);
  try {
    const res = await fetch('/.netlify/functions/robots-fetch?url=' + encodeURIComponent(raw), { headers: { accept: 'application/json' } });
    const d = await res.json();
    if (d.error) { $('#results').innerHTML = note('err', d.error); return; }
    const domain = (() => { try { return new URL(d.origin).hostname.replace(/^www\./, ''); } catch { return raw; } })();

    const checks = [];
    let botsHtml = '';
    const hasRobots = d.robots && d.robots.status === 200 && d.robots.text;

    if (!hasRobots) {
      checks.push({ k: 'info', t: 'No robots.txt', m: 'Without one, every crawler assumes the whole site is fair game. That is a valid choice, but you lose the place to declare your sitemap and your AI-crawler policy. Generate one below.' });
    } else {
      const parsed = parseRobots(d.robots.text);
      const groupCount = Object.keys(parsed.groups).length;
      const ruleCount = Object.values(parsed.groups).reduce((n, g) => n + g.disallow.length + g.allow.length, 0);

      const star = parsed.groups['*'];
      if (star && star.disallow.some((p) => p === '/') && !star.allow.length) {
        checks.push({ k: 'err', t: 'The entire site is blocked for all crawlers', m: 'User-agent: * with Disallow: / tells every crawler, including Google, to stay out. Correct for a staging site, catastrophic for a live one.' });
      } else {
        checks.push({ k: 'ok', t: `robots.txt found (${groupCount} group${groupCount === 1 ? '' : 's'}, ${ruleCount} rule${ruleCount === 1 ? '' : 's'})`, m: 'The file parses cleanly.' });
      }

      for (const [bot, label] of SEARCH_BOTS) {
        const v = botVerdict(parsed, bot);
        if (v === 'blocked' || v === 'blocked-by-default') {
          checks.push({ k: 'err', t: `${bot} is blocked`, m: `${label} cannot crawl this site, which means it falls out of the index. Almost never intended.` });
        }
      }

      if (parsed.sitemaps.length) {
        checks.push({ k: 'ok', t: `Sitemap declared`, m: `${parsed.sitemaps.length === 1 ? 'One sitemap line points' : parsed.sitemaps.length + ' sitemap lines point'} crawlers at the URL inventory.`, rec: parsed.sitemaps.slice(0, 3).join('\n') });
      } else {
        checks.push({ k: 'warn', t: 'No Sitemap line', m: 'robots.txt is the standard place to declare your sitemap so crawlers find every page. One line fixes it.' });
      }

      const delays = Object.entries(parsed.groups).filter(([, g]) => g.crawlDelay);
      if (delays.length) checks.push({ k: 'info', t: 'Crawl-delay present', m: 'Google ignores it entirely and Bing barely honors it. Harmless, but not doing what most people hope.' });

      const verdicts = AI_BOTS.map(([bot, label]) => [bot, label, botVerdict(parsed, bot)]);
      const blockedCount = verdicts.filter(([, , v]) => v === 'blocked' || v === 'blocked-by-default').length;
      botsHtml = `<div class="dsec"><div class="dsec-h">AI crawlers (${blockedCount} of ${AI_BOTS.length} blocked)</div>
        <div class="bots-note">No judgment either way; blocking or allowing AI crawlers is a policy choice. This is just what the file says.</div>
        <div class="bot-grid bot-grid--report">${verdicts.map(([b, l, v]) => botChip(b, l, v)).join('')}</div></div>`;
    }

    // llms.txt
    const hasLlms = d.llms && d.llms.status === 200 && d.llms.text;
    if (hasLlms) {
      const wellFormed = /^#\s+\S/.test(d.llms.text.trim());
      checks.push({ k: 'ok', t: `llms.txt found${d.llmsFull && d.llmsFull.present ? ' (plus llms-full.txt)' : ''}`, m: wellFormed ? 'The site tells language models what it is about. Early-adopter points.' : 'Present, though it does not start with a # heading like the llms.txt convention expects.', rec: d.llms.text.slice(0, 400) + (d.llms.text.length > 400 ? '\n…' : '') });
    } else {
      checks.push({ k: 'info', t: 'No llms.txt', m: 'An emerging convention: a small markdown file telling AI assistants what your site is about and which pages matter. Costs five minutes; generate one below.' });
    }

    const summary = hasRobots
      ? `Here is what ${domain} tells crawlers.`
      : `${domain} has no robots.txt; crawlers see an open door.`;

    let html = `<div class="t-head"><div class="t-summary">${esc(summary)}</div></div>`;
    html += `<div class="dsec"><div class="dsec-h">Findings</div>${checks.map(checkCard).join('')}</div>`;
    html += botsHtml;
    if (hasRobots) {
      const txt = d.robots.text;
      html += `<div class="dsec"><div class="dsec-h">robots.txt as served</div><pre class="rec rec--file"><code>${esc(txt.slice(0, 4000))}${txt.length > 4000 ? '\n… (truncated for display)' : ''}</code></pre></div>`;
    }
    $('#results').innerHTML = html;
  } catch (e) {
    $('#results').innerHTML = note('err', 'Could not reach the scanner. If you are running locally without Netlify, the scan function is unavailable.');
  } finally {
    btn.disabled = false;
  }
}

/* ---------- generator ---------- */
const GEN_BOTS = ['GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'ClaudeBot', 'Claude-User', 'PerplexityBot', 'Google-Extended', 'Applebot-Extended', 'CCBot', 'Bytespider', 'meta-externalagent'];
const state = { tab: 'robots' };

function genRobots() {
  const blocked = $$('#g-bots input:checked').map((i) => i.value);
  const sitemap = $('#g-sitemap').value.trim();
  const disallows = $('#g-disallow').value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const bot of blocked) out.push(`User-agent: ${bot}\nDisallow: /`);
  out.push(`User-agent: *\n${disallows.length ? disallows.map((p) => `Disallow: ${p.startsWith('/') ? p : '/' + p}`).join('\n') : 'Disallow:'}`);
  if (sitemap) out.push(`Sitemap: ${sitemap}`);
  return out.join('\n\n') + '\n';
}

function genLlms() {
  const name = $('#g-name').value.trim() || 'Your Site';
  const summary = $('#g-summary').value.trim();
  const links = $('#g-links').value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).map((line) => {
    const i = line.indexOf(':');
    if (i < 1) return null;
    const title = line.slice(0, i).trim();
    const url = line.slice(i + 1).trim();
    if (!url) return null;
    return `- [${title}](${url})`;
  }).filter(Boolean);
  const out = [`# ${name}`];
  if (summary) out.push('', `> ${summary}`);
  if (links.length) out.push('', '## Key pages', '', ...links);
  return out.join('\n') + '\n';
}

function renderGen() {
  $('#code').textContent = state.tab === 'robots' ? genRobots() : genLlms();
}

function flash(btn, label) {
  const prev = btn.textContent;
  btn.textContent = label;
  btn.classList.add('btn--done');
  setTimeout(() => { btn.textContent = prev; btn.classList.remove('btn--done'); }, 1100);
}
function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); } catch (e) {}
  document.body.removeChild(ta); done();
}

/* ---------- wire-up ---------- */
function initRobots() {
  initTheme();

  $('#check-form').addEventListener('submit', (e) => { e.preventDefault(); run(); });
  $$('.ex').forEach((b) => b.addEventListener('click', () => { $('#f-url').value = b.dataset.ex; run(); }));

  // generator bot checkboxes
  $('#g-bots').innerHTML = GEN_BOTS.map((b) =>
    `<label class="bot-check"><input type="checkbox" value="${b}" /> <span>${b}</span></label>`).join('');

  $$('[data-gtab]').forEach((b) => b.addEventListener('click', () => {
    state.tab = b.dataset.gtab;
    $$('[data-gtab]').forEach((x) => x.classList.toggle('is-active', x === b));
    $$('.gen-pane').forEach((p) => p.classList.toggle('is-hidden', p.dataset.gpane !== state.tab));
    renderGen();
  }));

  ['#g-sitemap', '#g-disallow', '#g-name', '#g-summary', '#g-links'].forEach((sel) =>
    $(sel).addEventListener('input', renderGen));
  $('#g-bots').addEventListener('change', renderGen);

  $('#copy-btn').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    const text = $('#code').textContent;
    const done = () => flash(btn, 'Copied');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    else fallbackCopy(text, done);
  });
  $('#dl-btn').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    const text = $('#code').textContent;
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = state.tab === 'robots' ? 'robots.txt' : 'llms.txt';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    flash(btn, 'Saved');
  });

  renderGen();
}

export { initRobots };
