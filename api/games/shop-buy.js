// /api/games/shop-buy.js
// Potong saldo SGT secara aman di server saat user beli item di Upgrade Shop.
// Endpoint ini sebelumnya HILANG dari backend padahal dipanggil oleh
// buyItem() di frontend — akibatnya saldo hasil pembelian cuma berubah di
// localStorage device dan bisa dimanipulasi user (edit localStorage manual).
import { admin, getFirebaseApp, verifyAuth } from '../../firebase-init.js';
getFirebaseApp();

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { uid, pi_uid, username, item_tab, item_id, item_price, player_level, player_xp } = req.body;
  if (!uid) return res.status(400).json({ error: 'uid diperlukan' });
  if (!item_id) return res.status(400).json({ error: 'item_id diperlukan' });

  const price = parseFloat(item_price);
  if (isNaN(price) || price <= 0) return res.status(400).json({ error: 'item_price tidak valid' });

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
      const prevBalance = parseFloat(existing.sgtBalance) || 0;

      if (prevBalance < price) {
        const e = new Error('Saldo SGT tidak cukup');
        e.code = 'INSUFFICIENT_BALANCE';
        throw e;
      }

      const balance = prevBalance - price;
      const updates = {
        sgtBalance: balance,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };
      if (username) updates.username = username;
      if (pi_uid) updates.piUid = pi_uid;
      if (player_level) updates.playerLevel = player_level;
      if (player_xp !== undefined) updates.playerXP = player_xp;
      tx.set(playerRef, updates, { merge: true });

      const purchaseRef = db.collection('purchases').doc();
      tx.set(purchaseRef, {
        uid, piUid: pi_uid || uid, username: username || 'pioneer',
        itemTab: item_tab || null, itemId: item_id, price,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      return balance;
    });

    return res.status(200).json({ success: true, newBalance });

  } catch (err) {
    if (err.code === 'INSUFFICIENT_BALANCE') {
      return res.status(400).json({ error: 'Saldo SGT tidak cukup', success: false });
    }
    console.error('[games/shop-buy] ERROR:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
