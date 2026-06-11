// /api/pi-payment/incomplete.js
// Menangani payment yang belum selesai (incomplete) saat user buka app
// Pi SDK memanggil onIncompletePaymentFound → frontend lapor ke sini
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

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { paymentId } = req.body;
  if (!paymentId) {
    return res.status(400).json({ error: 'paymentId diperlukan' });
  }

  const db = admin.firestore();

  try {
    // 1. Cek status payment di Firestore
    const snap = await db.collection('pi_payments').doc(paymentId).get();

    if (!snap.exists) {
      // Payment tidak ada di DB kita → cancel saja di Pi
      console.log(`[incomplete] Payment ${paymentId} tidak ada di DB → cancel`);
      await cancelOnPi(paymentId);
      return res.status(200).json({ action: 'cancelled', reason: 'not_found_in_db' });
    }

    const payment = snap.data();
    console.log(`[incomplete] Payment ${paymentId} status di DB: ${payment.status}`);

    // 2. Logika berdasarkan status
    if (payment.status === 'completed') {
      // Sudah selesai, tidak perlu tindakan
      return res.status(200).json({ action: 'none', reason: 'already_completed' });
    }

    if (payment.status === 'approved') {
      // Sudah di-approve tapi belum complete → mungkin txid belum masuk
      // Biarkan saja, user bisa bayar ulang atau tunggu konfirmasi blockchain
      return res.status(200).json({ action: 'none', reason: 'approved_waiting_tx' });
    }

    // Status lain (pending_approval, approval_failed, error) → cancel
    await cancelOnPi(paymentId);
    await db.collection('pi_payments').doc(paymentId).update({
      status:    'cancelled_incomplete',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return res.status(200).json({ action: 'cancelled', reason: payment.status });

  } catch (err) {
    console.error('[incomplete] ERROR:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

// Helper: cancel payment di Pi Platform API
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
      console.warn(`[incomplete] Cancel Pi gagal untuk ${paymentId}:`, data);
    } else {
      console.log(`[incomplete] ✅ Cancel Pi berhasil untuk ${paymentId}`);
    }
  } catch(e) {
    console.warn(`[incomplete] Exception saat cancel Pi ${paymentId}:`, e.message);
  }
}
