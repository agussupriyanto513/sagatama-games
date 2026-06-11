# 🎮 Sagatama Games — Pi Network Ecosystem

Game arcade berbasis Pi Network dengan token SGT (Sagatama Token).  
Deploy: [sagatama-ecosystem.vercel.app](https://sagatama-ecosystem.vercel.app)

---

## 📁 Struktur Folder

```
sagatama-ecosystem/
├── public/
│   └── SAGATAMA-GAMES.html      # Frontend game utama
├── api/
│   ├── pi-auth.js               # POST /api/pi-auth
│   └── payments/
│       ├── approve.js           # POST /api/pi-payment/approve
│       ├── complete.js          # POST /api/pi-payment/complete
│       ├── cancel.js            # POST /api/pi-payment/cancel
│       └── incomplete.js        # POST /api/pi-payment/incomplete
├── .env.example                 # Template environment variables
├── .gitignore
├── vercel.json
└── package.json
```

---

## 🚀 Deploy ke Vercel

### 1. Set Environment Variables di Vercel Dashboard
Buka: **Vercel → Project → Settings → Environment Variables**

| Key | Nilai |
|-----|-------|
| `FIREBASE_PROJECT_ID` | `sagatama-ecosystem` |
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
