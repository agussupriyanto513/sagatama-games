// /api/games/save-progress.js
// Simpan progres pemain (saldo SGT, level, XP, streak) + entri leaderboard.
// Endpoint ini sebelumnya HILANG dari backend padahal dipanggil oleh
// window.fbSaveSGT() di setiap kali game selesai — akibatnya saldo SGT
// tidak pernah benar-benar tersimpan di cloud (hanya di localStorage).
import { admin, getFirebaseApp, verifyAuth } from '../../firebase-init.js';
getFirebaseApp();

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    uid, pi_uid, username,
    sgt_balance, player_level, player_xp, login_streak, last_login,
    game_key, score_val
  } = req.body;

  if (!uid) return res.status(400).json({ error: 'uid diperlukan' });

  const decoded = await verifyAuth(req);
  if (decoded && decoded.uid !== uid) {
    return res.status(403).json({ error: 'uid tidak cocok dengan token login' });
  }

  // Sanitasi dasar — tolak nilai yang jelas tidak masuk akal / rusak
  const sgtBalance = parseFloat(sgt_balance);
  if (isNaN(sgtBalance) || sgtBalance < 0) {
    return res.status(400).json({ error: 'sgt_balance tidak valid' });
  }

  try {
    const db = admin.firestore();
    const playerRef = db.collection('players').doc(uid);

    const updates = {
      sgtBalance,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    if (username) updates.username = username;
    if (pi_uid) updates.piUid = pi_uid;
    if (player_level) updates.playerLevel = player_level;
    if (player_xp !== undefined) updates.playerXP = player_xp;
    if (login_streak) updates.loginStreak = login_streak;
    if (last_login) updates.lastLogin = last_login;

    await playerRef.set(updates, { merge: true });

    // Update leaderboard (khusus game tertentu + skor keseluruhan)
    if (game_key) {
      const lbRef = db.collection('leaderboard').doc(`${uid}_${game_key}`);
      const lbSnap = await lbRef.get();
      const prevScore = lbSnap.exists ? (parseFloat(lbSnap.data().score) || 0) : 0;
      const newScore = parseFloat(score_val) || 0;
      if (!lbSnap.exists || newScore > prevScore) {
        await lbRef.set({
          uid, username: username || 'pioneer', game: game_key,
          score: newScore, sgt: sgtBalance,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      } else {
        // Tetap update saldo SGT terbaru meski skor tidak dipecahkan
        await lbRef.set({ sgt: sgtBalance, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      }
    }

    // Entri leaderboard "all" berbasis saldo SGT total
    const lbAllRef = db.collection('leaderboard').doc(`${uid}_all`);
    await lbAllRef.set({
      uid, username: username || 'pioneer', game: 'all',
      sgt: sgtBalance,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    return res.status(200).json({ success: true, newBalance: sgtBalance });

  } catch (err) {
    console.error('[games/save-progress] ERROR:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
