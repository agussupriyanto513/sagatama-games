// /api/players/ensure.js
// Pastikan dokumen player ada di Firestore. Dipanggil saat login.
// Endpoint ini sebelumnya HILANG dari backend padahal dipanggil oleh frontend,
// sehingga data player tidak pernah tersinkron ke server dengan andal.
import { admin, getFirebaseApp, verifyAuth } from '../../firebase-init.js';
getFirebaseApp();

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { uid, pi_uid, username } = req.body;
  if (!uid) return res.status(400).json({ error: 'uid diperlukan' });

  // Kalau ada token yang valid, harus cocok dengan uid yang diminta.
  // (Kalau tidak ada token/mode tamu lokal, tetap diizinkan agar guest mode jalan.)
  const decoded = await verifyAuth(req);
  if (decoded && decoded.uid !== uid) {
    return res.status(403).json({ error: 'uid tidak cocok dengan token login' });
  }

  try {
    const db = admin.firestore();
    const playerRef = db.collection('players').doc(uid);
    const snap = await playerRef.get();

    if (!snap.exists) {
      const avatars = ['🦁','🐉','🦊','🐺','🦅','🐯','🦄','🐻','🦋','🌟'];
      const data = {
        uid,
        piUid: pi_uid || uid,
        username: username || 'pioneer',
        avatar: avatars[Math.floor(Math.random() * avatars.length)],
        sgtBalance: 50,
        playerLevel: 1,
        playerXP: 0,
        loginStreak: 1,
        lastLogin: '',
        welcomeBonusSent: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };
      await playerRef.set(data);
      return res.status(200).json({
        success: true, created: true,
        sgtBalance: 50, playerLevel: 1, playerXP: 0, loginStreak: 1
      });
    }

    // Sudah ada — update username/pi_uid kalau berubah, lalu kembalikan data terkini
    const existing = snap.data();
    const updates = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
    if (username && username !== existing.username) updates.username = username;
    if (pi_uid && pi_uid !== existing.piUid) updates.piUid = pi_uid;
    await playerRef.update(updates);

    return res.status(200).json({
      success: true, created: false,
      sgtBalance: existing.sgtBalance ?? 50,
      playerLevel: existing.playerLevel ?? 1,
      playerXP: existing.playerXP ?? 0,
      loginStreak: existing.loginStreak ?? 1
    });

  } catch (err) {
    console.error('[players/ensure] ERROR:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
