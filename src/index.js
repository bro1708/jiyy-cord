import * as ct from './lib.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

const INFO = {
  success: true,
  version: 'v2-cache-stale',
  name: 'jiyy-cord API (ChordTela) — Cloudflare Workers',
  endpoints: {
    home: '/api/home',
    daftarIsi: '/api/daftar-isi',
    list: '/api/list/:kategori   (a-b, c-d, ..., 0-9)',
    chord: '/api/chord?url=<url chordtela>&transpose=2',
    search: '/api/search?q=dewa 19',
  },
};

async function route(url) {
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const q = url.searchParams;
  if (p === '/' || p === '/api') return INFO;
  if (p === '/api/home') return ct.home();
  if (p === '/api/daftar-isi') return ct.daftarIsi();
  if (p.startsWith('/api/list/')) return ct.category(decodeURIComponent(p.slice(10)).toLowerCase());
  if (p === '/api/chord') return ct.chord(q.get('url'), q.get('transpose'));
  if (p === '/api/probe') return ct.probe();
  if (p === '/api/search') return ct.search((q.get('q') || '').trim(), q.get('debug') === '1');
  throw new ct.HttpError('Not found', 404);
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: CORS });

    const cache = caches.default; // aktif di custom domain; di workers.dev tidak berefek
    const hit = await cache.match(request);
    if (hit) return hit;

    const maxAge = (parseInt(env.CACHE_MINUTES, 10) || 30) * 60;
    try {
      const data = await route(new URL(request.url));
      const res = new Response(JSON.stringify(data, null, 2), {
        headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `public, max-age=${maxAge}` },
      });
      ctx.waitUntil(cache.put(request, res.clone()));
      return res;
    } catch (e) {
      return new Response(JSON.stringify({ success: false, error: e.message }), {
        status: e.status || 500,
        headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
      });
    }
  },
};
