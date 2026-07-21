// /api/players/ensure.js
// Pastikan dokumen player ada di Firestore (untuk data non-uang: level,
// XP, streak, avatar, dll). Dipanggil saat login.
//
// PERBAIKAN PENTING: field sgtBalance di dokumen lokal 'players' ini
// SUDAH TIDAK PERNAH di-update lagi sejak saldo SGT dipindah ke ledger
// terpusat (backend Mart, sgt_wallets/{username}) — kalau endpoint ini
// tetap mengembalikan sgtBalance dari sini, hasilnya selalu basi/salah
// (biasanya nyangkut di 50, nilai default lama), padahal saldo yang
// sungguhan (termasuk hasil top-up, menang game, dst) sudah bertambah
// di ledger pusat. Sekarang sgtBalance SELALU diambil dari sana.
import { admin, getFirebaseApp, verifyAuth } from '../../firebase-init.js';
import { sgtBalanceByUsername } from '../_sgtClient.js';
try {
  getFirebaseApp();
} catch (e) {
  console.error('[init] Firebase gagal diinisialisasi:', e.message);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { uid, pi_uid, username } = req.body;
  if (!uid) return res.status(400).json({ error: 'uid diperlukan' });

  const decoded = await verifyAuth(req);
  if (decoded && decoded.uid !== uid) {
    return res.status(403).json({ error: 'uid tidak cocok dengan token login' });
  }

  try {
    const db = admin.firestore();
    const playerRef = db.collection('players').doc(uid);
    const snap = await playerRef.get();

    // Saldo SGT SELALU dari ledger pusat — bukan dari dokumen lokal ini.
    let sgtBalance = 0;
    if (username) {
      try {
        const central = await sgtBalanceByUsername(username);
        sgtBalance = central?.sgtBalance ?? 0;
      } catch (e) {
        console.error('[players/ensure] Gagal ambil saldo pusat:', e.message);
      }
    }

    if (!snap.exists) {
      const avatars = ['🦁','🐉','🦊','🐺','🦅','🐯','🦄','🐻','🦋','🌟'];
      const data = {
        uid,
        piUid: pi_uid || uid,
        username: username || 'pioneer',
        avatar: avatars[Math.floor(Math.random() * avatars.length)],
        // sgtBalance TIDAK disimpan lagi di sini — sumber kebenarannya
        // cuma ledger pusat, biar tidak ada 2 sumber yang bisa beda lagi.
        playerLevel: 1,
        playerXP: 0,
        loginStreak: 1,
        lastLogin: '',
        welcomeBonusSent: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };
      await playerRef.set(data);
      return res.status(200).json({
        success: true, created: true,
        sgtBalance, playerLevel: 1, playerXP: 0, loginStreak: 1
      });
    }

    // Sudah ada — update username/pi_uid kalau berubah, lalu kembalikan data terkini
    const existing = snap.data();
    const updates = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
    if (username && username !== existing.username) updates.username = username;
    if (pi_uid && pi_uid !== existing.piUid) updates.piUid = pi_uid;
    await playerRef.update(updates);

    return res.status(200).json({
      success: true, created: false,
      sgtBalance,
      playerLevel: existing.playerLevel ?? 1,
      playerXP: existing.playerXP ?? 0,
      loginStreak: existing.loginStreak ?? 1
    });

  } catch (err) {
    console.error('[players/ensure] ERROR:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
