// /api/games/win.js
// Simpan hasil satu ronde game (menang/kalah/seri) + update saldo SGT.
//
// PERUBAHAN PENTING (migrasi ke SGT terpusat):
// Saldo sgtBalance TIDAK LAGI disimpan/diubah di Firestore lokal Games.
// Sekarang diambil/diubah lewat central API di backend Mart
// (lihat api/_sgtClient.js), dikunci ke `username` Pi — supaya saldo
// yang sama dipakai bareng oleh Mart, Games, dan Hidayatulamin.
//
// Data spesifik game (level, XP, streak, hasil ronde, leaderboard) TETAP
// disimpan di Firestore lokal Games seperti biasa — yang dipindah HANYA
// bagian saldo SGT.
import { admin, getFirebaseApp, verifyAuth } from '../../firebase-init.js';
import { sgtCredit, sgtDebit } from '../_sgtClient.js';
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
  if (!username) return res.status(400).json({ error: 'username diperlukan (untuk saldo SGT terpusat)' });

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
    // Idempotensi: kalau session ini sudah pernah diproses (retry jaringan),
    // jangan panggil credit/debit dua kali.
    const sessionSnap = await sessionRef.get();
    if (sessionSnap.exists) {
      const cachedBalance = sessionSnap.data().balanceAfter;
      return res.status(200).json({ success: true, newBalance: cachedBalance ?? null, alreadyProcessed: true });
    }

    // 1. Potong taruhan dulu (kalau ada) di ledger terpusat
    let balanceAfterBet = null;
    if (bet > 0) {
      const debitResult = await sgtDebit({
        username, amount: bet,
        txId: `games_bet_${game_session_id}`,
        source: 'games_bet',
        meta: { game, game_mode, uid }
      });
      balanceAfterBet = debitResult?.sgtBalance ?? null;
    }

    // 2. Tambah kemenangan (kalau ada) di ledger terpusat
    let finalBalance = balanceAfterBet;
    if (earn > 0) {
      const creditResult = await sgtCredit({
        username, amount: earn,
        txId: `games_win_${game_session_id}`,
        source: 'games_win',
        meta: { game, game_mode, uid, outcome }
      });
      finalBalance = creditResult?.sgtBalance ?? finalBalance;
    }

    // Kalau bet=0 dan earn=0 (mis. seri tanpa taruhan), ambil saldo apa adanya
    // supaya response tetap konsisten — panggil credit(0) tidak dilakukan,
    // jadi fallback ke null (frontend biarkan pakai saldo lokal yang sudah ada).

    // 3. Simpan data game (level, XP, dsb) — TIDAK termasuk sgtBalance lagi
    const playerUpdates = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
    if (username) playerUpdates.username = username;
    if (pi_uid) playerUpdates.piUid = pi_uid;
    if (player_level) playerUpdates.playerLevel = player_level;
    if (player_xp !== undefined) playerUpdates.playerXP = player_xp;
    if (login_streak) playerUpdates.loginStreak = login_streak;
    if (last_login) playerUpdates.lastLogin = last_login;
    await playerRef.set(playerUpdates, { merge: true });

    await sessionRef.set({
      uid, piUid: pi_uid || uid, username: username || 'pioneer',
      game: game || 'unknown', gameMode: game_mode || null,
      outcome: outcome || null, betAmount: bet, earnAmount: earn,
      score: parseFloat(score) || 0, bonus2x: !!bonus_2x,
      balanceAfter: finalBalance,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Leaderboard "all" berbasis saldo SGT total dari ledger terpusat
    if (finalBalance !== null) {
      await db.collection('leaderboard').doc(`${uid}_all`).set({
        uid, username: username || 'pioneer', game: 'all',
        sgt: finalBalance, updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }

    return res.status(200).json({ success: true, newBalance: finalBalance });

  } catch (err) {
    console.error('[games/win] ERROR:', err.message, err.detail || '');
    if (err.message === 'Saldo SGT tidak cukup') {
      return res.status(400).json({ error: 'Saldo SGT tidak cukup', success: false });
    }
    return res.status(500).json({ error: err.message });
  }
}
