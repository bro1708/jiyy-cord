# jiyy-cord

Aplikasi web dan REST API untuk mencari chord gitar, mengganti nada dasar (transpose), dan membaca dengan gulir otomatis. Berjalan di Cloudflare Workers tanpa server, tanpa database, dan tanpa biaya hosting di paket gratis.

> Proyek tidak resmi. Data chord diambil dari [chordtela.com](https://www.chordtela.com) dan seluruh hak atas konten tetap milik pemilik aslinya.

## Fitur

- **Pencarian lagu** berdasarkan judul atau artis. Hasil diurutkan menurut kecocokan judul.
- **Transpose** dari −11 sampai +11 semitone dengan satu ketukan.
- **Gulir otomatis** dengan kecepatan yang bisa diatur dan indikator progres baca.
- **Daftar chord terbaru, pilihan, dan indeks artis** A–Z.
- **Ringan dan cepat.** Satu halaman statis tanpa framework, dilayani langsung oleh Worker yang sama dengan API.
- **Antarmuka seluler:** tampilan kaca (glass), animasi shimmer, ikon SVG, dan zoom dinonaktifkan agar tidak mengganggu saat bermain gitar.

## Endpoint API

| Endpoint | Fungsi |
| --- | --- |
| `GET /api/home` | Chord terbaru dan pilihan dari beranda |
| `GET /api/daftar-isi` | Daftar isi situs |
| `GET /api/list/:kategori` | Daftar artis per huruf: `a-b`, `c-d`, … `y-z`, `0-9` |
| `GET /api/chord?url=<url>&transpose=<n>` | Isi chord satu lagu, dengan transpose opsional (−11 sampai +11) |
| `GET /api/search?q=<kata kunci>` | Cari lagu. Tambahkan `&debug=1` untuk melihat hasil mentah |
| `GET /api/probe` | Diagnosa: status tiap alamat sumber dilihat dari Worker |

Semua balasan berformat JSON dengan kolom `success`. Saat gagal: `{ "success": false, "error": "..." }`.

Contoh:

```bash
curl "https://jiyy-cord.<subdomain>.workers.dev/api/search?q=dewa%2019"
curl "https://jiyy-cord.<subdomain>.workers.dev/api/chord?url=<url-lagu>&transpose=2"
```

## Struktur proyek

```
.
├── public/
│   └── index.html      # antarmuka web (statis)
├── src/
│   ├── index.js        # router Worker dan penanganan error
│   └── lib.js          # scraper, transpose, pencarian
├── .github/workflows/
│   └── deploy.yml      # deploy otomatis lewat GitHub Actions
├── wrangler.toml       # konfigurasi Cloudflare Workers
└── package.json
```

## Deploy

### Opsi A: Cloudflare Workers Builds (paling mudah)

1. Push repo ke GitHub.
2. Cloudflare Dashboard → **Workers & Pages** → **Create** → **Import a repository**.
3. Build command kosong. Deploy command: `npx wrangler deploy`.

### Opsi B: GitHub Actions

Tambahkan secret di repo (Settings → Secrets and variables → Actions):

- `CLOUDFLARE_API_TOKEN` (template *Edit Cloudflare Workers*)
- `CLOUDFLARE_ACCOUNT_ID`

Setiap push ke `main` akan men-deploy otomatis.

## Pengembangan lokal

```bash
npm install
npm run dev      # http://localhost:8787
```

## Konfigurasi

| Variabel | Default | Keterangan |
| --- | --- | --- |
| `CACHE_MINUTES` | `30` | Lama cache respons API (`wrangler.toml`, bagian `[vars]`) |

## Pemecahan masalah

- **Error 502 "memblokir request":** situs sumber menampilkan tantangan Cloudflare ke Worker. Buka `/api/probe` untuk melihat status tiap alamat.
- **Hasil pencarian tidak sesuai:** buka `/api/search?q=...&debug=1` dan periksa hasil mentah sebelum disaring.
- **Beranda kosong:** struktur HTML situs sumber mungkin berubah. Selektor ada di `src/lib.js`.

## Catatan penggunaan

Proyek ini dibuat untuk keperluan belajar dan pemakaian pribadi. Hormati ketentuan situs sumber dan hak cipta lagu. Jangan memakainya untuk membanjiri server sumber dengan permintaan; cache bawaan ada untuk mengurangi beban itu.
