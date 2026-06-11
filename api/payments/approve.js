// /api/pi-payment/approve.js
// Approve Pi payment + catat ke Firestore sebagai pending
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
  // ── CORS untuk Pi Browser (sandbox maupun production) ──
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { paymentId, uid, sgtAmount } = req.body;

  if (!paymentId) {
    return res.status(400).json({ error: 'paymentId diperlukan' });
  }

  const db = admin.firestore();

  try {
    // 1. Cek apakah payment ini sudah pernah diproses (idempotency)
    const existing = await db.collection('pi_payments').doc(paymentId).get();
    if (existing.exists) {
      const data = existing.data();
      // Kalau sudah approved atau lebih jauh → langsung return sukses
      if (['approved', 'completed'].includes(data.status)) {
        console.log(`[approve] Payment ${paymentId} sudah pernah diproses (${data.status}), skip.`);
        return res.status(200).json({ success: true, alreadyProcessed: true });
      }
    }

    // 2. Catat payment ke Firestore (status: pending_approval)
    await db.collection('pi_payments').doc(paymentId).set({
      paymentId,
      uid:       uid || null,
      sgtAmount: sgtAmount || 0,
      type:      'topup_sgt',
      status:    'pending_approval',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    // 3. Approve ke Pi Platform API
    const response = await fetch(
      `https://api.minepi.com/v2/payments/${paymentId}/approve`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Key ${process.env.PI_API_KEY}`,
          'Content-Type':  'application/json'
        }
      }
    );

    const data = await response.json();

    if (!response.ok) {
      // Update status gagal di Firestore
      await db.collection('pi_payments').doc(paymentId).update({
        status:    'approval_failed',
        error:     JSON.stringify(data),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      console.error(`[approve] GAGAL approve ${paymentId}:`, data);
      return res.status(400).json({ error: 'Pi approval failed', detail: data });
    }

    // 4. Update status berhasil di-approve
    await db.collection('pi_payments').doc(paymentId).update({
      status:    'approved',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log(`[approve] ✅ Payment ${paymentId} approved untuk uid=${uid}`);
    return res.status(200).json({ success: true, ...data });

  } catch (err) {
    console.error('[approve] ERROR:', err.message);
    // Coba update Firestore kalau bisa
    try {
      await db.collection('pi_payments').doc(paymentId).update({
        status: 'approval_error',
        error:  err.message,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    } catch (_) {}
    return res.status(500).json({ error: err.message });
  }
}
