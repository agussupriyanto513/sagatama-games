// /api/payments/payout.js
// App-to-User: kirim Pi testnet ke wallet user sebagai reward
import { admin, getFirebaseApp } from '../../firebase-init.js';
getFirebaseApp();

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { uid, piUid, piAmount, reason } = req.body;
  // uid       = Firestore user ID (untuk update saldo)
  // piUid     = Pi Network UID user penerima (dari Pi.authenticate())
  // piAmount  = jumlah Pi yang dikirim, contoh: 0.01
  // reason    = keterangan, contoh: "game_win", "daily_reward"

  if (!uid || !piUid || !piAmount) {
    return res.status(400).json({ error: 'uid, piUid, dan piAmount diperlukan' });
  }
  if (piAmount <= 0 || piAmount > 10) {
    return res.status(400).json({ error: 'piAmount harus antara 0.001 dan 10' });
  }

  const db = admin.firestore();

  try {
    // 1. Cek apakah user ada di Firestore
    const playerRef = db.collection('players').doc(uid);
    const playerSnap = await playerRef.get();
    if (!playerSnap.exists) {
      return res.status(404).json({ error: `Player ${uid} tidak ditemukan` });
    }

    // 2. Buat A2U payment di Pi Platform
    const createResp = await fetch('https://api.minepi.com/v2/payments', {
      method: 'POST',
      headers: {
        'Authorization': `Key ${process.env.PI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        payment: {
          amount: piAmount,
          memo: `Sagatama Games: ${reason || 'reward'}`,
          metadata: { uid, reason: reason || 'reward' },
          uid: piUid,
          payment_type: 'app_to_user'
        }
      })
    });

    const createData = await createResp.json();
    if (!createResp.ok) {
      console.error(`[payout] Gagal buat payment (HTTP ${createResp.status}):`, JSON.stringify(createData));
      console.error(`[payout] piUid=${piUid} piAmount=${piAmount} reason=${reason}`);
      return res.status(400).json({ error: 'Gagal membuat payment', detail: createData });
    }

    const paymentId = createData.identifier;
    console.log(`[payout] Payment dibuat: ${paymentId}`);

    // 3. Simpan ke Firestore dulu (status: pending)
    await db.collection('payouts').doc(paymentId).set({
      paymentId, uid, piUid, piAmount,
      reason: reason || 'reward',
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // 4. Approve payment dari server
    const approveResp = await fetch(
      `https://api.minepi.com/v2/payments/${paymentId}/approve`,
      {
        method: 'POST',
        headers: { 'Authorization': `Key ${process.env.PI_API_KEY}` }
      }
    );
    if (!approveResp.ok) {
      const errData = await approveResp.json();
      console.error(`[payout] Approve gagal (HTTP ${approveResp.status}):`, JSON.stringify(errData));
      console.error(`[payout] paymentId=${paymentId} piUid=${piUid} piAmount=${piAmount}`);
      await updatePayoutStatus(db, paymentId, 'approve_failed', null);
      return res.status(400).json({ error: 'Approve gagal', detail: errData });
    }
    console.log(`[payout] Approved: ${paymentId}`);

    // 5. Submit ke blockchain menggunakan wallet seed app
    const submitResp = await fetch(
      `https://api.minepi.com/v2/payments/${paymentId}/submit_payment`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Key ${process.env.PI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          wallet_private_seed: process.env.PI_WALLET_PRIVATE_SEED
        })
      }
    );

    const submitData = await submitResp.json();
    if (!submitResp.ok) {
      console.error('[payout] Submit gagal:', submitData);
      await updatePayoutStatus(db, paymentId, 'submit_failed', null);
      return res.status(400).json({ error: 'Submit ke blockchain gagal', detail: submitData });
    }

    const txid = submitData.txid;
    console.log(`[payout] Submitted ke blockchain, txid: ${txid}`);

    // 6. Complete payment
    const completeResp = await fetch(
      `https://api.minepi.com/v2/payments/${paymentId}/complete`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Key ${process.env.PI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ txid })
      }
    );

    if (!completeResp.ok) {
      const errData = await completeResp.json();
      await updatePayoutStatus(db, paymentId, 'complete_failed', txid);
      return res.status(400).json({ error: 'Complete gagal', detail: errData });
    }

    // 7. Update status payout ke completed di Firestore
    await updatePayoutStatus(db, paymentId, 'completed', txid);

    console.log(`[payout] Selesai: ${piAmount} Pi → uid=${uid}, txid=${txid}`);
    return res.status(200).json({
      success: true,
      paymentId,
      txid,
      piAmount
    });

  } catch (err) {
    console.error('[payout] ERROR:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

async function updatePayoutStatus(db, paymentId, status, txid) {
  const data = {
    status,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };
  if (txid) data.txid = txid;
  if (status === 'completed') data.completedAt = admin.firestore.FieldValue.serverTimestamp();

  try {
    await db.collection('payouts').doc(paymentId).set(data, { merge: true });
    console.log(`[payout] Firestore updated: ${paymentId} → ${status}`);
  } catch (e) {
    console.error(`[payout] Firestore update error:`, e.message);
  }
}
