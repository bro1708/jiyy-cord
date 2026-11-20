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
  if (!res.ok) throw new HttpError(`Sumber membalas HTTP ${res.status}`, 502);
  return text;
}

const abs = h => { try { return new URL(h, BASE).href; } catch { return ''; } };
const links = ($, sel) => $(sel).map((_, a) => ({ title: $(a).text().trim(), url: abs($(a).attr('href')) })).get();

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
  return { success: true, source: BASE, latest: w[0] || [], featured: w[1] || [] };
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

// Situs ini berbasis Blogger → pakai feed JSON bawaan (tanpa browser)
export async function search(q) {
  if (!q) throw new HttpError('Parameter q wajib diisi', 400);
  const url = `${BASE}/feeds/posts/summary?q=${encodeURIComponent(q)}&alt=json&max-results=25`;
  let json;
  try { json = JSON.parse(await getText(url)); }
  catch (e) { if (e instanceof HttpError) throw e; throw new HttpError('Feed pencarian tidak bisa dibaca', 502); }
  const data = (json.feed?.entry || []).map(e => ({
    title: (e.title?.$t || '').replace(/^Kunci Gitar\s*/i, '').trim(),
    url: (e.link || []).find(l => l.rel === 'alternate')?.href || '',
  })).filter(i => i.title && i.url);
  return { success: true, query: q, source: url, total: data.length, data };
}
