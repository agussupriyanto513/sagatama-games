// api/_sgtClient.js
// Helper dipakai oleh SEMUA endpoint Games yang dulu langsung mengubah
// field `sgtBalance` di Firestore lokal (`players/{uid}`). Sekarang saldo
// SGT sesungguhnya hidup di backend Mart (sgt_wallets/{username}), jadi
// endpoint Games manggil helper ini, bukan `tx.set(playerRef,{sgtBalance})`.
//
// PENTING: identitas yang dipakai untuk memanggil central API adalah
// `username` Pi (bukan `uid` lokal Games) — lihat catatan di
// api/sgt/_lib.js pada repo sagatama-mart.

const SGT_BACKEND = process.env.SGT_BACKEND_URL || 'https://sagatama-mart.vercel.app';

async function sgtCall(endpoint, body) {
  const secret = process.env.SGT_INTERNAL_SECRET;
  if (!secret) throw new Error('SGT_INTERNAL_SECRET belum diset di environment Games');

  const res = await fetch(`${SGT_BACKEND}/api/sgt/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Secret': secret
    },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error || `sgt/${endpoint} gagal`);
    err.detail = data;
    err.status = res.status;
    throw err;
  }
  return data;
}

// Tambah saldo SGT. amount harus > 0. txId wajib unik per kejadian nyata.
async function sgtCredit({ username, amount, txId, source, meta }) {
  if (!(amount > 0)) return null; // tidak ada yang perlu dikreditkan
  return sgtCall('credit', { username, amount, txId, source, meta });
}

// Kurangi saldo SGT. Melempar error kalau saldo tidak cukup (kecuali
// allowNegative dikirim eksplisit oleh caller lewat meta khusus).
async function sgtDebit({ username, amount, txId, source, meta, allowNegative }) {
  if (!(amount > 0)) return null;
  return sgtCall('debit', { username, amount, txId, source, meta, allowNegative });
}

// Pastikan wallet central ada untuk uid lokal ini, dan ambil username +
// saldo terkini. Dipakai saat login (pi-auth.js).
async function sgtEnsureByAccessToken(accessToken) {
  return sgtCall('ensure', { accessToken });
}


// Ambil saldo lewat username (dipakai app yang tidak selalu punya
// accessToken Pi segar, mis. halaman yang login lewat sesi sekolah sendiri).
async function sgtBalanceByUsername(username) {
  return sgtCall('balance-internal', { username });
}

export { sgtCredit, sgtDebit, sgtEnsureByAccessToken, sgtBalanceByUsername, sgtCall };
