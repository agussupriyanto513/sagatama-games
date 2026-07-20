// /api/debug-last-approve.js
// ══════════════════════════════════════════════════════════════════
// ENDPOINT DEBUG SEMENTARA — buka dari browser mana saja (GET), KAPAN
// SAJA setelah percobaan top-up (tidak perlu buru-buru / tidak perlu
// screenshot layar Pi Wallet yang nutupin halaman kita).
//
// Cara pakai:
//   1. Coba top-up di Pi Browser sampai gagal ("Pembayaran Kedaluwarsa").
//   2. Buka browser lain (boleh laptop/HP, tidak perlu Pi Browser):
//        https://sagatama-games.vercel.app/api/debug-last-approve
//   3. Kirim hasil JSON yang muncul.
//
// PENTING: hapus file ini + baris route-nya di vercel.json, dan hapus
// blok debugLog di api/payments/index.js, setelah masalah selesai.
// ══════════════════════════════════════════════════════════════════
import { admin, getFirebaseApp } from '../firebase-init.js';

try {
  getFirebaseApp();
} catch (e) {
  console.error('[init] Firebase gagal diinisialisasi:', e.message);
}

export default async function handler(req, res) {
  try {
    const snap = await admin.firestore().collection('_debug').doc('latest_approve').get();
    if (!snap.exists) {
      return res.status(200).json({ message: 'Belum ada percobaan approve yang tercatat sama sekali.' });
    }
    const data = snap.data();
    // Konversi Firestore Timestamp ke string biar gampang dibaca
    if (data.updatedAt?.toDate) data.updatedAt = data.updatedAt.toDate().toISOString();
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
