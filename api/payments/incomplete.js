// /api/pi-payment/incomplete.js
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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { paymentId } = req.body;
  if (!paymentId) return res.status(400).json({ error: 'paymentId diperlukan' });

  console.log(`[incomplete] Menangani payment stuck: ${paymentId}`);

  // Selalu cancel — ini adalah payment yang tidak pernah selesai.
  // Lebih aman cancel semua agar user bisa mulai payment baru yang bersih.
  await cancelOnPi(paymentId);

  // Update Firestore di background, tidak ditunggu
  try {
    const db = admin.firestore();
    db.collection('pi_payments').doc(paymentId)
      .set({
        paymentId,
        status:    'cancelled_incomplete',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true })
      .catch(e => console.warn('[incomplete] Firestore error:', e.message));
  } catch(_) {}

  return res.status(200).json({ action: 'cancelled' });
}

async function cancelOnPi(paymentId) {
  try {
    const response = await fetch(
      `https://api.minepi.com/v2/payments/${paymentId}/cancel`,
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
      console.warn(`[incomplete] Cancel Pi gagal ${paymentId}:`, data);
    } else {
      console.log(`[incomplete] ✅ Cancel Pi berhasil ${paymentId}`);
    }
  } catch(e) {
    console.warn(`[incomplete] Exception cancel ${paymentId}:`, e.message);
  }
}
