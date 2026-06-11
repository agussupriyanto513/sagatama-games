// /api/payments/cancel.js
// Cancel Pi payment + update status di Firestore
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
    const response = await fetch(
      `https://api.minepi.com/v2/payments/${paymentId}/cancel`,
      {
        method:  'POST',
        headers: {
          'Authorization': `Key ${process.env.PI_API_KEY}`,
          'Content-Type':  'application/json'
        }
      }
    );

    // Update status di Firestore
    const db = admin.firestore();
    await db.collection('pi_payments').doc(paymentId).set({
      status:      'cancelled',
      cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt:   admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    if (response.ok) {
      console.log(`[cancel] Payment ${paymentId} dibatalkan`);
      return res.status(200).json({ success: true });
    } else {
      const error = await response.text();
      return res.status(500).json({ error });
    }
  } catch (error) {
    console.error('[cancel]', error.message);
    return res.status(500).json({ error: error.message });
  }
}
