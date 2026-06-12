// /api/payments/resolve-stuck.js
import { admin, getFirebaseApp } from '../../firebase-init.js';
getFirebaseApp();

// Helper: fetch ke Pi API, handle kalau response bukan JSON
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

  // Cek apakah response adalah HTML (error dari Pi server)
  if (text.trim().startsWith('<')) {
    throw new Error(`Pi API returned HTML (HTTP ${resp.status}). PI_API_KEY mungkin salah atau expired. URL: ${url}`);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`Pi API response bukan JSON (HTTP ${resp.status}): ${text.substring(0, 200)}`);
  }

  return { ok: resp.ok, status: resp.status, data };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Validasi env
  if (!process.env.PI_API_KEY) {
    return res.status(500).json({ error: 'PI_API_KEY belum diset di Vercel environment' });
  }
  if (!process.env.PI_WALLET_PRIVATE_SEED) {
    return res.status(500).json({ error: 'PI_WALLET_PRIVATE_SEED belum diset di Vercel environment' });
  }

  const paymentId = req.body?.paymentId;
  if (!paymentId) {
    return res.status(400).json({ error: 'paymentId wajib diisi di body' });
  }

  console.log(`[resolve-stuck] Mulai proses paymentId: ${paymentId}`);

  try {
    // Step 1: Cek status payment di Pi Platform
    console.log(`[resolve-stuck] Cek status payment...`);
    const { ok: checkOk, status: checkStatus, data: payment } = await piRequest(
      `https://api.minepi.com/v2/payments/${paymentId}`
    );

    console.log(`[resolve-stuck] Status (HTTP ${checkStatus}):`, JSON.stringify(payment));

    if (!checkOk) {
      return res.status(400).json({ error: 'Payment tidak ditemukan di Pi Platform', detail: payment });
    }

    // Sudah completed — tidak perlu proses
    if (payment.status?.developer_completed === true) {
      return res.status(200).json({
        success: true,
        alreadyCompleted: true,
        message: 'Payment sudah completed sebelumnya',
        paymentId,
        txid: payment.transaction?.txid
      });
    }

    // Dibatalkan — tidak bisa diproses
    if (payment.status?.cancelled || payment.status?.user_cancelled) {
      return res.status(400).json({ error: 'Payment sudah dibatalkan', paymentId });
    }

    let txid = payment.transaction?.txid;

    // Step 2: Submit ke blockchain (jika transaction masih null / belum verified)
    if (!payment.status?.transaction_verified && !txid) {
      console.log(`[resolve-stuck] Submit ke blockchain...`);
      const { ok: submitOk, status: submitStatus, data: submitData } = await piRequest(
        `https://api.minepi.com/v2/payments/${paymentId}/submit_payment`,
        {
          method: 'POST',
          body: JSON.stringify({ wallet_private_seed: process.env.PI_WALLET_PRIVATE_SEED })
        }
      );

      console.log(`[resolve-stuck] Submit (HTTP ${submitStatus}):`, JSON.stringify(submitData));

      if (!submitOk) {
        return res.status(400).json({ error: 'Submit ke blockchain gagal', detail: submitData });
      }

      txid = submitData.txid || submitData.transaction?.txid;
    }

    if (!txid) {
      // Coba ambil txid dari payment data yang sudah ada
      txid = payment.transaction?.txid;
    }

    if (!txid) {
      return res.status(400).json({
        error: 'Tidak ada txid setelah submit. Payment mungkin perlu waktu lebih lama di blockchain.',
        paymentId,
        currentStatus: payment.status
      });
    }

    console.log(`[resolve-stuck] txid didapat: ${txid}`);

    // Step 3: Complete payment
    console.log(`[resolve-stuck] Complete payment...`);
    const { ok: completeOk, status: completeStatus, data: completeData } = await piRequest(
      `https://api.minepi.com/v2/payments/${paymentId}/complete`,
      {
        method: 'POST',
        body: JSON.stringify({ txid })
      }
    );

    console.log(`[resolve-stuck] Complete (HTTP ${completeStatus}):`, JSON.stringify(completeData));

    if (!completeOk) {
      return res.status(400).json({ error: 'Complete payment gagal', detail: completeData });
    }

    // Step 4: Update Firestore
    try {
      const db = admin.firestore();
      await db.collection('payouts').doc(paymentId).set({
        status: 'completed',
        txid,
        resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      console.log(`[resolve-stuck] Firestore updated`);
    } catch (fbErr) {
      // Firestore error tidak fatal — payment sudah selesai di Pi
      console.warn(`[resolve-stuck] Firestore update gagal (non-fatal):`, fbErr.message);
    }

    console.log(`[resolve-stuck] ✅ Selesai! paymentId=${paymentId} txid=${txid}`);
    return res.status(200).json({ success: true, paymentId, txid });

  } catch (err) {
    console.error('[resolve-stuck] ERROR:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
