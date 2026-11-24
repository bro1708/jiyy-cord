import * as cheerio from 'cheerio';

export const BASE = 'https://www.chordtela.com';
export const CATEGORIES = ['a-b','c-d','e-f','g-h','i-j','k-l','m-n','o-p','q-r','s-t','u-v','w-x','y-z','0-9'];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export class HttpError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.status = status;
  }
}

// ─── Fetch ─────────────────────────────────────────────────────
// Cache di memori isolate: caches.default tidak aktif di *.workers.dev, jadi tanpa ini
// setiap request aplikasi menembak ChordTela langsung dan mudah kena tantangan Cloudflare.
const FRESH_MS = 10 * 60e3;       // dipakai langsung tanpa fetch
const STALE_MS = 24 * 60 * 60e3;  // dipakai hanya bila sumber sedang memblokir
const mem = new Map();            // url -> { html, at }
const inflight = new Map();       // url -> Promise (gabungkan request kembar)

const UAS = [
  UA,
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
];
const sleep = ms => new Promise(r => setTimeout(r, ms));

function remember(url, html) {
  if (mem.size > 150) mem.delete(mem.keys().next().value);
  mem.set(url, { html, at: Date.now() });
}

async function getText(url, attempts = 3) {
  const hit = mem.get(url);
  if (hit && Date.now() - hit.at < FRESH_MS) return hit.html;

  if (inflight.has(url)) return inflight.get(url);
  const job = fetchText(url, attempts, hit).finally(() => inflight.delete(url));
  inflight.set(url, job);
  return job;
}

async function fetchText(url, attempts, stale) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': UAS[(attempt - 1) % UAS.length],
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
          'Upgrade-Insecure-Requests': '1',
        },
        redirect: 'follow',
        // cache edge Cloudflare untuk subrequest; hanya respons sukses yang disimpan
        cf: {
          cacheEverything: true,
          cacheTtlByStatus: { '200-299': 1800, '300-599': 0 },
        },
      });

      const html = await res.text();

      if (
        res.status === 403 ||
        res.status === 429 ||
        res.status === 503 ||
        /Just a moment|Attention Required|cf-chl-|challenge-platform/i.test(html.slice(0, 5000))
      ) {
        throw new HttpError(
          'ChordTela sedang membatasi request (Cloudflare/rate limit). Coba lagi beberapa saat.',
          502
        );
      }

      if (!res.ok) {
        const error = new HttpError(
          `Sumber membalas HTTP ${res.status} untuk ${new URL(url).pathname}`,
          res.status >= 500 ? 502 : res.status
        );

        // Respons server sementara dapat dicoba ulang.
        if (res.status >= 500 && attempt < attempts) {
          lastError = error;
          await sleep(500 * attempt);
          continue;
        }
        throw error;
      }

      if (!html || html.trim().length < 100) {
        lastError = new HttpError('Respons ChordTela kosong atau tidak lengkap.', 502);
        if (attempt < attempts) { await sleep(500 * attempt); continue; }
        throw lastError;
      }

      remember(url, html);
      return html;
    } catch (error) {
      if (error instanceof HttpError && error.status !== 502) throw error;
      lastError = error;

      if (attempt >= attempts) break;
      await sleep(600 * attempt); // jeda sebelum coba lagi (sebelumnya langsung tanpa jeda)
    }
  }

  // Sumber memblokir: lebih baik data lama daripada layar error.
  if (stale && Date.now() - stale.at < STALE_MS) return stale.html;

  if (lastError instanceof HttpError) throw lastError;
  throw new HttpError(
    `Tidak dapat mengambil halaman ChordTela: ${lastError?.message || 'network error'}`,
    502
  );
}

const abs = h => {
  try { return new URL(h, BASE).href; } catch { return ''; }
};

const links = ($, sel) => $(sel).map((_, a) => ({
  title: $(a).text().trim(),
  url: abs($(a).attr('href')),
})).get();

const POST_RE = /\/\d{4}\/\d{2}\/[^/?#]+\.html/;

function postLinks($) {
  const seen = new Set();
  const out = [];

  $('a').each((_, a) => {
    const url = abs($(a).attr('href') || '');
    const title = $(a).text().trim();

    if (!title || !POST_RE.test(url) || seen.has(url)) return;
    seen.add(url);
    out.push({ title, url });
  });

  return out;
}

const tidyTitle = t => t
  .replace(/\s*-\s*ChordTela\.com$/i, '')
  .replace(/^Kunci Gitar\s*/i, '')
  .trim();

// ─── Transpose ─────────────────────────────────────────────────
const NOTES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const FLATS = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];

