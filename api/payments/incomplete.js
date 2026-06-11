// /api/payments/incomplete.js
// Handle incomplete Pi payment yang belum selesai saat app dibuka
// Dipanggil oleh Pi SDK callback: onIncompletePaymentFound
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

  const { paymentId } = req.body;
  if (!paymentId) {
    return res.status(400).json({ error: 'paymentId diperlukan' });
  }

  try {
    const db = admin.firestore();

    // 1. Cek status payment di Firestore
    const payRef  = db.collection('pi_payments').doc(paymentId);
    const paySnap = await payRef.get();

    // 2. Cek status payment di Pi Platform
    const piRes = await fetch(
      `https://api.minepi.com/v2/payments/${paymentId}`,
      {
        headers: {
          'Authorization': `Key ${process.env.PI_API_KEY}`
        }
      }
    );

    if (!piRes.ok) {
      console.warn(`[incomplete] Tidak bisa fetch payment ${paymentId}`);
      return res.status(200).json({ action: 'ignored' });
    }

    const piPayment = await piRes.json();
    const { status: piStatus, transaction } = piPayment;

    // 3. Tentukan aksi berdasarkan status Pi
    if (piStatus?.developer_approved && !piStatus?.developer_completed) {
      // Sudah di-approve tapi belum complete — lanjutkan complete
      if (transaction?.txid) {
        // Sudah ada txid di blockchain, complete sekarang
        const completeRes = await fetch(
          `https://api.minepi.com/v2/payments/${paymentId}/complete`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Key ${process.env.PI_API_KEY}`,
              'Content-Type':  'application/json'
            },
            body: JSON.stringify({ txid: transaction.txid })
          }
        );

        if (completeRes.ok) {
          // Tambah SGT jika ada uid dan sgtAmount di Firestore
          const sgt = parseInt(paySnap.exists ? paySnap.data().sgtAmount : 0) || 0;
          const uid = paySnap.exists ? paySnap.data().uid : null;

          if (uid && sgt > 0) {
            const playerRef = db.collection('players').doc(uid);
            await db.runTransaction(async (t) => {
              const pSnap = await t.get(playerRef);
              if (pSnap.exists) {
                const cur = parseFloat(pSnap.data().sgtBalance) || 0;
                t.update(playerRef, {
                  sgtBalance: cur + sgt,
                  updatedAt:  admin.firestore.FieldValue.serverTimestamp()
                });
              }
            });
          }

          await payRef.set({
            status:      'completed',
            txid:        transaction.txid,
            completedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt:   admin.firestore.FieldValue.serverTimestamp(),
            recoveredIncomplete: true
          }, { merge: true });

          console.log(`[incomplete] Payment ${paymentId} di-recover dan diselesaikan`);
          return res.status(200).json({ action: 'completed', paymentId });
        }
      }
      // Belum ada txid — cancel saja
    }

    // 4. Default: cancel payment yang tidak bisa di-recover
    await fetch(`https://api.minepi.com/v2/payments/${paymentId}/cancel`, {
      method: 'POST',
      headers: { 'Authorization': `Key ${process.env.PI_API_KEY}` }
    });

    await payRef.set({
      status:      'cancelled_incomplete',
      updatedAt:   admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    console.log(`[incomplete] Payment ${paymentId} dibatalkan (incomplete)`);
    return res.status(200).json({ action: 'cancelled', paymentId });

  } catch (err) {
    console.error('[incomplete]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
