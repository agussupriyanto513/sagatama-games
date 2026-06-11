// /api/pi-payment/approve.js
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

  const { paymentId, uid, sgtAmount } = req.body;
  if (!paymentId) return res.status(400).json({ error: 'paymentId diperlukan' });

  // ─────────────────────────────────────────────────────────────────
  // KUNCI: Langsung approve ke Pi API dulu, tanpa Firestore sama sekali.
  // Pi SDK timeout ~3 detik. Firestore read/write butuh 1-2 detik sendiri.
  // Jadi: approve Pi dulu → langsung response ke SDK → Firestore di background.
  // ─────────────────────────────────────────────────────────────────
  try {
    const piResp = await fetch(
      `https://api.minepi.com/v2/payments/${paymentId}/approve`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Key ${process.env.PI_API_KEY}`,
          'Content-Type':  'application/json'
        }
      }
    );

    const piData = await piResp.json();

    if (!piResp.ok) {
      console.error(`[approve] Pi API gagal untuk ${paymentId}:`, piData);
      // Catat kegagalan ke Firestore di background
      saveToFirestore(paymentId, uid, sgtAmount, 'approval_failed', JSON.stringify(piData));
      return res.status(400).json({ error: 'Pi approval failed', detail: piData });
    }

    // ✅ Pi approve berhasil — langsung kirim response agar SDK tidak timeout
    res.status(200).json({ success: true, ...piData });

    // Firestore jalan di background SETELAH response sudah dikirim ke SDK
    saveToFirestore(paymentId, uid, sgtAmount, 'approved', null);

  } catch (err) {
    console.error('[approve] ERROR:', err.message);
    saveToFirestore(paymentId, uid, sgtAmount, 'approval_error', err.message);
    return res.status(500).json({ error: err.message });
  }
}

// Background: tulis ke Firestore tanpa await, tidak memblokir response
function saveToFirestore(paymentId, uid, sgtAmount, status, errorMsg) {
  const db = admin.firestore();
  const data = {
    paymentId,
    uid:       uid || null,
    sgtAmount: sgtAmount || 0,
    type:      'topup_sgt',
    status,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };
  if (errorMsg) data.error = errorMsg;

  db.collection('pi_payments').doc(paymentId)
    .set({ ...data, createdAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
    .then(() => console.log(`[approve] ✅ Firestore saved: ${paymentId} → ${status}`))
    .catch(e => console.error(`[approve] Firestore error:`, e.message));
}
