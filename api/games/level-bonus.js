// /api/games/level-bonus.js
// Klaim bonus SGT saat naik level.
//
// PERUBAHAN PENTING: saldo SGT dikreditkan lewat central ledger, bukan
// field sgtBalance lokal. Pengecekan anti-cheat "level ini sudah diklaim"
// tetap di Firestore lokal (bukan soal saldo, aman disimpan lokal).
import { admin, getFirebaseApp, verifyAuth } from '../../firebase-init.js';
import { sgtCredit } from '../_sgtClient.js';
getFirebaseApp();

const MAX_BONUS = 100000; // batas wajar, jaga-jaga dari nilai aneh dari client

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { uid, pi_uid, username, player_level, bonus_amount } = req.body;
  if (!uid) return res.status(400).json({ error: 'uid diperlukan' });
  if (!username) return res.status(400).json({ error: 'username diperlukan (untuk saldo SGT terpusat)' });

  const level = parseInt(player_level);
  const bonus = parseFloat(bonus_amount);
  if (isNaN(level) || level < 1) return res.status(400).json({ error: 'player_level tidak valid' });
  if (isNaN(bonus) || bonus <= 0 || bonus > MAX_BONUS) {
    return res.status(400).json({ error: 'bonus_amount tidak valid' });
  }

  const decoded = await verifyAuth(req);
  if (decoded && decoded.uid !== uid) {
    return res.status(403).json({ error: 'uid tidak cocok dengan token login' });
  }

  const db = admin.firestore();
  const playerRef = db.collection('players').doc(uid);

  try {
    // 1. Cek & catat "level ini sudah diklaim" secara atomik (LOKAL)
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(playerRef);
      const existing = snap.exists ? snap.data() : {};
      const lastBonusLevel = existing.lastBonusLevel || 0;

      if (level <= lastBonusLevel) {
        const e = new Error('Bonus level ini sudah pernah diklaim');
        e.code = 'ALREADY_CLAIMED';
        throw e;
      }

      const updates = {
        lastBonusLevel: level,
        playerLevel: Math.max(level, existing.playerLevel || 1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };
      if (username) updates.username = username;
      if (pi_uid) updates.piUid = pi_uid;
      tx.set(playerRef, updates, { merge: true });
    });

    // 2. Kreditkan SGT ke ledger terpusat
    const result = await sgtCredit({
      username, amount: bonus,
      txId: `games_levelbonus_${uid}_${level}`,
      source: 'games_level_bonus',
      meta: { uid, level }
    });

    return res.status(200).json({ success: true, newBalance: result?.sgtBalance ?? null });

  } catch (err) {
    if (err.code === 'ALREADY_CLAIMED') {
      return res.status(409).json({ error: 'Bonus level ini sudah pernah diklaim' });
    }
    console.error('[games/level-bonus] ERROR:', err.message, err.detail || '');
    return res.status(500).json({ error: err.message });
  }
}
