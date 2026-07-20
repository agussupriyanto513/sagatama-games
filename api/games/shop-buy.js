// /api/games/shop-buy.js
// Potong saldo SGT secara aman saat user beli item di Upgrade Shop.
//
// PERUBAHAN PENTING (migrasi ke SGT terpusat): pemotongan saldo sekarang
// lewat central API di backend Mart (api/_sgtClient.js), dikunci ke
// `username` Pi, bukan field sgtBalance lokal lagi.
import { admin, getFirebaseApp, verifyAuth } from '../../firebase-init.js';
import { sgtDebit } from '../_sgtClient.js';
try {
  getFirebaseApp();
} catch (e) {
  console.error('[init] Firebase gagal diinisialisasi:', e.message);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { uid, pi_uid, username, item_tab, item_id, item_price, player_level, player_xp } = req.body;
  if (!uid) return res.status(400).json({ error: 'uid diperlukan' });
  if (!item_id) return res.status(400).json({ error: 'item_id diperlukan' });
  if (!username) return res.status(400).json({ error: 'username diperlukan (untuk saldo SGT terpusat)' });

  const price = parseFloat(item_price);
  if (isNaN(price) || price <= 0) return res.status(400).json({ error: 'item_price tidak valid' });

  const decoded = await verifyAuth(req);
  if (decoded && decoded.uid !== uid) {
    return res.status(403).json({ error: 'uid tidak cocok dengan token login' });
  }

  const db = admin.firestore();
  const playerRef = db.collection('players').doc(uid);

  try {
    // txId dari uid+item+harga+menit supaya double-klik cepat tidak dobel
    // potong, tapi tetap unik untuk pembelian ulang item yang sama di lain waktu.
    const txId = `games_shop_${uid}_${item_id}_${Date.now()}`;

    const debitResult = await sgtDebit({
      username, amount: price, txId,
      source: 'games_shop_buy',
      meta: { uid, item_tab, item_id }
    });

    const newBalance = debitResult?.sgtBalance ?? null;

    const updates = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
    if (username) updates.username = username;
    if (pi_uid) updates.piUid = pi_uid;
    if (player_level) updates.playerLevel = player_level;
    if (player_xp !== undefined) updates.playerXP = player_xp;
    await playerRef.set(updates, { merge: true });

    await db.collection('purchases').add({
      uid, piUid: pi_uid || uid, username: username || 'pioneer',
      itemTab: item_tab || null, itemId: item_id, price,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return res.status(200).json({ success: true, newBalance });

  } catch (err) {
    if (err.message === 'Saldo SGT tidak cukup') {
      return res.status(400).json({ error: 'Saldo SGT tidak cukup', success: false });
    }
    console.error('[games/shop-buy] ERROR:', err.message, err.detail || '');
    return res.status(500).json({ error: err.message });
  }
}
