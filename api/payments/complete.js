// /api/payments/complete.js
// Complete Pi payment + tambah SGT ke saldo player di Firestore
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
    })
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { paymentId, txid, uid, sgtAmount } = req.body;

  if (!paymentId || !txid) {
    return res.status(400).json({ error: 'paymentId dan txid diperlukan' });
  }

  const db = admin.firestore();

  try {
    // 1. Cek apakah payment ini sudah pernah di-complete (idempotency)
    const payRef = db.collection('pi_payments').doc(paymentId);
    const paySnap = await payRef.get();

    if (paySnap.exists && paySnap.data().status === 'completed') {
      console.log(`[complete] Payment ${paymentId} sudah selesai sebelumnya`);
      return res.status(200).json({ success: true, alreadyCompleted: true });
    }

    // 2. Complete ke Pi Platform API
    const response = await fetch(
      `https://api.minepi.com/v2/payments/${paymentId}/complete`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Key ${process.env.PI_API_KEY}`,
          'Content-Type':  'application/json'
        },
        body: JSON.stringify({ txid })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      await payRef.set({
        paymentId, txid, uid, sgtAmount,
        status:    'complete_failed',
        error:     JSON.stringify(data),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      return res.status(400).json({ error: 'Pi complete failed', detail: data });
    }

    // 3. Tambah SGT ke saldo player secara atomic (transaction)
    const sgt = parseInt(sgtAmount) || 0;
    if (uid && sgt > 0) {
      const playerRef = db.collection('players').doc(uid);
      await db.runTransaction(async (t) => {
        const playerSnap = await t.get(playerRef);
        if (!playerSnap.exists) {
          throw new Error(`Player ${uid} tidak ditemukan`);
        }
        const currentBalance = parseFloat(playerSnap.data().sgtBalance) || 0;
        t.update(playerRef, {
          sgtBalance: currentBalance + sgt,
          updatedAt:  admin.firestore.FieldValue.serverTimestamp()
        });
      });

      // Catat history top-up
      await db.collection('topup_history').add({
        uid,
        paymentId,
        txid,
        sgtAmount: sgt,
        piAmount:  sgt / 100,   // 1 Pi = 100 SGT
        type:      'topup_sgt',
        status:    'success',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    // 4. Update status payment ke completed
    await payRef.set({
      paymentId, txid, uid, sgtAmount: sgt,
      type:      'topup_sgt',
      status:    'completed',
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt:   admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    console.log(`[complete] Payment ${paymentId} selesai, +${sgt} SGT untuk uid=${uid}`);
    return res.status(200).json({ success: true, sgtAdded: sgt });

  } catch (err) {
    console.error('[complete]', err.message);
    // Tandai error di Firestore
    try {
      await db.collection('pi_payments').doc(paymentId).set({
        status: 'error', error: err.message,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } catch(_) {}
    return res.status(500).json({ error: err.message });
  }
}
