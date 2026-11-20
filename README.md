# jiyy-cord (Cloudflare Workers)

API chord gitar dari ChordTela, jalan di Cloudflare Workers, deploy otomatis dari GitHub.

## Cara 1 — Tanpa GitHub Actions (paling gampang)
1. Push repo ini ke GitHub.
2. Cloudflare Dashboard → **Workers & Pages** → **Create** → **Import a repository** → pilih repo.
3. Build command kosongkan, deploy command: `npx wrangler deploy`. Klik **Deploy**.

## Cara 2 — GitHub Actions
Di repo GitHub → Settings → Secrets and variables → Actions, tambahkan:
- `CLOUDFLARE_API_TOKEN` (template "Edit Cloudflare Workers")
- `CLOUDFLARE_ACCOUNT_ID`

Setiap push ke `main` akan deploy otomatis.

## Lokal
```
npm install
npm run dev
```

## Endpoint
- `/api/home`
- `/api/daftar-isi`
- `/api/list/a-b`
- `/api/chord?url=https://www.chordtela.com/...html&transpose=2`
- `/api/search?q=dewa 19`
