// /api/games/level-bonus.js
// Klaim bonus SGT saat naik level. Endpoint ini sebelumnya HILANG dari
// backend padahal dipanggil oleh claimLevelBonus() di frontend.
import { admin, getFirebaseApp, verifyAuth } from '../../firebase-init.js';
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
    const newBalance = await db.runTransaction(async (tx) => {
      const snap = await tx.get(playerRef);
      const existing = snap.exists ? snap.data() : {};
      const prevBalance    = parseFloat(existing.sgtBalance) || 0;
      const lastBonusLevel = existing.lastBonusLevel || 0;

      // Anti-cheat: level bonus untuk level ini sudah pernah diklaim
      if (level <= lastBonusLevel) {
        const e = new Error('Bonus level ini sudah pernah diklaim');
        e.code = 'ALREADY_CLAIMED';
        throw e;
      }

      const balance = prevBalance + bonus;
      const updates = {
        sgtBalance: balance,
        lastBonusLevel: level,
        playerLevel: Math.max(level, existing.playerLevel || 1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };
      if (username) updates.username = username;
      if (pi_uid) updates.piUid = pi_uid;

      tx.set(playerRef, updates, { merge: true });
      return balance;
    });

    return res.status(200).json({ success: true, newBalance });

  } catch (err) {
    if (err.code === 'ALREADY_CLAIMED') {
      return res.status(409).json({ error: 'Bonus level ini sudah pernah diklaim' });
    }
    console.error('[games/level-bonus] ERROR:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
