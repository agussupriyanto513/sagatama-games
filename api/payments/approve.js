// /api/payments/approve.js
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
    })
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { paymentId, uid, sgtAmount } = req.body;
  if (!paymentId) return res.status(400).json({ error: 'paymentId diperlukan' });

  try {
    const db = admin.firestore();
    await db.collection('pi_payments').doc(paymentId).set({
      paymentId, uid: uid || null, sgtAmount: sgtAmount || 0,
      type: 'topup_sgt', status: 'pending_approval',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    const response = await fetch(`https://api.minepi.com/v2/payments/${paymentId}/approve`, {
      method: 'POST',
      headers: { 'Authorization': `Key ${process.env.PI_API_KEY}`, 'Content-Type': 'application/json' }
    });
    const data = await response.json();

    if (!response.ok) {
      await db.collection('pi_payments').doc(paymentId).update({
        status: 'approval_failed', error: JSON.stringify(data),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      return res.status(400).json({ error: 'Pi approval failed', detail: data });
    }

    await db.collection('pi_payments').doc(paymentId).update({
      status: 'approved', updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return res.status(200).json(data);
  } catch (err) {
    console.error('[approve]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
