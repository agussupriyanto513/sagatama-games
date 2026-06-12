// /api/payments/resolve-stuck.js
// Satu kali pakai — selesaikan payment A2U yang stuck
import { admin, getFirebaseApp } from '../../firebase-init.js';
getFirebaseApp();

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Payment stuck dari Pi Platform
  const paymentId = req.body.paymentId || 'ifKX5hhR6yvsKigqqeOltSxjWY78';

  console.log(`[resolve-stuck] Mulai selesaikan payment: ${paymentId}`);

  try {
    // 1. Submit ke blockchain
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
      // Jika sudah pernah disubmit, coba langsung complete dengan txid yang ada
      if (submitData.transaction?.txid) {
        console.log('[resolve-stuck] Sudah disubmit, lanjut complete dengan txid:', submitData.transaction.txid);
      } else {
        return res.status(400).json({ error: 'Submit gagal', detail: submitData });
      }
    }

    const txid = submitData.txid || submitData.transaction?.txid;
    if (!txid) {
      return res.status(400).json({ error: 'Tidak ada txid', detail: submitData });
    }

    console.log(`[resolve-stuck] txid: ${txid}`);

    // 2. Complete payment
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

    // 3. Update Firestore
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
    console.error('[resolve-stuck] ERROR:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
