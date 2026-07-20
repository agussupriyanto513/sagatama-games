// /api/pi-auth.js
// Verifikasi Pi Network accessToken → buat Firebase Custom Token lokal
// (tetap dipakai untuk data spesifik game: level, XP, avatar, dll)
// + pastikan wallet SGT terpusat ada di backend Mart.
import { admin, getFirebaseApp } from "../firebase-init.js";
import { sgtEnsureByAccessToken } from "./_sgtClient.js";

try {
  getFirebaseApp();
} catch (e) {
  console.error('[init] Firebase gagal diinisialisasi:', e.message);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { accessToken } = req.body;

  if (!accessToken) {
    return res.status(400).json({ error: 'accessToken diperlukan' });
  }

  try {
    // 1. Verifikasi accessToken ke Pi Platform API
    const piRes = await fetch('https://api.minepi.com/v2/me', {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (!piRes.ok) {
      const err = await piRes.text();
      console.error('[pi-auth] Pi API error:', err);
      return res.status(401).json({ error: 'Token Pi tidak valid' });
    }

    const piUser = await piRes.json();
    const piUid     = piUser.uid;       // app-local, dipakai sebagai Firebase UID lokal Games
    const piUsername = piUser.username; // konsisten lintas app, dipakai sebagai kunci SGT terpusat

    // 2. Buat Firebase Custom Token dengan piUid sebagai UID lokal
    const firebaseToken = await admin.auth().createCustomToken(piUid, {
      piUid,
      username: piUsername
    });

    // 3. Pastikan dokumen player LOKAL ada (untuk data spesifik game saja —
    //    field sgtBalance TIDAK dipakai lagi mulai dari sini, sengaja tidak
    //    di-set supaya tidak ada yang salah baca dari sini)
    const db = admin.firestore();
    const playerRef = db.collection('players').doc(piUid);
    const snap = await playerRef.get();

    if (!snap.exists) {
      const avatars = ['🦁','🐉','🦊','🐺','🦅','🐯','🦄','🐻','🦋','🌟'];
      await playerRef.set({
        uid:        piUid,
        piUid:      piUid,
        username:   piUsername,
        avatar:     avatars[Math.floor(Math.random() * avatars.length)],
        playerLevel: 1,
        playerXP:   0,
        loginStreak: 1,
        lastLogin:  '',
        createdAt:  admin.firestore.FieldValue.serverTimestamp(),
        updatedAt:  admin.firestore.FieldValue.serverTimestamp()
      });
    } else {
      await playerRef.update({
        username:  piUsername,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    // 4. Pastikan wallet SGT terpusat ada & ambil saldo terkini dari sana
    //    (bukan dari Firestore lokal Games lagi)
    let sgtBalance = 0;
    try {
      const central = await sgtEnsureByAccessToken(accessToken);
      sgtBalance = central?.sgtBalance ?? 0;
    } catch (e) {
      // Kalau central API sedang down, jangan gagalkan login — cuma saldo
      // yang belum bisa ditampilkan, frontend bisa retry ambil balance nanti.
      console.error('[pi-auth] Gagal ensure wallet SGT terpusat:', e.message);
    }

    return res.status(200).json({
      success:       true,
      firebaseToken,
      uid:           piUid,
      username:      piUsername,
      sgtBalance
    });

  } catch (err) {
    console.error('[pi-auth] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
