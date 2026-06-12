// /api/payments/payout.js
// App-to-User: kirim Pi testnet ke wallet user sebagai reward
// ALUR: create → approve → return paymentId (selesai <5s)
// Complete dilakukan terpisah via /api/payments/resolve-stuck
import { admin, getFirebaseApp } from '../../firebase-init.js';
getFirebaseApp();

// Helper: fetch ke Pi API, handle HTML response
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
    throw new Error(`Pi API bukan JSON (HTTP ${resp.status}): ${text.substring(0, 200)}`);
  }
}

// Cancel payment yang stuck (ongoing_payment_found)
async function cancelPayment(paymentId) {
  try {
    const { ok, data } = await piRequest(
      `https://api.minepi.com/v2/payments/${paymentId}/cancel`,
      { method: 'POST', body: JSON.stringify({}) }
    );
    console.log(`[payout] Cancel payment ${paymentId}:`, ok ? 'OK' : JSON.stringify(data));
    return ok;
  } catch (e) {
    console.warn(`[payout] Cancel error:`, e.message);
    return false;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { uid, piUid, piAmount, reason } = req.body;
  if (!uid || !piUid || !piAmount) {
    return res.status(400).json({ error: 'uid, piUid, dan piAmount diperlukan' });
  }
  if (piAmount <= 0 || piAmount > 10) {
    return res.status(400).json({ error: 'piAmount harus antara 0.001 dan 10' });
  }

  const db = admin.firestore();

  try {
    // Cek player ada
    const playerSnap = await db.collection('players').doc(uid).get();
    if (!playerSnap.exists) {
      return res.status(404).json({ error: `Player ${uid} tidak ditemukan` });
    }

    // ── Step 1: Buat payment ──
    let createData, paymentId;

    const { ok: createOk, status: createStatus, data: createResp } = await piRequest(
      'https://api.minepi.com/v2/payments',
      {
        method: 'POST',
        body: JSON.stringify({
          payment: {
            amount: piAmount,
            memo: `Sagatama Games: ${reason || 'reward'}`,
            metadata: { uid, reason: reason || 'reward' },
            uid: piUid,
            payment_type: 'app_to_user'
          }
        })
      }
    );

    if (!createOk) {
      // ── Handle ongoing_payment_found: ada payment lama yang stuck ──
      if (createResp.error === 'ongoing_payment_found') {
        const stuckId = createResp.payment?.identifier;
        const stuckStatus = createResp.payment?.status;
        console.log(`[payout] Ada payment stuck: ${stuckId}, status:`, JSON.stringify(stuckStatus));

        if (!stuckId) {
          return res.status(400).json({ error: 'ongoing_payment_found tapi tidak ada identifier', detail: createResp });
        }

        // Kalau payment stuck sudah approved (belum completed) → kembalikan ke client
        // supaya client bisa langsung panggil /resolve-stuck tanpa cancel
        if (stuckStatus?.developer_approved && !stuckStatus?.developer_completed) {
          console.log(`[payout] Payment stuck sudah approved, kembalikan untuk di-resolve...`);
          await db.collection('payouts').doc(stuckId).set({
            status: 'approved',
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });

          return res.status(200).json({
            success: true,
            pending: true,
            message: 'Ada payment sebelumnya yang sudah approved, panggil /resolve-stuck untuk complete.',
            paymentId: stuckId,
            needsResolve: true
          });
        }

        // Payment stuck belum approved → cancel lalu buat baru
        console.log(`[payout] Payment stuck belum approved, coba cancel...`);
        const cancelled = await cancelPayment(stuckId);

        // Update Firestore status payment lama
        await db.collection('payouts').doc(stuckId).set({
          status: cancelled ? 'cancelled_auto' : 'cancel_failed',
          cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        if (!cancelled) {
          return res.status(400).json({
            error: 'Ada payment stuck yang tidak bisa dicancel. Coba panggil /cancel-stuck manual.',
            stuckPaymentId: stuckId
          });
        }

        // Retry create setelah cancel berhasil
        const { ok: retryOk, data: retryData } = await piRequest(
          'https://api.minepi.com/v2/payments',
          {
            method: 'POST',
            body: JSON.stringify({
              payment: {
                amount: piAmount,
                memo: `Sagatama Games: ${reason || 'reward'}`,
                metadata: { uid, reason: reason || 'reward' },
                uid: piUid,
                payment_type: 'app_to_user'
              }
            })
          }
        );

        if (!retryOk) {
          return res.status(400).json({ error: 'Gagal buat payment setelah cancel stuck', detail: retryData });
        }
        createData = retryData;

      } else {
        console.error(`[payout] Gagal buat payment (HTTP ${createStatus}):`, JSON.stringify(createResp));
        return res.status(400).json({ error: 'Gagal membuat payment', detail: createResp });
      }
    } else {
      createData = createResp;
    }

    paymentId = createData.identifier;
    console.log(`[payout] paymentId=${paymentId} piUid=${piUid} piAmount=${piAmount}`);

    // Simpan ke Firestore (pending)
    await db.collection('payouts').doc(paymentId).set({
      paymentId, uid, piUid, piAmount,
      reason: reason || 'reward',
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // ── Step 2: Approve ──
    const { ok: approveOk, data: approveData } = await piRequest(
      `https://api.minepi.com/v2/payments/${paymentId}/approve`,
      { method: 'POST' }
    );

    if (!approveOk) {
      if (approveData.error !== 'already_approved') {
        console.error(`[payout] Approve gagal:`, JSON.stringify(approveData));
        await updatePayoutStatus(db, paymentId, 'approve_failed', null);
        return res.status(400).json({ error: 'Approve gagal', detail: approveData });
      }
      console.log(`[payout] Already approved, lanjut...`);
    } else {
      console.log(`[payout] Approved: ${paymentId}`);
    }

    await updatePayoutStatus(db, paymentId, 'approved', null);

    // ── Step 3: Return paymentId ke client ──
    // Pi Platform akan submit ke blockchain secara async.
    // Client tunggu ~10-15 detik lalu panggil POST /api/payments/resolve-stuck
    // dengan body { paymentId } untuk complete payment.
    console.log(`[payout] ✅ Approved. Client harus panggil /resolve-stuck untuk complete.`);
    return res.status(200).json({
      success: true,
      pending: true,
      message: 'Payment approved. Tunggu ~15 detik lalu panggil /resolve-stuck untuk complete.',
      paymentId,
      piAmount
    });

  } catch (err) {
    console.error('[payout] ERROR:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

async function updatePayoutStatus(db, paymentId, status, txid) {
  const data = {
    status,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };
  if (txid) data.txid = txid;
  if (status === 'completed') data.completedAt = admin.firestore.FieldValue.serverTimestamp();
  try {
    await db.collection('payouts').doc(paymentId).set(data, { merge: true });
  } catch (e) {
    console.error(`[payout] Firestore update error:`, e.message);
  }
}
