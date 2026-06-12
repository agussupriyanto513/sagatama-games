// /api/payments/resolve-stuck.js
import { admin, getFirebaseApp } from '../../firebase-init.js';
getFirebaseApp();

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

  // Cek env variables dulu — jangan sampai crash tanpa pesan jelas
  if (!process.env.PI_API_KEY) {
    return res.status(500).json({ error: 'PI_API_KEY belum diset di environment' });
  }
  if (!process.env.PI_WALLET_PRIVATE_SEED) {
    return res.status(500).json({ error: 'PI_WALLET_PRIVATE_SEED belum diset di environment' });
  }

  console.log(`[resolve-stuck] Mulai selesaikan payment: ${paymentId}`);

  try {
    // Step 1: Cek status payment dulu di Pi Platform
    const checkResp = await fetch(
      `https://api.minepi.com/v2/payments/${paymentId}`,
      {
        method: 'GET',
        headers: { 'Authorization': `Key ${process.env.PI_API_KEY}` }
      }
    );
    const checkData = await checkResp.json();
    console.log(`[resolve-stuck] Status payment:`, JSON.stringify(checkData));

    // Kalau sudah completed, tidak perlu diproses ulang
    if (checkData.status?.developer_completed === true) {
      return res.status(200).json({
        success: true,
        message: 'Payment sudah completed sebelumnya',
        paymentId,
        txid: checkData.transaction?.txid
      });
    }

    let txid = checkData.transaction?.txid;

    // Step 2: Submit ke blockchain (hanya jika belum disubmit)
    if (!checkData.status?.blockchain_tx_complete) {
      const submitResp = await fetch(
        `https://api.minepi.com/v2/payments/${paymentId}/submit_payment`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Key ${process.env.PI_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ wallet_private_seed: process.env.PI_WALLET_PRIVATE_SEED })
        }
      );
      const submitData = await submitResp.json();
      console.log(`[resolve-stuck] Submit response (${submitResp.status}):`, JSON.stringify(submitData));

      if (!submitResp.ok) {
        return res.status(400).json({ error: 'Submit gagal', detail: submitData });
      }

      txid = submitData.txid || submitData.transaction?.txid;
    }

    if (!txid) {
      return res.status(400).json({ error: 'Tidak ada txid setelah submit', paymentId });
    }

    console.log(`[resolve-stuck] txid: ${txid}`);

    // Step 3: Complete payment
    const completeResp = await fetch(
      `https://api.minepi.com/v2/payments/${paymentId}/complete`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Key ${process.env.PI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ txid })
      }
    );
    const completeData = await completeResp.json();
    console.log(`[resolve-stuck] Complete response (${completeResp.status}):`, JSON.stringify(completeData));

    if (!completeResp.ok) {
      return res.status(400).json({ error: 'Complete gagal', detail: completeData });
    }

    // Step 4: Update Firestore
    const db = admin.firestore();
    await db.collection('payouts').doc(paymentId).set({
      status: 'completed',
      txid,
      resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    console.log(`[resolve-stuck] Selesai! paymentId=${paymentId} txid=${txid}`);
    return res.status(200).json({ success: true, paymentId, txid });

  } catch (err) {
    console.error('[resolve-stuck] ERROR:', err.message, err.stack);
    return res.status(500).json({ error: err.message });
  }
}
