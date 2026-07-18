// /api/games/daily-reward.js
// Klaim hadiah harian + hitung streak.
//
// PERUBAHAN PENTING (migrasi ke SGT terpusat):
// Saldo SGT sekarang ditambah lewat central ledger (backend Mart), bukan
// field sgtBalance lokal lagi. Pengecekan "sudah klaim hari ini / berapa
// streak-nya" TETAP dilakukan di Firestore lokal Games (itu bukan uang,
// aman disimpan lokal) — baru setelah lolos cek itu, SGT-nya dikreditkan
// ke ledger terpusat.
import { admin, getFirebaseApp, verifyAuth } from '../../firebase-init.js';
import { sgtCredit } from '../_sgtClient.js';
getFirebaseApp();

function computeReward(streak) {
  let reward = 10 + (5 * streak);
  const isWeekly = (streak % 7 === 0);
  if (isWeekly) reward *= 2;
  return { reward, isWeekly };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { uid, pi_uid, username, today } = req.body;
  if (!uid) return res.status(400).json({ error: 'uid diperlukan' });
  if (!today) return res.status(400).json({ error: 'today diperlukan' });
  if (!username) return res.status(400).json({ error: 'username diperlukan (untuk saldo SGT terpusat)' });

  const decoded = await verifyAuth(req);
  if (decoded && decoded.uid !== uid) {
    return res.status(403).json({ error: 'uid tidak cocok dengan token login' });
  }

  const db = admin.firestore();
  const playerRef = db.collection('players').doc(uid);

  try {
    // 1. Cek & catat klaim hari ini secara atomik (LOKAL, bukan soal saldo)
    const streakInfo = await db.runTransaction(async (tx) => {
      const snap = await tx.get(playerRef);
      const existing = snap.exists ? snap.data() : {};

      const prevLastLogin = existing.lastLogin || '';
      const prevStreak    = existing.loginStreak || 0;

      if (prevLastLogin === today) {
        const e = new Error('Sudah klaim hari ini');
        e.code = 'ALREADY_CLAIMED';
        throw e;
      }

      let newStreak;
      if (!prevLastLogin) {
        newStreak = 1;
      } else {
        const diffDays = Math.floor(
          (new Date(today) - new Date(prevLastLogin)) / 86400000
        );
        newStreak = (diffDays === 1) ? Math.min(prevStreak + 1, 30) : 1;
      }

      const updates = {
        loginStreak: newStreak,
        lastLogin: today,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };
      if (username) updates.username = username;
      if (pi_uid) updates.piUid = pi_uid;
      tx.set(playerRef, updates, { merge: true });

      return { newStreak };
    });

    // 2. Baru sekarang kreditkan SGT ke ledger terpusat.
    //    txId pakai uid+today supaya kalaupun endpoint ini kepanggil ulang
    //    (retry jaringan), tidak dobel kredit.
    const { reward, isWeekly } = computeReward(streakInfo.newStreak);
    const result = await sgtCredit({
      username, amount: reward,
      txId: `games_daily_${uid}_${today}`,
      source: 'games_daily_reward',
      meta: { uid, streak: streakInfo.newStreak, isWeekly }
    });

    return res.status(200).json({
      success: true,
      reward,
      loginStreak: streakInfo.newStreak,
      newBalance: result?.sgtBalance ?? null,
      isWeekly
    });

  } catch (err) {
    if (err.code === 'ALREADY_CLAIMED') {
      return res.status(409).json({ error: 'Sudah klaim hari ini' });
    }
    console.error('[games/daily-reward] ERROR:', err.message, err.detail || '');
    return res.status(500).json({ error: err.message });
  }
}
