// /api/payments/cancel-stuck.js
// Endpoint sekali pakai untuk cancel payment yang stuck
import { admin, getFirebaseApp } from '../../firebase-init.js';
getFirebaseApp();

async function piRequest(url, options = {}) {
  const resp = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Key ${process.env.PI_API_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await resp.text();
  if (text.trim().startsWith('<')) {
    throw new Error(`Pi API HTTP ${resp.status} HTML. URL: ${url}`);
  }
  try {
    return { ok: resp.ok, status: resp.status, data: JSON.parse(text) };
  } catch (e) {
    throw new Error(`Bukan JSON (HTTP ${resp.status}): ${text.substring(0, 200)}`);
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const paymentId = req.body?.paymentId;
  if (!paymentId) {
    return res.status(400).json({ error: 'paymentId wajib diisi' });
  }

  console.log(`[cancel-stuck] Mencoba cancel paymentId: ${paymentId}`);

  try {
    // Cek status dulu
    const { ok, data: payment } = await piRequest(
      `https://api.minepi.com/v2/payments/${paymentId}`
    );

    if (!ok) {
      return res.status(400).json({ error: 'Payment tidak ditemukan', detail: payment });
    }

    console.log(`[cancel-stuck] Status saat ini:`, JSON.stringify(payment.status));

    // Sudah completed — tidak perlu cancel
    if (payment.status?.developer_completed) {
      return res.status(200).json({ message: 'Payment sudah completed, tidak perlu cancel', paymentId });
    }

    // Sudah cancelled
    if (payment.status?.cancelled || payment.status?.user_cancelled) {
      return res.status(200).json({ message: 'Payment sudah cancelled sebelumnya', paymentId });
    }

    // Cancel via Pi API
    const { ok: cancelOk, status: cancelStatus, data: cancelData } = await piRequest(
      `https://api.minepi.com/v2/payments/${paymentId}/cancel`,
      { method: 'POST', body: JSON.stringify({}) }
    );

    console.log(`[cancel-stuck] Cancel response (HTTP ${cancelStatus}):`, JSON.stringify(cancelData));

    if (!cancelOk) {
      return res.status(400).json({ error: 'Cancel gagal', detail: cancelData });
    }

    // Update Firestore
    try {
      const db = admin.firestore();
      await db.collection('payouts').doc(paymentId).set({
        status: 'cancelled',
        cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } catch (fbErr) {
      console.warn(`[cancel-stuck] Firestore error (non-fatal):`, fbErr.message);
    }

    console.log(`[cancel-stuck] ✅ Payment berhasil dicancel: ${paymentId}`);
    return res.status(200).json({ success: true, cancelled: true, paymentId });

  } catch (err) {
    console.error('[cancel-stuck] ERROR:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
