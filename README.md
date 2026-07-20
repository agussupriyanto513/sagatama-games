
# 🎮 Sagatama Games — Pi Network Ecosystem

Game arcade berbasis Pi Network dengan token SGT (Sagatama Token).  
Deploy backend: `sagatama-games.vercel.app` — ini sudah sinkron dengan `BACKEND_URL` di dalam `SAGATAMA-GAMES.html`. Kalau suatu saat kamu deploy ulang dengan nama project Vercel yang beda, ganti juga nilai `BACKEND_URL` di file HTML (cari `const BACKEND_URL = "https://sagatama-games.vercel.app";`) supaya tetap sinkron.

---

## 📁 Struktur Folder

```
sagatama-ecosystem/
├── public/
│   └── SAGATAMA-GAMES.html      # Frontend game utama
├── api/
│   ├── pi-auth.js               # POST /api/pi-auth
│   ├── players/
│   │   └── ensure.js            # POST /api/players/ensure
│   ├── games/
│   │   └── save-progress.js     # POST /api/games/save-progress
│   └── payments/
│       ├── approve.js           # POST /api/payments/approve
│       ├── complete.js          # POST /api/payments/complete
│       ├── cancel.js            # POST /api/payments/cancel
│       ├── incomplete.js        # POST /api/payments/incomplete
│       ├── payout.js            # POST /api/payments/payout
│       ├── welcome-bonus.js     # POST /api/payments/welcome-bonus
│       ├── cancel-stuck.js      # POST /api/payments/cancel-stuck
│       └── resolve-stuck.js     # POST /api/payments/resolve-stuck
├── .env.example                 # Template environment variables
├── .gitignore
├── vercel.json
└── package.json
```

---

## 🛠️ Catatan Perbaikan (Update Terbaru)

Perbaikan berikut sudah diterapkan pada kode ini:

- **Domain backend tidak konsisten** — beberapa fungsi frontend (top-up, payout, incomplete-payment) memanggil `sagatama-games.vercel.app` langsung (hardcoded), sedangkan fungsi lain (`panggilAPI`, ensure player, save progress) memakai `BACKEND_URL` yang isinya `sagatama-backend.vercel.app` — domain yang **tidak pernah benar-benar di-deploy**. Sekarang semua sudah diseragamkan ke `sagatama-games.vercel.app`, yaitu domain Vercel yang sungguh-sungguh dipakai.
- **Endpoint backend yang hilang** — `/api/players/ensure` dan `/api/games/save-progress` dipanggil oleh frontend tapi filenya tidak ada, sehingga saldo SGT tidak pernah benar-benar tersinkron ke Firestore (hanya tersimpan di localStorage device). Kedua endpoint sudah dibuat.
- **Kerentanan saldo SGT top-up** — `sgtAmount` sebelumnya dipercaya langsung dari client tanpa verifikasi, memungkinkan user mengklaim SGT jauh lebih banyak dari Pi yang benar-benar dibayar. Sekarang dihitung server-side dari jumlah Pi yang terverifikasi oleh Pi Platform.
- **Kerentanan payout Pi (kritis)** — endpoint `/api/payments/payout` sebelumnya TIDAK memeriksa saldo SGT sama sekali sebelum mengirim Pi asli ke wallet user, sehingga bisa dieksploitasi untuk menguras saldo Pi aplikasi. Sekarang saldo SGT diverifikasi & dipotong (dengan mekanisme refund otomatis jika payment gagal) sebelum Pi dikirim.
- **Verifikasi identitas (auth)** — endpoint pembayaran (`approve`, `complete`, `payout`, `welcome-bonus`) sekarang memverifikasi Firebase ID token dari header `Authorization`, memastikan `uid` yang dikirim benar-benar milik pemanggil.
- **Ukuran halaman** — logo yang sebelumnya di-embed berulang 4× sebagai base64 (≈480KB dari total 707KB) sekarang hanya disimpan sekali, mengurangi ukuran file dari 707KB → 342KB.

**Belum tercakup (bisa dikerjakan berikutnya jika perlu):** endpoint `/api/games/win`, `/api/games/level-bonus`, `/api/games/daily-reward`, dan `/api/games/shop-buy` juga dipanggil oleh frontend tapi belum ada di backend — saat ini game tetap berjalan karena ada fallback lokal, tapi progres kemenangan/bonus level/hadiah harian belum tersinkron ke cloud lintas perangkat.



### 1. Set Environment Variables di Vercel Dashboard
Buka: **Vercel → Project → Settings → Environment Variables**

| Key | Nilai |
|-----|-------|
| `FIREBASE_PROJECT_ID` | `portal-sagatama` (HARUS sama dengan `projectId` di firebaseConfig frontend!) |
| `FIREBASE_CLIENT_EMAIL` | dari Firebase Service Account |
| `FIREBASE_PRIVATE_KEY` | dari Firebase Service Account |
| `PI_API_KEY` | dari Pi Developer Portal |

### 2. Ambil Firebase Service Account
1. Firebase Console → ⚙️ Settings → **Service Accounts**
2. Klik **Generate new private key** → download JSON
3. Salin nilai `client_email` dan `private_key` ke Vercel

### 3. Ambil Pi API Key
1. Buka [Pi Developer Portal](https://developers.minepi.com)
2. My Apps → pilih app → **API Keys**

---

## 🔥 Firestore Collections

| Collection | Kegunaan |
|---|---|
| `players` | Data & saldo SGT tiap player |
| `pi_payments` | Riwayat transaksi Pi |
| `leaderboard` | Skor tertinggi per game |
| `topup_history` | Riwayat top-up SGT |

---

## 🎮 Games

- 🧩 **BLOK SGT** — Tetris-style (gratis)
- 🔮 **ORB BLAST** — Zuma shooter
- 🏃 **SGT RUNNER** — Endless runner
- ♟️ **RAJA CATUR** — Chess vs AI
- 🎲 **DADU ARENA** — Ludo multiplayer
- 🏎️ **TURBO SGT** — Racing game
- 🍄 **SAGA JUMP** — Platformer
- 🧱 **BRICK SGT** — Breakout
