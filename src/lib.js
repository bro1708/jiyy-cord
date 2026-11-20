import * as cheerio from 'cheerio';

export const BASE = 'https://www.chordtela.com';
export const CATEGORIES = ['a-b','c-d','e-f','g-h','i-j','k-l','m-n','o-p','q-r','s-t','u-v','w-x','y-z','0-9'];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export class HttpError extends Error {
  constructor(message, status = 500) { super(message); this.status = status; }
}

// ─── Fetch ─────────────────────────────────────────────────────
async function getText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8' } });
  const text = await res.text();
  if (res.status === 403 || res.status === 503 || /Just a moment|Attention Required/i.test(text.slice(0, 3000)))
    throw new HttpError('Sumber (chordtela.com) memblokir request ini (Cloudflare challenge)', 502);
  if (!res.ok) throw new HttpError(`Sumber membalas HTTP ${res.status} untuk ${new URL(url).pathname}`, 502);
  return text;
}

const abs = h => { try { return new URL(h, BASE).href; } catch { return ''; } };
const links = ($, sel) => $(sel).map((_, a) => ({ title: $(a).text().trim(), url: abs($(a).attr('href')) })).get();

const POST_RE = /\/\d{4}\/\d{2}\/[^/?#]+\.html/;
function postLinks($) {
  const seen = new Set(), out = [];
  $('a').each((_, a) => {
    const url = abs($(a).attr('href') || ''), title = $(a).text().trim();
    if (!title || !POST_RE.test(url) || seen.has(url)) return;
    seen.add(url); out.push({ title, url });
  });
  return out;
}
const tidyTitle = t => t.replace(/\s*-\s*ChordTela\.com$/i, '').replace(/^Kunci Gitar\s*/i, '').trim();

// ─── Transpose ─────────────────────────────────────────────────
const NOTES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const FLATS = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
const idx = n => { const i = NOTES.indexOf(n); return i === -1 ? FLATS.indexOf(n) : i; };

function transposeChord(chord, semi) {
  return chord.replace(/([A-G][b#]?)(m?(?:maj|min|dim|aug|sus|add|dom)?[0-9]*)/g, (m, root, mod) => {
    const i = idx(root);
    return i === -1 ? m : NOTES[(((i + semi) % 12) + 12) % 12] + mod;
  });
}

function transposeHtml(html, semi) {
  const $ = cheerio.load(html, null, false);
  $('script').remove();
  if (!semi) return $.html();
  $('b.tbi-tooltip').each((_, el) => {
    const b = $(el);
    let txt = '';
    b.contents().each((_, c) => { if (c.type === 'text') txt += c.data; });
    txt = txt.trim();
    if (!txt) return;
    const nc = transposeChord(txt, semi);
    b.contents().each((_, c) => { if (c.type === 'text') c.data = nc; });
    const span = b.find('span.custom');
    const cls = span.attr('class') || '';
    const m = cls.match(/tbi-[A-G][b#]?m?/);
    if (m) span.attr('class', cls.replace(m[0], 'tbi-' + transposeChord(m[0].slice(4), semi)));
  });
  return $.html();
}

// ─── Scrapers ──────────────────────────────────────────────────
export async function home() {
  const $ = cheerio.load(await getText(BASE));
  const w = $('.widget_recent_entries').map((_, el) => [links($, $(el).find('li a'))]).get();
  let latest = w[0] || [];
  if (!latest.length) latest = postLinks($).slice(0, 30);
  return { success: true, source: BASE, latest, featured: w[1] || [] };
}

export async function daftarIsi() {
  const $ = cheerio.load(await getText(`${BASE}/daftar-isi`));
  const data = links($, '.post-body a').filter(i => i.title && i.url);
  return { success: true, source: `${BASE}/daftar-isi`, total: data.length, data };
}

export async function category(cat) {
  if (!CATEGORIES.includes(cat)) throw new HttpError(`Kategori tidak valid. Pilih: ${CATEGORIES.join(', ')}`, 400);
  const url = `${BASE}/chord-gitar-${cat}`;
  const $ = cheerio.load(await getText(url));
  const data = links($, '.post-body a').filter(i => i.url.includes('/chord/') && !i.url.includes('chord-gitar-') && !i.url.includes('daftar-isi'));
  return { success: true, category: cat.toUpperCase(), source: url, total: data.length, data };
}

export async function chord(url, semi = 0) {
  if (!/^https?:\/\/(www\.)?chordtela\.com\//.test(url || '')) throw new HttpError('URL tidak valid. Harus dari chordtela.com', 400);
  semi = Math.max(-11, Math.min(11, parseInt(semi, 10) || 0));
  const $ = cheerio.load(await getText(url));
  const title = ($('h1').first().text() || $('title').text()).replace(/\s*\|.*$/, '').trim();
  const raw = $('pre').first().html() || '';
  if (!raw) throw new HttpError('Chord tidak ditemukan di halaman ini', 404);
  const contentHtml = transposeHtml(raw, semi);
  const content = cheerio.load(contentHtml, null, false).text().trim();
  return { success: true, title, url, transpose: semi, contentHtml, content };
}

// Pencarian tanpa browser: coba feed Blogger, lalu halaman /search bawaan Blogger
export async function search(q) {
  if (!q) throw new HttpError('Parameter q wajib diisi', 400);
  const enc = encodeURIComponent(q);
  let data = [], source = '', feedErr, htmlErr;

  const feedUrl = `${BASE}/feeds/posts/summary?q=${enc}&alt=json&max-results=25`;
  try {
    const json = JSON.parse(await getText(feedUrl));
    data = (json.feed?.entry || []).map(e => ({
      title: tidyTitle(e.title?.$t || ''),
      url: (e.link || []).find(l => l.rel === 'alternate')?.href || '',
    })).filter(i => i.title && i.url);
    source = feedUrl;
  } catch (e) { feedErr = e; }

  if (!data.length) {
    const htmlUrl = `${BASE}/search?q=${enc}&max-results=25`;
    try {
      const $ = cheerio.load(await getText(htmlUrl));
      data = postLinks($).map(i => ({ ...i, title: tidyTitle(i.title) })).filter(i => i.title);
      source = htmlUrl;
    } catch (e) { htmlErr = e; }
  }

  if (!data.length && feedErr && htmlErr)
    throw new HttpError(`Pencarian gagal. Feed: ${feedErr.message}. Halaman cari: ${htmlErr.message}`, 502);
  return { success: true, query: q, source, total: data.length, data };
}

// Diagnosa: cek status tiap alamat sumber dari sisi Worker
export async function probe() {
  const targets = ['/', '/daftar-isi', '/chord-gitar-a-b', '/feeds/posts/summary?alt=json&max-results=1', '/search?q=dewa', '/chord-kunci-gitar-dasar-hasil-pencarian?q=dewa'];
  const results = await Promise.all(targets.map(async path => {
    try {
      const r = await fetch(BASE + path, { headers: { 'User-Agent': UA }, redirect: 'manual' });
      const t = await r.text();
      return {
        path, status: r.status, location: r.headers.get('location'), bytes: t.length,
        challenge: /Just a moment|Attention Required/i.test(t.slice(0, 3000)),
        postLinks: (t.match(/\/\d{4}\/\d{2}\/[^"'\s<>]+\.html/g) || []).length,
        head: t.slice(0, 120).replace(/\s+/g, ' '),
      };
    } catch (e) { return { path, error: e.message }; }
  }));
  return { success: true, base: BASE, results };
}
