// /api/games/win.js
// Simpan hasil satu ronde game (menang/kalah/seri) + update saldo SGT di
// server. Endpoint ini sebelumnya HILANG dari backend padahal dipanggil oleh
// showResult() di frontend setiap game selesai.
//
// Catatan alur saldo: taruhan (bet) sudah dikurangi duluan di sisi client
// SEBELUM game dimulai (lihat currentBet di SAGATAMA-GAMES.html), tapi itu
// TIDAK dikirim ke server saat itu juga. Jadi saldo di server masih "bersih"
// (belum dipotong bet) sampai endpoint ini dipanggil. Makanya di sini kita
// hitung: newBalance = saldoServer - bet_amount + earn_amount, supaya server
// jadi sumber kebenaran yang benar, lalu client menimpa saldo lokalnya
// dengan nilai dari server.
import { admin, getFirebaseApp, verifyAuth } from '../../firebase-init.js';
getFirebaseApp();

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    game_session_id, uid, pi_uid, username,
    game, game_mode, outcome,
    bet_amount, earn_amount, score, bonus_2x,
    player_level, player_xp, login_streak, last_login
  } = req.body;

  if (!uid) return res.status(400).json({ error: 'uid diperlukan' });
  if (!game_session_id) return res.status(400).json({ error: 'game_session_id diperlukan' });

  const bet  = parseFloat(bet_amount)  || 0;
  const earn = parseFloat(earn_amount) || 0;
  if (bet < 0 || earn < 0) return res.status(400).json({ error: 'bet_amount/earn_amount tidak valid' });

  const decoded = await verifyAuth(req);
  if (decoded && decoded.uid !== uid) {
    return res.status(403).json({ error: 'uid tidak cocok dengan token login' });
  }

  const db = admin.firestore();
  const playerRef = db.collection('players').doc(uid);
  const sessionRef = db.collection('gameResults').doc(game_session_id);

  try {
    const newBalance = await db.runTransaction(async (tx) => {
      // Idempotensi: kalau session ini sudah pernah diproses (mis. retry
      // jaringan), jangan potong/tambah saldo dua kali.
      const sessionSnap = await tx.get(sessionRef);
      if (sessionSnap.exists) {
        const playerSnap = await tx.get(playerRef);
        return parseFloat((playerSnap.data() || {}).sgtBalance) || 0;
      }

      const playerSnap = await tx.get(playerRef);
      const existing = playerSnap.exists ? playerSnap.data() : {};
      const prevBalance = parseFloat(existing.sgtBalance) || 0;

      const balance = Math.max(0, prevBalance - bet + earn);

      const playerUpdates = {
        sgtBalance: balance,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };
      if (username) playerUpdates.username = username;
      if (pi_uid) playerUpdates.piUid = pi_uid;
      if (player_level) playerUpdates.playerLevel = player_level;
      if (player_xp !== undefined) playerUpdates.playerXP = player_xp;
      if (login_streak) playerUpdates.loginStreak = login_streak;
      if (last_login) playerUpdates.lastLogin = last_login;
      tx.set(playerRef, playerUpdates, { merge: true });

      tx.set(sessionRef, {
        uid, piUid: pi_uid || uid, username: username || 'pioneer',
        game: game || 'unknown', gameMode: game_mode || null,
        outcome: outcome || null, betAmount: bet, earnAmount: earn,
        score: parseFloat(score) || 0, bonus2x: !!bonus_2x,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // Leaderboard "all" berbasis saldo SGT total (konsisten dgn save-progress.js)
      const lbAllRef = db.collection('leaderboard').doc(`${uid}_all`);
      tx.set(lbAllRef, {
        uid, username: username || 'pioneer', game: 'all',
        sgt: balance, updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      return balance;
    });

    return res.status(200).json({ success: true, newBalance });

  } catch (err) {
    console.error('[games/win] ERROR:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
