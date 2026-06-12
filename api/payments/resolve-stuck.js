// /api/payments/resolve-stuck.js
// Untuk menyelesaikan payment A2U yang stuck (sudah approved, belum completed)
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
    throw new Error(`Pi API HTTP ${resp.status} HTML response. URL: ${url}`);
  }
  try {
    return { ok: resp.ok, status: resp.status, data: JSON.parse(text) };
  } catch (e) {
    throw new Error(`Pi API response bukan JSON (HTTP ${resp.status}): ${text.substring(0, 300)}`);
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.PI_API_KEY) {
    return res.status(500).json({ error: 'PI_API_KEY belum diset' });
  }

  const paymentId = req.body?.paymentId;
  if (!paymentId) {
    return res.status(400).json({ error: 'paymentId wajib diisi' });
  }

  console.log(`[resolve-stuck] paymentId: ${paymentId}`);

  try {
    // Step 1: GET status terkini dari Pi Platform
    console.log(`[resolve-stuck] Step 1: GET payment status...`);
    const { ok, status: httpStatus, data: payment } = await piRequest(
      `https://api.minepi.com/v2/payments/${paymentId}`
    );

    console.log(`[resolve-stuck] Payment status (HTTP ${httpStatus}):`, JSON.stringify(payment.status));
    console.log(`[resolve-stuck] Transaction:`, JSON.stringify(payment.transaction));

    if (!ok) {
      return res.status(400).json({ error: 'Payment tidak ditemukan', detail: payment });
    }

    // Sudah selesai
    if (payment.status?.developer_completed) {
      return res.status(200).json({
        success: true,
        alreadyDone: true,
        paymentId,
        txid: payment.transaction?.txid
      });
    }

    // Dibatalkan
    if (payment.status?.cancelled || payment.status?.user_cancelled) {
      return res.status(400).json({ error: 'Payment sudah cancelled', paymentId });
    }

    // Untuk A2U: Pi Platform submit sendiri ke blockchain
    // Kita hanya perlu txid dari transaction, lalu panggil /complete
    let txid = payment.transaction?.txid;

    // Step 2: Kalau txid belum ada, coba tunggu sebentar dan GET ulang
    if (!txid) {
      console.log(`[resolve-stuck] txid belum ada, tunggu 3 detik dan retry...`);
      await new Promise(r => setTimeout(r, 3000));

      const { ok: ok2, data: payment2 } = await piRequest(
        `https://api.minepi.com/v2/payments/${paymentId}`
      );

      if (ok2) {
        txid = payment2.transaction?.txid;
        console.log(`[resolve-stuck] Setelah retry, txid:`, txid);
        console.log(`[resolve-stuck] Status:`, JSON.stringify(payment2.status));
      }
    }

    // Kalau masih tidak ada txid → payment belum diproses blockchain sama sekali
    // Ini terjadi kalau Pi Platform belum submit (butuh waktu / ada bug di Pi)
    if (!txid) {
      return res.status(202).json({
        success: false,
        pending: true,
        message: 'Payment sudah approved tapi belum ada txid dari blockchain Pi. ' +
                 'Ini bisa terjadi di testnet. Coba lagi dalam beberapa menit, ' +
                 'atau cancel payment ini dari Pi Developer Portal dan buat baru.',
        paymentId,
        currentStatus: payment.status,
        suggestion: 'Buka https://developers.minepi.com → Payments → cancel payment ini'
      });
    }

    // Step 3: Complete payment dengan txid yang ada
    console.log(`[resolve-stuck] Step 3: Complete dengan txid: ${txid}`);
    const { ok: completeOk, status: completeStatus, data: completeData } = await piRequest(
      `https://api.minepi.com/v2/payments/${paymentId}/complete`,
      { method: 'POST', body: JSON.stringify({ txid }) }
    );

    console.log(`[resolve-stuck] Complete (HTTP ${completeStatus}):`, JSON.stringify(completeData));

    if (!completeOk) {
      return res.status(400).json({ error: 'Complete gagal', detail: completeData });
    }

    // Step 4: Update Firestore
    try {
      const db = admin.firestore();
      await db.collection('payouts').doc(paymentId).set({
        status: 'completed',
        txid,
        resolvedManually: true,
        resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } catch (fbErr) {
      console.warn(`[resolve-stuck] Firestore update gagal (non-fatal):`, fbErr.message);
    }

    console.log(`[resolve-stuck] ✅ Done! paymentId=${paymentId} txid=${txid}`);
    return res.status(200).json({ success: true, paymentId, txid });

  } catch (err) {
    console.error('[resolve-stuck] ERROR:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
