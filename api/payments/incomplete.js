// /api/pi-payment/incomplete.js
import { admin, getFirebaseApp } from '../../firebase-init.js';
getFirebaseApp();

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { paymentId } = req.body;
  if (!paymentId) return res.status(400).json({ error: 'paymentId diperlukan' });

  console.log(`[incomplete] Menangani payment stuck: ${paymentId}`);

  try {
    const checkResp = await fetch(
      `https://api.minepi.com/v2/payments/${paymentId}`,
      { headers: { 'Authorization': `Key ${process.env.PI_API_KEY}` } }
    );
    const piPayment = await checkResp.json();
    const status = piPayment.status || {};
    console.log(`[incomplete] Status Pi:`, JSON.stringify(status));

    if (status.developer_approved && status.transaction_verified && !status.developer_completed) {
      console.log(`[incomplete] Sudah di blockchain → complete`);
      await completeOnPi(paymentId, piPayment.transaction?.txid);

      const sgtAmount = piPayment.metadata?.sgtAmount || 0;
      const uid       = piPayment.metadata?.uid || null;
      if (uid && sgtAmount > 0) await creditSGT(uid, sgtAmount, paymentId);

      return res.status(200).json({ action: 'completed', paymentId });
    }

    if (!status.developer_approved || (status.developer_approved && !status.transaction_verified)) {
      console.log(`[incomplete] Belum verified → cancel`);
      await cancelOnPi(paymentId);
      return res.status(200).json({ action: 'cancelled', paymentId });
    }

    return res.status(200).json({ action: 'none', paymentId });

  } catch (err) {
    console.error('[incomplete] ERROR:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

async function completeOnPi(paymentId, txid) {
  try {
    const r = await fetch(`https://api.minepi.com/v2/payments/${paymentId}/complete`, {
      method: 'POST',
      headers: { 'Authorization': `Key ${process.env.PI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ txid })
    });
    const d = await r.json();
    r.ok ? console.log(`[incomplete] ✅ Complete OK ${paymentId}`) : console.warn(`[incomplete] Complete gagal:`, d);
  } catch(e) { console.warn(`[incomplete] Complete error:`, e.message); }
}

async function cancelOnPi(paymentId) {
  try {
    const r = await fetch(`https://api.minepi.com/v2/payments/${paymentId}/cancel`, {
      method: 'POST',
      headers: { 'Authorization': `Key ${process.env.PI_API_KEY}`, 'Content-Type': 'application/json' }
    });
    const d = await r.json();
    r.ok ? console.log(`[incomplete] ✅ Cancel OK ${paymentId}`) : console.warn(`[incomplete] Cancel gagal:`, d);
  } catch(e) { console.warn(`[incomplete] Cancel error:`, e.message); }
}

async function creditSGT(uid, sgtAmount, paymentId) {
  try {
    const db = admin.firestore();
    const payRef    = db.collection('pi_payments').doc(paymentId);
    const playerRef = db.collection('players').doc(uid);

    await db.runTransaction(async t => {
      const [paySnap, playerSnap] = await Promise.all([t.get(payRef), t.get(playerRef)]);
      if (paySnap.exists && paySnap.data().status === 'completed') {
        console.log(`[incomplete] SGT sudah dikreditkan, skip`);
        return;
      }
      const current = playerSnap.exists ? (playerSnap.data().sgtBalance || 0) : 0;
      t.set(playerRef, { sgtBalance: current + sgtAmount, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      t.set(payRef,    { status: 'completed', updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    });
    console.log(`[incomplete] ✅ Kredit ${sgtAmount} SGT → uid=${uid}`);
  } catch(e) { console.error(`[incomplete] Kredit SGT error:`, e.message); }
}
