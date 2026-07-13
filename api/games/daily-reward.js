// /api/games/daily-reward.js
// Klaim hadiah harian + hitung streak. Endpoint ini sebelumnya HILANG dari
// backend padahal dipanggil oleh claimDaily() di frontend — akibatnya klaim
// harian cuma nyimpen ke localStorage device, tidak pernah sinkron ke cloud,
// dan menyebabkan alert "Gagal memproses" saat diklik.
import { admin, getFirebaseApp, verifyAuth } from '../../firebase-init.js';
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

  const decoded = await verifyAuth(req);
  if (decoded && decoded.uid !== uid) {
    return res.status(403).json({ error: 'uid tidak cocok dengan token login' });
  }

  const db = admin.firestore();
  const playerRef = db.collection('players').doc(uid);

  try {
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(playerRef);
      const existing = snap.exists ? snap.data() : {};

      const prevLastLogin = existing.lastLogin || '';
      const prevStreak    = existing.loginStreak || 0;
      const prevBalance   = parseFloat(existing.sgtBalance) || 0;

      // Sudah klaim hari ini (dicek dari data server, bukan dari client)
      if (prevLastLogin === today) {
        const e = new Error('Sudah klaim hari ini');
        e.code = 'ALREADY_CLAIMED';
        throw e;
      }

      // Hitung streak dari data server (anti-cheat: tidak percaya login_streak dari client)
      let newStreak;
      if (!prevLastLogin) {
        newStreak = 1;
      } else {
        const diffDays = Math.floor(
          (new Date(today) - new Date(prevLastLogin)) / 86400000
        );
        newStreak = (diffDays === 1) ? Math.min(prevStreak + 1, 30) : 1;
      }

      const { reward, isWeekly } = computeReward(newStreak);
      const newBalance = prevBalance + reward;

      const updates = {
        sgtBalance: newBalance,
        loginStreak: newStreak,
        lastLogin: today,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };
      if (username) updates.username = username;
      if (pi_uid) updates.piUid = pi_uid;

      tx.set(playerRef, updates, { merge: true });

      return { reward, newStreak, newBalance, isWeekly };
    });

    return res.status(200).json({
      success: true,
      reward: result.reward,
      loginStreak: result.newStreak,
      newBalance: result.newBalance,
      isWeekly: result.isWeekly
    });

  } catch (err) {
    if (err.code === 'ALREADY_CLAIMED') {
      return res.status(409).json({ error: 'Sudah klaim hari ini' });
    }
    console.error('[games/daily-reward] ERROR:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
