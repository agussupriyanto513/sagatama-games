// /api/payments/pi-auth.js
// Verifikasi Pi Network accessToken → buat Firebase Custom Token
import { admin, getFirebaseApp } from "../firebase-init.js";

// PENTING: pakai helper bersama (getFirebaseApp) supaya project ID & kredensial
// SELALU sama persis dengan endpoint lain (api/players/ensure.js, dll).
// Sebelumnya file ini punya inisialisasi admin.initializeApp() sendiri yang
// TIDAK membersihkan tanda kutip liar pada env var (FIREBASE_PROJECT_ID /
// FIREBASE_CLIENT_EMAIL). Kalau env var di Vercel ke-paste dengan tanda kutip
// ikut terbawa, custom token yang dibuat di sini jadi ditandatangani untuk
// project ID yang berbeda dari project di frontend (SAGATAMA-GAMES.html),
// dan Firebase menolaknya di client dengan error
// "auth/custom-token-mismatch" — persis seperti yang dilaporkan.
getFirebaseApp();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { accessToken, uid: clientUid, username: clientUsername } = req.body;

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
    const piUid     = piUser.uid;
    const piUsername = piUser.username;

    // 2. Buat Firebase Custom Token dengan piUid sebagai UID
    //    Sehingga setiap user Pi selalu punya Firebase UID yang sama
    const firebaseToken = await admin.auth().createCustomToken(piUid, {
      piUid,
      username: piUsername
    });

    // 3. Pastikan dokumen player ada di Firestore
    const db = admin.firestore();
    const playerRef = db.collection('players').doc(piUid);
    const snap = await playerRef.get();

    if (!snap.exists) {
      // Buat dokumen baru untuk player pertama kali
      const avatars = ['🦁','🐉','🦊','🐺','🦅','🐯','🦄','🐻','🦋','🌟'];
      await playerRef.set({
        uid:        piUid,
        piUid:      piUid,
        username:   piUsername,
        avatar:     avatars[Math.floor(Math.random() * avatars.length)],
        sgtBalance: 50,      // SGT awal untuk player baru
        playerLevel: 1,
        playerXP:   0,
        loginStreak: 1,
        lastLogin:  '',
        createdAt:  admin.firestore.FieldValue.serverTimestamp(),
        updatedAt:  admin.firestore.FieldValue.serverTimestamp()
      });
    } else {
      // Update username jika berubah
      await playerRef.update({
        username:  piUsername,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    return res.status(200).json({
      success:       true,
      firebaseToken,
      uid:           piUid,
      username:      piUsername
    });

  } catch (err) {
    console.error('[pi-auth] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
