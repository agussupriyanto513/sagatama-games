// /api/debug-pi-key.js
// ══════════════════════════════════════════════════════════════════
// ENDPOINT DEBUG SEMENTARA — buka langsung dari browser (GET request)
// untuk cek apakah PI_API_KEY yang aktif di server itu valid atau tidak,
// TANPA perlu melakukan top-up sungguhan.
//
// Cara pakai: buka di browser →
//   https://sagatama-games.vercel.app/api/debug-pi-key
//
// PENTING: hapus file ini (dan baris route-nya di vercel.json) setelah
// masalah top-up selesai — endpoint ini tidak untuk dipakai permanen.
// ══════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  const rawKey = process.env.PI_API_KEY || '';
  const trimmedKey = rawKey.trim();

  const info = {
    keyIsSet: rawKey.length > 0,
    keyLen: trimmedKey.length,
    keyPreview: trimmedKey.length > 8
      ? `${trimmedKey.slice(0, 4)}...${trimmedKey.slice(-4)}`
      : '(terlalu pendek / kosong)',
    hasWhitespaceOrQuotes: rawKey !== trimmedKey,
  };

  // Panggil endpoint approve Pi dengan paymentId PALSU yang sengaja acak.
  // Tujuannya BUKAN supaya berhasil (pasti gagal, ID-nya memang tidak ada),
  // tapi untuk melihat JENIS error yang dikembalikan Pi Platform:
  //
  //  - Kalau errornya "payment_not_found" → key VALID & dikenali Pi
  //    (key sudah benar terhubung ke sebuah App), cuma ID-nya yang memang
  //    tidak ada — ini NORMAL dan DIHARAPKAN untuk tes ini.
  //  - Kalau errornya soal auth/key tidak valid (401, "invalid api key",
  //    dsb) → key itu sendiri salah/kadaluarsa, harus diganti.
  const fakePaymentId = 'debug-test-' + Date.now();

  let piResult;
  try {
    const resp = await fetch(
      `https://api.minepi.com/v2/payments/${fakePaymentId}/approve`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Key ${trimmedKey}`,
          'Content-Type': 'application/json'
        }
      }
    );
    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    piResult = { httpStatus: resp.status, body: data };
  } catch (e) {
    piResult = { fetchError: e.message };
  }

  let diagnosis = '❓ Tidak bisa disimpulkan otomatis, lihat piResult di bawah.';
  const bodyErr = piResult?.body?.error;
  if (bodyErr === 'payment_not_found') {
    diagnosis = '✅ KEY VALID — Pi Platform mengenali key ini (terhubung ke sebuah App). "payment_not_found" di tes ini WAJAR karena ID yang dipakai memang sengaja palsu.';
  } else if (piResult.httpStatus === 401 || bodyErr === 'invalid_key' || bodyErr === 'unauthorized') {
    diagnosis = '❌ KEY TIDAK VALID — server ditolak Pi Platform saat autentikasi. Key ini salah, kadaluarsa, atau sudah di-regenerate ulang setelah dipasang di Vercel. Ambil key TERBARU dari Pi Developer Portal, pasang di Vercel, redeploy, JANGAN generate ulang lagi setelahnya.';
  } else if (piResult.fetchError) {
    diagnosis = '⚠️ Gagal konek ke Pi Platform API dari server — cek fetchError di bawah.';
  }

  return res.status(200).json({
    diagnosis,
    keyInfo: info,
    testPaymentId: fakePaymentId,
    piResult
  });
}
