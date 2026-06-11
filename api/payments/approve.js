// /api/payments/approve.js
import admin from "firebase-admin";

// Init Firebase sekali saja di module level (bukan di dalam handler)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
    })
  });
}

// Pre-warm Firestore connection
const db = admin.firestore();

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { paymentId, uid, sgtAmount } = req.body;
  if (!paymentId) return res.status(400).json({ error: 'paymentId diperlukan' });

  // PENTING: Respond ke Pi SECEPAT mungkin dengan 200
  // lalu lanjutkan proses di background
  res.status(200).json({ success: true, paymentId });

  // Lanjut proses approve di background (setelah response dikirim)
  try {
    // Catat ke Firestore
    await db.collection('pi_payments').doc(paymentId).set({
      paymentId,
      uid:       uid || null,
      sgtAmount: sgtAmount || 0,
      type:      'topup_sgt',
      status:    'pending_approval',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Approve ke Pi Platform
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
      await db.collection('pi_payments').doc(paymentId).update({
        status:    'approval_failed',
        error:     JSON.stringify(data),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      console.error('[approve] Pi approval failed:', data);
      return;
    }

    await db.collection('pi_payments').doc(paymentId).update({
      status:    'approved',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log(`[approve] Payment ${paymentId} approved for uid=${uid}`);

  } catch (err) {
    console.error('[approve] Background error:', err.message);
  }
}
