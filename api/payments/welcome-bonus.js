// /api/pi-payment/welcome-bonus.js
// A2U: Kirim Pi testnet sebagai welcome bonus untuk user baru
import { admin, getFirebaseApp } from '../../firebase-init.js';
getFirebaseApp();

const WELCOME_BONUS_PI = 0.001; // Jumlah Pi testnet yang dikirim
const WELCOME_BONUS_SGT = 50;   // Bonus SGT tambahan

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { uid, piUid } = req.body;

  if (!uid || !piUid) {
    return res.status(400).json({ error: 'uid dan piUid diperlukan' });
  }

  const db = admin.firestore();

  try {
    // 1. Cek player & pastikan belum pernah dapat welcome bonus
    const playerRef = db.collection('players').doc(uid);
    const playerSnap = await playerRef.get();

    if (!playerSnap.exists) {
      return res.status(404).json({ error: `Player ${uid} tidak ditemukan` });
    }

    const playerData = playerSnap.data();

    // Guard: jangan kirim bonus dua kali
    if (playerData.welcomeBonusSent === true) {
      return res.status(200).json({
        success: false,
        alreadySent: true,
        message: 'Welcome bonus sudah pernah dikirim'
      });
    }

    // 2. Tandai dulu di Firestore (optimistic lock) supaya tidak double-send
    await playerRef.update({
      welcomeBonusSent: true,
      welcomeBonusSentAt: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log(`[welcome-bonus] Mulai kirim ke uid=${uid}, piUid=${piUid}`);

    // 3. Buat A2U payment di Pi Platform
    const createResp = await fetch('https://api.minepi.com/v2/payments', {
      method: 'POST',
      headers: {
        'Authorization': `Key ${process.env.PI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        payment: {
          amount: WELCOME_BONUS_PI,
          memo: 'Sagatama Games: Selamat datang Pioneer!',
          metadata: { uid, reason: 'welcome_bonus' },
          uid: piUid,
          payment_type: 'app_to_user'
        }
      })
    });

    const createData = await createResp.json();
    if (!createResp.ok) {
      // Rollback flag jika Pi API gagal
      await playerRef.update({ welcomeBonusSent: false });
      console.error('[welcome-bonus] Gagal buat payment:', createData);
      return res.status(400).json({ error: 'Gagal membuat payment', detail: createData });
    }

    const paymentId = createData.identifier;
    console.log(`[welcome-bonus] Payment dibuat: ${paymentId}`);

    // 4. Simpan ke koleksi payouts (status: pending)
    await db.collection('payouts').doc(paymentId).set({
      paymentId,
      uid,
      piUid,
      piAmount: WELCOME_BONUS_PI,
      reason: 'welcome_bonus',
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // 5. Approve
    const approveResp = await fetch(
      `https://api.minepi.com/v2/payments/${paymentId}/approve`,
      {
        method: 'POST',
        headers: { 'Authorization': `Key ${process.env.PI_API_KEY}` }
      }
    );
    if (!approveResp.ok) {
      const errData = await approveResp.json();
      await updateStatus(db, paymentId, 'approve_failed', null);
      return res.status(400).json({ error: 'Approve gagal', detail: errData });
    }
    console.log(`[welcome-bonus] Approved: ${paymentId}`);

    // 6. Submit ke blockchain
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
      console.error('[welcome-bonus] Submit gagal:', submitData);
      await updateStatus(db, paymentId, 'submit_failed', null);
      return res.status(400).json({ error: 'Submit ke blockchain gagal', detail: submitData });
    }

    const txid = submitData.txid;
    console.log(`[welcome-bonus] Submitted, txid: ${txid}`);

    // 7. Complete payment
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
      await updateStatus(db, paymentId, 'complete_failed', txid);
      return res.status(400).json({ error: 'Complete gagal', detail: errData });
    }

    // 8. Update status + tambah SGT bonus ke player
    await updateStatus(db, paymentId, 'completed', txid);
    await playerRef.update({
      sgtBalance: admin.firestore.FieldValue.increment(WELCOME_BONUS_SGT),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log(`[welcome-bonus] Selesai: ${WELCOME_BONUS_PI} Pi + ${WELCOME_BONUS_SGT} SGT → uid=${uid}, txid=${txid}`);

    return res.status(200).json({
      success: true,
      paymentId,
      txid,
      piAmount: WELCOME_BONUS_PI,
      sgtBonus: WELCOME_BONUS_SGT
    });

  } catch (err) {
    console.error('[welcome-bonus] ERROR:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

async function updateStatus(db, paymentId, status, txid) {
  const data = {
    status,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };
  if (txid) data.txid = txid;
  if (status === 'completed') data.completedAt = admin.firestore.FieldValue.serverTimestamp();
  try {
    await db.collection('payouts').doc(paymentId).set(data, { merge: true });
    console.log(`[welcome-bonus] Firestore updated: ${paymentId} → ${status}`);
  } catch (e) {
    console.error('[welcome-bonus] Firestore update error:', e.message);
  }
}
