// /api/games/save-progress.js
// Simpan progres pemain (level, XP, streak) + entri leaderboard.
//
// PERUBAHAN PENTING — INI PERBAIKAN KEAMANAN, BUKAN CUMA MIGRASI:
// Versi SEBELUMNYA menerima `sgt_balance` LANGSUNG DARI CLIENT dan
// menimpa field sgtBalance di database apa adanya (cuma dicek bukan
// angka negatif). Itu artinya siapa pun yang mengirim request langsung
// ke endpoint ini (tanpa lewat game sungguhan) BISA MENGATUR SALDO SGT-NYA
// SENDIRI JADI BERAPA PUN. Endpoint ini sekarang TIDAK PERNAH menerima
// atau menulis saldo dari client sama sekali — SGT hanya boleh berubah
// lewat win.js / shop-buy.js / daily-reward.js / level-bonus.js yang
// masing-masing menghitung sendiri jumlahnya di server (bukan dari
// input client) sebelum memanggil ledger terpusat.
//
// Endpoint ini sekarang HANYA menyimpan data non-uang (level, XP, streak,
// skor leaderboard) dan mengambil saldo SGT TERKINI dari ledger terpusat
// (read-only) untuk ditampilkan di leaderboard — bukan untuk mengubahnya.
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

  const {
    uid, pi_uid, username,
    player_level, player_xp, login_streak, last_login,
    game_key, score_val
    // CATATAN: sgt_balance SENGAJA tidak lagi dibaca dari body request —
    // walaupun frontend lama masih mengirimnya, field itu diabaikan total.
  } = req.body;

  if (!uid) return res.status(400).json({ error: 'uid diperlukan' });

  const decoded = await verifyAuth(req);
  if (decoded && decoded.uid !== uid) {
    return res.status(403).json({ error: 'uid tidak cocok dengan token login' });
  }

  try {
    const db = admin.firestore();
    const playerRef = db.collection('players').doc(uid);

    const updates = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
    if (username) updates.username = username;
    if (pi_uid) updates.piUid = pi_uid;
    if (player_level) updates.playerLevel = player_level;
    if (player_xp !== undefined) updates.playerXP = player_xp;
    if (login_streak) updates.loginStreak = login_streak;
    if (last_login) updates.lastLogin = last_login;
    await playerRef.set(updates, { merge: true });

    // Ambil saldo SGT SEBENARNYA dari ledger terpusat (read-only) untuk
    // ditampilkan di leaderboard — bukan dari input client.
    let currentBalance = null;
    if (username) {
      try {
        const bal = await sgtBalanceByUsername(username);
        currentBalance = bal?.sgtBalance ?? null;
      } catch (e) {
        console.error('[games/save-progress] Gagal ambil saldo terpusat:', e.message);
      }
    }

    if (game_key) {
      const lbRef = db.collection('leaderboard').doc(`${uid}_${game_key}`);
      const lbSnap = await lbRef.get();
      const prevScore = lbSnap.exists ? (parseFloat(lbSnap.data().score) || 0) : 0;
      const newScore = parseFloat(score_val) || 0;
      const lbUpdate = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
      if (currentBalance !== null) lbUpdate.sgt = currentBalance;

      if (!lbSnap.exists || newScore > prevScore) {
        await lbRef.set({
          uid, username: username || 'pioneer', game: game_key,
          score: newScore, ...lbUpdate
        }, { merge: true });
      } else {
        await lbRef.set(lbUpdate, { merge: true });
      }
    }

    if (currentBalance !== null) {
      const lbAllRef = db.collection('leaderboard').doc(`${uid}_all`);
      await lbAllRef.set({
        uid, username: username || 'pioneer', game: 'all',
        sgt: currentBalance,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }

    return res.status(200).json({ success: true, newBalance: currentBalance });

  } catch (err) {
    console.error('[games/save-progress] ERROR:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