const idx = n => {
  const i = NOTES.indexOf(n);
  return i === -1 ? FLATS.indexOf(n) : i;
};

function transposeChord(chord, semi) {
  return chord.replace(
    /([A-G][b#]?)(m?(?:maj|min|dim|aug|sus|add|dom)?[0-9]*)/g,
    (m, root, mod) => {
      const i = idx(root);
      return i === -1
        ? m
        : NOTES[(((i + semi) % 12) + 12) % 12] + mod;
    }
  );
}

function transposeHtml(html, semi) {
  const $ = cheerio.load(html, null, false);
  $('script').remove();

  if (!semi) return $.html();

  $('b.tbi-tooltip').each((_, el) => {
    const b = $(el);
    let txt = '';

    b.contents().each((_, c) => {
      if (c.type === 'text') txt += c.data;
    });

    txt = txt.trim();
    if (!txt) return;

    const nc = transposeChord(txt, semi);

    b.contents().each((_, c) => {
      if (c.type === 'text') c.data = nc;
    });

    const span = b.find('span.custom');
    const cls = span.attr('class') || '';
    const m = cls.match(/tbi-[A-G][b#]?m?/);

    if (m) {
      span.attr(
        'class',
        cls.replace(m[0], 'tbi-' + transposeChord(m[0].slice(4), semi))
      );
    }
  });

  return $.html();
}

// ─── Chord content extraction ──────────────────────────────────
function cleanChordNode($, node) {
  const copy = $(node).clone();

  copy.find(
    'script,style,iframe,noscript,form,button,nav,footer,header,.share-buttons,.post-share-buttons,.adsbygoogle'
  ).remove();

  copy.find('[hidden], [style*="display:none"], [style*="display: none"]').remove();

  return copy;
}

function chordScore(text, html) {
  const value = String(text || '').trim();
  if (!value) return 0;

  const chordTokens = (
    value.match(/\b(?:[A-G](?:#|b)?m?(?:maj|min|dim|aug|sus|add)?\d*(?:\/[A-G](?:#|b)?)?)\b/g) || []
  ).length;

  const lyricLines = value.split(/\r?\n/).filter(line => line.trim()).length;
  const hasChordMarkup = /tbi-tooltip|tbi-[A-G]|class=["'][^"']*chord/i.test(html || '');

  // ChordTela biasanya menaruh isi lagu dalam <pre>. Kandidat alternatif
  // tetap harus memiliki cukup banyak pola chord agar artikel biasa tidak lolos.
  if (hasChordMarkup) return 100 + chordTokens;
  if (chordTokens >= 3 && lyricLines >= 2) return 50 + chordTokens;
  return 0;
}

function extractChordHtml($) {
  // Prioritas utama: blok <pre> seperti struktur ChordTela yang umum.
  const preCandidates = $('pre').toArray()
    .map(node => {
      const html = $(node).html() || '';
      const text = $(node).text() || '';
      return { html, text, score: chordScore(text, html) + 1000 };
    })
    .filter(item => item.text.trim());

  if (preCandidates.length) {
    preCandidates.sort((a, b) => b.score - a.score);
    if (preCandidates[0].score >= 1000) return preCandidates[0].html;
  }

  // Struktur tema dapat berubah. Coba wadah konten artikel yang lazim.
  const selectors = [
    '.post-body',
    '.entry-content',
    '.post-body-container',
    '.post-content',
    'article .content',
    'article',
  ];

  const candidates = [];

  for (const selector of selectors) {
    $(selector).each((_, node) => {
      const copy = cleanChordNode($, node);
      const html = copy.html() || '';
      const text = copy.text() || '';
      const score = chordScore(text, html);

      if (score > 0) candidates.push({ html, score });
    });

    // Jika selector yang lebih spesifik sudah menemukan isi lagu, jangan
    // mengambil article yang lebih luas karena dapat ikut membawa sidebar.
    if (candidates.length) break;
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.html || '';
}

function parseChordPage(html, url, semi) {
  const $ = cheerio.load(html);
  const title = tidyTitle(
    ($('h1').first().text() || $('meta[property="og:title"]').attr('content') || $('title').text())
      .replace(/\s*\|.*$/, '')
      .trim()
  );

  const raw = extractChordHtml($);
  if (!raw) return null;

  const contentHtml = transposeHtml(raw, semi);
  const content = cheerio.load(contentHtml, null, false).text().trim();

  if (!content) return null;

  return {
    success: true,
    title,
    url,
    transpose: semi,
    contentHtml,
    content,
  };
}

// ─── Scrapers ──────────────────────────────────────────────────
export async function home() {
  const $ = cheerio.load(await getText(BASE));
  const w = $('.widget_recent_entries')
    .map((_, el) => [links($, $(el).find('li a'))])
    .get();

  let latest = w[0] || [];
  if (!latest.length) latest = postLinks($).slice(0, 30);

  return {
    success: true,
    source: BASE,
    latest,
    featured: w[1] || [],
  };
}

export async function daftarIsi() {
  const url = `${BASE}/daftar-isi`;
  const $ = cheerio.load(await getText(url));
  const data = links($, '.post-body a').filter(i => i.title && i.url);

  return {
    success: true,
    source: url,
    total: data.length,
    data,
  };
}

export async function category(cat) {
  if (!CATEGORIES.includes(cat)) {
    throw new HttpError(
      `Kategori tidak valid. Pilih: ${CATEGORIES.join(', ')}`,
      400
    );
  }

  const url = `${BASE}/chord-gitar-${cat}`;
  const $ = cheerio.load(await getText(url));

  const data = links($, '.post-body a').filter(i =>
    i.url.includes('/chord/') &&
    !i.url.includes('chord-gitar-') &&
    !i.url.includes('daftar-isi')
  );

  return {
    success: true,
    category: cat.toUpperCase(),
    source: url,
    total: data.length,
    data,
  };
}

export async function chord(url, semi = 0) {
  if (!/^https?:\/\/(www\.)?chordtela\.com\//i.test(url || '')) {
    throw new HttpError(
      'URL tidak valid. Harus dari chordtela.com',
      400
    );
  }

  semi = Math.max(-11, Math.min(11, parseInt(semi, 10) || 0));

  // Validasi URL dan cegah host lain lolos lewat URL yang dibuat-buat.
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new HttpError('Format URL lagu tidak valid.', 400);
  }

  if (!['chordtela.com', 'www.chordtela.com'].includes(parsed.hostname)) {
    throw new HttpError('URL harus berasal dari chordtela.com', 400);
  }

  // Percobaan ulang khusus untuk kasus halaman terbuka tetapi markup chord
  // belum termuat/berbeda. Tidak mengubah URL lagu yang diminta.
  let lastHtml = '';

  for (let attempt = 1; attempt <= 2; attempt++) {
    const html = await getText(parsed.href);
    lastHtml = html;

    const result = parseChordPage(html, parsed.href, semi);
    if (result) return result;
  }

  // Diagnostik ringan agar pesan error tidak menyesatkan.
  const $ = cheerio.load(lastHtml);
  const hasPost = $('.post-body, .entry-content, article').length > 0;
  const hasPre = $('pre').length > 0;

  if (!hasPost && !hasPre) {
    throw new HttpError(
      'Halaman ChordTela terbuka, tetapi struktur artikel tidak ditemukan. Coba lagi beberapa saat.',
      502
    );
  }

  throw new HttpError(
    'Isi chord tidak ditemukan pada struktur halaman ChordTela. Kemungkinan halaman sumber sedang berubah atau kontennya belum termuat.',
    404
  );
}

// ─── Search ────────────────────────────────────────────────────
// Pencarian ChordTela memakai Google CSE.
const SEARCH_PAGE = `${BASE}/chord-kunci-gitar-dasar-hasil-pencarian`;
let cse = null; // { cx, tok, ver, t }

async function cseInit() {
  if (cse && Date.now() - cse.t < 3600_000) return cse;

  const page = await getText(SEARCH_PAGE);
  const cx = (
    page.match(/cse(?:\.js)?\?[^"']*?cx=([^"'&\s]+)/) ||
    page.match(/["']?\bcx["']?\s*[:=]\s*["']([^"']+)["']/) ||
    []
  )[1];

  if (!cx) {
    throw new HttpError(
      'ID mesin pencarian (cx) tidak ditemukan di halaman pencarian ChordTela',
      502
    );
  }

  const response = await fetch(
    `https://cse.google.com/cse.js?hpg=1&cx=${encodeURIComponent(cx)}`,
    {
      headers: {
        'User-Agent': UA,
        Referer: SEARCH_PAGE,
      },
    }
  );

  if (!response.ok) {
    throw new HttpError(`Google CSE membalas HTTP ${response.status}`, 502);
  }

  const js = await response.text();
  const tok = (js.match(/"cse_token"\s*:\s*"([^"]+)"/) || [])[1];
  const ver = (js.match(/"cselibVersion"\s*:\s*"([^"]+)"/) || [])[1];

  if (!tok) {
    throw new HttpError('Token pencarian Google CSE tidak ditemukan', 502);
  }

  return (cse = {
    cx,
    tok,
    ver: ver || '',
    t: Date.now(),
  });
}

const norm = s => s
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

// Urutkan hasil: judul/slug yang memuat kata kunci di atas.
function rank(items, q) {
  const toks = norm(q).split(' ').filter(Boolean);
  const need = Math.max(1, Math.ceil(toks.length * 0.6));

  const scored = items.map((it, i) => {
    let slug = '';

    try {
      slug = decodeURIComponent(it.url.split('/').pop() || '')
        .replace(/\.html$/, '')
        .replace(/-/g, ' ');
    } catch {}

    const hay = norm(it.title + ' ' + slug);

    return {
      it,
      i,
      hit: toks.filter(t => hay.includes(t)).length,
    };
  });

  scored.sort((a, b) => b.hit - a.hit || a.i - b.i);

  const good = scored.filter(x => x.hit >= need);

  return {
    data: (good.length ? good : scored).map(x => x.it),
    loose: !good.length,
  };
}

async function cseCall(c, q, start) {
  const u = 'https://cse.google.com/cse/element/v1?' + new URLSearchParams({
    rsz: 'filtered_cse',
    num: '10',
    start: String(start),
    hl: 'id',
    source: 'gcsc',
    gss: '.com',
    cselibv: c.ver,
    cx: c.cx,
    q,
    safe: 'off',
    cse_tok: c.tok,
    sort: '',
    exp: 'cc,apo',
    callback: 'cb',
    rurl: SEARCH_PAGE,
  });

  const res = await fetch(u, {
    headers: {
      'User-Agent': UA,
      Referer: SEARCH_PAGE,
    },
  });

  const text = await res.text();

  try {
    const json = JSON.parse(
      text.slice(text.indexOf('(') + 1, text.lastIndexOf(')'))
    );

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    return json.results || [];
  } catch {
    throw new HttpError(
      `Google CSE membalas HTTP ${res.status} dan hasilnya tidak bisa dibaca`,
      502
    );
  }
}

export async function search(q, debug = false) {
  if (!q) throw new HttpError('Parameter q wajib diisi', 400);

  const c = await cseInit();
  const [p1, p2] = await Promise.allSettled([
    cseCall(c, q, 0),
    cseCall(c, q, 10),
  ]);

  if (p1.status === 'rejected') {
    cse = null;
    throw p1.reason;
  }

  const raw = [
    ...p1.value,
    ...(p2.status === 'fulfilled' ? p2.value : []),
  ];

  const seen = new Set();

  const items = raw.map(r => ({
    title: tidyTitle(r.titleNoFormatting || ''),
    url: r.unescapedUrl || r.url || '',
  })).filter(i =>
    i.title &&
    POST_RE.test(i.url) &&
    !seen.has(i.url) &&
    seen.add(i.url)
  );

  const { data, loose } = rank(items, q);

  const out = {
    success: true,
    query: q,
    source: 'google-cse',
    total: data.length,
    loose,
    data,
  };

  if (debug) {
    out.debug = {
      cx: c.cx,
      rawCount: raw.length,
      raw: raw.map(r => ({
        t: r.titleNoFormatting,
        u: r.unescapedUrl || r.url,
      })),
    };
  }

  return out;
}

// ─── Probe ─────────────────────────────────────────────────────
// Diagnosa status tiap alamat sumber dari sisi Worker.
export async function probe() {
  const targets = [
    '/',
    '/daftar-isi',
    '/chord-gitar-a-b',
    '/feeds/posts/summary?alt=json&max-results=1',
    '/search?q=dewa',
    '/chord-kunci-gitar-dasar-hasil-pencarian?q=dewa',
  ];

  const results = await Promise.all(targets.map(async path => {
    try {
      const r = await fetch(BASE + path, {
        headers: { 'User-Agent': UA },
        redirect: 'manual',
      });

      const t = await r.text();

      return {
        path,
        status: r.status,
        location: r.headers.get('location'),
        bytes: t.length,
        challenge: /Just a moment|Attention Required|cf-chl-/i.test(t.slice(0, 5000)),
        postLinks: (t.match(/\/\d{4}\/\d{2}\/[^"'\s<>]+\.html/g) || []).length,
        preCount: (t.match(/<pre\b/gi) || []).length,
        postBody: /class=["'][^"']*post-body/i.test(t),
        head: t.slice(0, 120).replace(/\s+/g, ' '),
      };
    } catch (e) {
      return {
        path,
        error: e.message,
      };
    }
  }));

  return {
    success: true,
    base: BASE,
    results,
  };
}
