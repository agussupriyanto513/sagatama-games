// /api/payments/index.js
// GABUNGAN semua endpoint payment (approve, cancel, cancel-stuck, complete,
// incomplete, payout, resolve-stuck, welcome-bonus) jadi SATU serverless
// function. Vercel Hobby plan cuma boleh maksimal 12 functions per deployment,
// jadi 8 file terpisah digabung di sini supaya hemat kuota function dan masih
// ada ruang untuk endpoint baru di masa depan.
//
// Router dipilih via query string ?action=... yang di-set otomatis oleh
// rewrite rules di vercel.json, jadi URL yang dipanggil frontend TIDAK
// berubah sama sekali (mis. /api/payments/approve tetap jalan seperti biasa).
import { admin, getFirebaseApp } from '../../firebase-init.js';
getFirebaseApp();

// ── Helper bersama: fetch ke Pi Platform API, handle response non-JSON ──
async function piRequest(url, options = {}) {
  // ── DEBUG SEMENTARA: cek apakah PI_API_KEY terbaca dengan benar ──
  // Aman ditampilkan di log karena cuma nunjukin panjang & beberapa
  // karakter pertama/terakhir, bukan key lengkap.
  const _key = process.env.PI_API_KEY || '';
  console.log(`[DEBUG] PI_API_KEY length=${_key.length} preview="${_key.slice(0, 4)}...${_key.slice(-4)}"`);

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

async function cancelPiPayment(paymentId, logTag) {
  try {
    const { ok, data } = await piRequest(
      `https://api.minepi.com/v2/payments/${paymentId}/cancel`,
      { method: 'POST', body: JSON.stringify({}) }
    );
    console.log(`[${logTag}] Cancel ${paymentId}:`, ok ? 'OK' : JSON.stringify(data));
    return ok;
  } catch (e) {
    console.warn(`[${logTag}] Cancel error:`, e.message);
    return false;
  }
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ══════════════════════════════════════════════════════════════════
// APPROVE — /api/payments/approve
// ══════════════════════════════════════════════════════════════════
async function handleApprove(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { paymentId, uid, sgtAmount } = req.body;
  if (!paymentId) return res.status(400).json({ error: 'paymentId diperlukan' });

  const saveToFirestore = (status, errorMsg) => {
    const db = admin.firestore();
    const data = {
      paymentId, uid: uid || null, sgtAmount: sgtAmount || 0,
      type: 'topup_sgt', status,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    if (errorMsg) data.error = errorMsg;
    db.collection('pi_payments').doc(paymentId)
      .set({ ...data, createdAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
      .then(() => console.log(`[approve] ✅ Firestore: ${paymentId} → ${status}`))
      .catch(e => console.error(`[approve] Firestore error:`, e.message));
  };

  try {
    // ── DEBUG SEMENTARA: cek apakah PI_API_KEY terbaca dengan benar ──
    const _key = process.env.PI_API_KEY || '';
    console.log(`[DEBUG-approve] PI_API_KEY length=${_key.length} preview="${_key.slice(0, 4)}...${_key.slice(-4)}"`);
    console.log(`[DEBUG-approve] FIREBASE_PROJECT_ID="${process.env.FIREBASE_PROJECT_ID || '(kosong)'}"`);

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
      console.error(`[approve] Pi API gagal:`, piData);
      saveToFirestore('approval_failed', JSON.stringify(piData));
      return res.status(400).json({ error: 'Pi approval failed', detail: piData });
    }

    res.status(200).json({ success: true, ...piData });
    saveToFirestore('approved', null);

  } catch (err) {
    console.error('[approve] ERROR:', err.message);
    saveToFirestore('approval_error', err.message);
    return res.status(500).json({ error: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════
// CANCEL — /api/payments/cancel
// ══════════════════════════════════════════════════════════════════
async function handleCancel(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { paymentId } = req.body;
  if (!paymentId) {
    return res.status(400).json({ error: 'paymentId diperlukan' });
  }

  try {
    const response = await fetch(
      `https://api.minepi.com/v2/payments/${paymentId}/cancel`,
      {
        method:  'POST',
        headers: {
          'Authorization': `Key ${process.env.PI_API_KEY}`,
          'Content-Type':  'application/json'
        }
      }
    );

    const db = admin.firestore();
    await db.collection('pi_payments').doc(paymentId).set({
      status:      'cancelled',
      cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt:   admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    if (response.ok) {
      console.log(`[cancel] Payment ${paymentId} dibatalkan`);
      return res.status(200).json({ success: true });
    } else {
      const error = await response.text();
      return res.status(500).json({ error });
    }
  } catch (error) {
    console.error('[cancel]', error.message);
    return res.status(500).json({ error: error.message });
  }
}

// ══════════════════════════════════════════════════════════════════
// CANCEL-STUCK — /api/payments/cancel-stuck
// ══════════════════════════════════════════════════════════════════
async function handleCancelStuck(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const paymentId = req.body?.paymentId;
  if (!paymentId) {
    return res.status(400).json({ error: 'paymentId wajib diisi' });
  }

  console.log(`[cancel-stuck] Mencoba cancel paymentId: ${paymentId}`);

  try {
    const { ok, data: payment } = await piRequest(
      `https://api.minepi.com/v2/payments/${paymentId}`
    );

    if (!ok) {
      return res.status(400).json({ error: 'Payment tidak ditemukan', detail: payment });
    }

    console.log(`[cancel-stuck] Status saat ini:`, JSON.stringify(payment.status));

    if (payment.status?.developer_completed) {
      return res.status(200).json({ message: 'Payment sudah completed, tidak perlu cancel', paymentId });
    }

    if (payment.status?.cancelled || payment.status?.user_cancelled) {
      return res.status(200).json({ message: 'Payment sudah cancelled sebelumnya', paymentId });
    }

    const { ok: cancelOk, status: cancelStatus, data: cancelData } = await piRequest(
      `https://api.minepi.com/v2/payments/${paymentId}/cancel`,
      { method: 'POST', body: JSON.stringify({}) }
    );

    console.log(`[cancel-stuck] Cancel response (HTTP ${cancelStatus}):`, JSON.stringify(cancelData));

    if (!cancelOk) {
      return res.status(400).json({ error: 'Cancel gagal', detail: cancelData });
    }

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

// ══════════════════════════════════════════════════════════════════
// COMPLETE — /api/payments/complete
// ══════════════════════════════════════════════════════════════════
async function handleComplete(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { paymentId, txid, uid, sgtAmount } = req.body;

  if (!paymentId || !txid) {
    return res.status(400).json({ error: 'paymentId dan txid diperlukan' });
  }

  const db = admin.firestore();

  try {
    const payRef = db.collection('pi_payments').doc(paymentId);
    const paySnap = await payRef.get();

    if (paySnap.exists && paySnap.data().status === 'completed') {
      console.log(`[complete] Payment ${paymentId} sudah selesai sebelumnya`);
      return res.status(200).json({ success: true, alreadyCompleted: true });
    }

    const response = await fetch(
      `https://api.minepi.com/v2/payments/${paymentId}/complete`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Key ${process.env.PI_API_KEY}`,
          'Content-Type':  'application/json'
        },
        body: JSON.stringify({ txid })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      await payRef.set({
        paymentId, txid, uid, sgtAmount,
        status:    'complete_failed',
        error:     JSON.stringify(data),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      return res.status(400).json({ error: 'Pi complete failed', detail: data });
    }

    const sgt = parseInt(sgtAmount) || 0;
    if (uid && sgt > 0) {
      const playerRef = db.collection('players').doc(uid);
      await db.runTransaction(async (t) => {
        const playerSnap = await t.get(playerRef);
        if (!playerSnap.exists) {
          throw new Error(`Player ${uid} tidak ditemukan`);
        }
        const currentBalance = parseFloat(playerSnap.data().sgtBalance) || 0;
        t.update(playerRef, {
          sgtBalance: currentBalance + sgt,
          updatedAt:  admin.firestore.FieldValue.serverTimestamp()
        });
      });

      await db.collection('topup_history').add({
        uid,
        paymentId,
        txid,
        sgtAmount: sgt,
        piAmount:  sgt / 100,
        type:      'topup_sgt',
        status:    'success',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    await payRef.set({
      paymentId, txid, uid, sgtAmount: sgt,
      type:      'topup_sgt',
      status:    'completed',
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt:   admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    console.log(`[complete] Payment ${paymentId} selesai, +${sgt} SGT untuk uid=${uid}`);
    return res.status(200).json({ success: true, sgtAdded: sgt });

  } catch (err) {
    console.error('[complete]', err.message);
    try {
      await db.collection('pi_payments').doc(paymentId).set({
        status: 'error', error: err.message,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } catch(_) {}
    return res.status(500).json({ error: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════
// INCOMPLETE — /api/payments/incomplete
// ══════════════════════════════════════════════════════════════════
async function incompleteCompleteOnPi(paymentId, txid) {
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

async function incompleteCancelOnPi(paymentId) {
  try {
    const r = await fetch(`https://api.minepi.com/v2/payments/${paymentId}/cancel`, {
      method: 'POST',
      headers: { 'Authorization': `Key ${process.env.PI_API_KEY}`, 'Content-Type': 'application/json' }
    });
    const d = await r.json();
    r.ok ? console.log(`[incomplete] ✅ Cancel OK ${paymentId}`) : console.warn(`[incomplete] Cancel gagal:`, d);
  } catch(e) { console.warn(`[incomplete] Cancel error:`, e.message); }
}

async function incompleteCreditSGT(uid, sgtAmount, paymentId) {
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

async function handleIncomplete(req, res) {
  setCors(res);
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
      await incompleteCompleteOnPi(paymentId, piPayment.transaction?.txid);

      const sgtAmount = piPayment.metadata?.sgtAmount || 0;
      const uid       = piPayment.metadata?.uid || null;
      if (uid && sgtAmount > 0) await incompleteCreditSGT(uid, sgtAmount, paymentId);

      return res.status(200).json({ action: 'completed', paymentId });
    }

    if (!status.developer_approved || (status.developer_approved && !status.transaction_verified)) {
      console.log(`[incomplete] Belum verified → cancel`);
      await incompleteCancelOnPi(paymentId);
      return res.status(200).json({ action: 'cancelled', paymentId });
    }

    return res.status(200).json({ action: 'none', paymentId });

  } catch (err) {
    console.error('[incomplete] ERROR:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════
// PAYOUT — /api/payments/payout
// ══════════════════════════════════════════════════════════════════
async function payoutUpdateStatus(db, paymentId, status, txid) {
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

async function handlePayout(req, res) {
  setCors(res);
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
    const playerSnap = await db.collection('players').doc(uid).get();
    if (!playerSnap.exists) {
      return res.status(404).json({ error: `Player ${uid} tidak ditemukan` });
    }

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
      if (createResp.error === 'ongoing_payment_found') {
        const stuckId = createResp.payment?.identifier;
        const stuckStatus = createResp.payment?.status;
        console.log(`[payout] Ada payment stuck: ${stuckId}, status:`, JSON.stringify(stuckStatus));

        if (!stuckId) {
          return res.status(400).json({ error: 'ongoing_payment_found tapi tidak ada identifier', detail: createResp });
        }

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

        console.log(`[payout] Payment stuck belum approved, coba cancel...`);
        const cancelled = await cancelPiPayment(stuckId, 'payout');

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

    await db.collection('payouts').doc(paymentId).set({
      paymentId, uid, piUid, piAmount,
      reason: reason || 'reward',
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    const { ok: approveOk, data: approveData } = await piRequest(
      `https://api.minepi.com/v2/payments/${paymentId}/approve`,
      { method: 'POST' }
    );

    if (!approveOk) {
      if (approveData.error !== 'already_approved') {
        console.error(`[payout] Approve gagal:`, JSON.stringify(approveData));
        await payoutUpdateStatus(db, paymentId, 'approve_failed', null);
        return res.status(400).json({ error: 'Approve gagal', detail: approveData });
      }
      console.log(`[payout] Already approved, lanjut...`);
    } else {
      console.log(`[payout] Approved: ${paymentId}`);
    }

    await payoutUpdateStatus(db, paymentId, 'approved', null);

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

// ══════════════════════════════════════════════════════════════════
// RESOLVE-STUCK — /api/payments/resolve-stuck
// ══════════════════════════════════════════════════════════════════
async function handleResolveStuck(req, res) {
  setCors(res);
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
    console.log(`[resolve-stuck] Step 1: GET payment status...`);
    const { ok, status: httpStatus, data: payment } = await piRequest(
      `https://api.minepi.com/v2/payments/${paymentId}`
    );

    console.log(`[resolve-stuck] Payment status (HTTP ${httpStatus}):`, JSON.stringify(payment.status));
    console.log(`[resolve-stuck] Transaction:`, JSON.stringify(payment.transaction));

    if (!ok) {
      return res.status(400).json({ error: 'Payment tidak ditemukan', detail: payment });
    }

    if (payment.status?.developer_completed) {
      return res.status(200).json({
        success: true,
        alreadyDone: true,
        paymentId,
        txid: payment.transaction?.txid
      });
    }

    if (payment.status?.cancelled || payment.status?.user_cancelled) {
      return res.status(400).json({ error: 'Payment sudah cancelled', paymentId });
    }

    let txid = payment.transaction?.txid;

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

    console.log(`[resolve-stuck] Step 3: Complete dengan txid: ${txid}`);
    const { ok: completeOk, status: completeStatus, data: completeData } = await piRequest(
      `https://api.minepi.com/v2/payments/${paymentId}/complete`,
      { method: 'POST', body: JSON.stringify({ txid }) }
    );

    console.log(`[resolve-stuck] Complete (HTTP ${completeStatus}):`, JSON.stringify(completeData));

    if (!completeOk) {
      return res.status(400).json({ error: 'Complete gagal', detail: completeData });
    }

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

// ══════════════════════════════════════════════════════════════════
// WELCOME-BONUS — /api/payments/welcome-bonus
// ══════════════════════════════════════════════════════════════════
const WELCOME_PI_AMOUNT = 0.01;
const WELCOME_SGT_BONUS = 50;

async function handleWelcomeBonus(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.PI_API_KEY) {
    return res.status(500).json({ error: 'PI_API_KEY belum diset' });
  }

  const { uid, piUid } = req.body;
  if (!uid || !piUid) {
    return res.status(400).json({ error: 'uid dan piUid diperlukan' });
  }

  const db = admin.firestore();

  try {
    const playerRef = db.collection('players').doc(uid);
    const playerSnap = await playerRef.get();

    if (!playerSnap.exists) {
      return res.status(404).json({ error: `Player ${uid} tidak ditemukan` });
    }

    if (playerSnap.data().welcomeBonusSent === true) {
      console.log(`[welcome-bonus] User ${uid} sudah pernah dapat bonus, skip.`);
      return res.status(200).json({ alreadySent: true });
    }

    console.log(`[welcome-bonus] Kirim bonus ke uid=${uid} piUid=${piUid}`);

    let createData;

    const { ok: createOk, status: createStatus, data: createResp } = await piRequest(
      'https://api.minepi.com/v2/payments',
      {
        method: 'POST',
        body: JSON.stringify({
          payment: {
            amount: WELCOME_PI_AMOUNT,
            memo: 'Sagatama Games: Welcome Bonus',
            metadata: { uid, type: 'welcome_bonus' },
            uid: piUid,
            payment_type: 'app_to_user'
          }
        })
      }
    );

    if (!createOk) {
      if (createResp.error === 'ongoing_payment_found') {
        const stuckId = createResp.payment?.identifier;
        const stuckStatus = createResp.payment?.status;
        console.log(`[welcome-bonus] Payment stuck: ${stuckId}`, JSON.stringify(stuckStatus));

        if (!stuckId) {
          return res.status(400).json({ error: 'ongoing_payment_found tanpa identifier', detail: createResp });
        }

        if (stuckStatus?.developer_approved && !stuckStatus?.developer_completed) {
          console.log(`[welcome-bonus] Stuck sudah approved, kembalikan untuk resolve...`);
          await db.collection('payouts').doc(stuckId).set({
            status: 'approved',
            uid, piUid,
            type: 'welcome_bonus',
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });

          return res.status(200).json({
            success: true,
            pending: true,
            needsResolve: true,
            paymentId: stuckId,
            piAmount: WELCOME_PI_AMOUNT,
            sgtBonus: WELCOME_SGT_BONUS,
            message: 'Payment sudah approved. Panggil /resolve-stuck untuk complete.'
          });
        }

        console.log(`[welcome-bonus] Cancel stuck payment...`);
        const cancelled = await cancelPiPayment(stuckId, 'welcome-bonus');

        await db.collection('payouts').doc(stuckId).set({
          status: cancelled ? 'cancelled_auto' : 'cancel_failed',
          cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        if (!cancelled) {
          return res.status(400).json({
            error: 'Payment stuck tidak bisa dicancel',
            stuckPaymentId: stuckId,
            suggestion: 'Tunggu beberapa jam atau cancel manual di Pi Developer Portal'
          });
        }

        const { ok: retryOk, data: retryData } = await piRequest(
          'https://api.minepi.com/v2/payments',
          {
            method: 'POST',
            body: JSON.stringify({
              payment: {
                amount: WELCOME_PI_AMOUNT,
                memo: 'Sagatama Games: Welcome Bonus',
                metadata: { uid, type: 'welcome_bonus' },
                uid: piUid,
                payment_type: 'app_to_user'
              }
            })
          }
        );

        if (!retryOk) {
          return res.status(400).json({ error: 'Gagal buat payment setelah cancel', detail: retryData });
        }
        createData = retryData;

      } else {
        console.error(`[welcome-bonus] Gagal buat payment (HTTP ${createStatus}):`, JSON.stringify(createResp));
        return res.status(400).json({ error: 'Gagal membuat payment', detail: createResp });
      }
    } else {
      createData = createResp;
    }

    const paymentId = createData.identifier;
    console.log(`[welcome-bonus] paymentId=${paymentId}`);

    await db.collection('payouts').doc(paymentId).set({
      paymentId, uid, piUid,
      piAmount: WELCOME_PI_AMOUNT,
      type: 'welcome_bonus',
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    const { ok: approveOk, data: approveData } = await piRequest(
      `https://api.minepi.com/v2/payments/${paymentId}/approve`,
      { method: 'POST' }
    );

    if (!approveOk) {
      if (approveData.error !== 'already_approved') {
        console.error(`[welcome-bonus] Approve gagal:`, JSON.stringify(approveData));
        await db.collection('payouts').doc(paymentId).set({
          status: 'approve_failed',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        return res.status(400).json({ error: 'Approve gagal', detail: approveData });
      }
      console.log(`[welcome-bonus] Already approved, lanjut...`);
    } else {
      console.log(`[welcome-bonus] Approved: ${paymentId}`);
    }

    await db.collection('payouts').doc(paymentId).set({
      status: 'approved',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    await playerRef.set({
      welcomeBonusSent: true,
      welcomeBonusPaymentId: paymentId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    console.log(`[welcome-bonus] ✅ Approved. uid=${uid} paymentId=${paymentId}`);
    return res.status(200).json({
      success: true,
      pending: true,
      paymentId,
      piAmount: WELCOME_PI_AMOUNT,
      sgtBonus: WELCOME_SGT_BONUS,
      message: 'Welcome bonus approved! Pi sedang diproses blockchain.'
    });

  } catch (err) {
    console.error('[welcome-bonus] ERROR:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════
// ROUTER — dipilih via ?action= dari vercel.json rewrites
// ══════════════════════════════════════════════════════════════════
const ACTIONS = {
  'approve':        handleApprove,
  'cancel':         handleCancel,
  'cancel-stuck':   handleCancelStuck,
  'complete':       handleComplete,
  'incomplete':     handleIncomplete,
  'payout':         handlePayout,
  'resolve-stuck':  handleResolveStuck,
  'welcome-bonus':  handleWelcomeBonus
};

export default async function handler(req, res) {
  const action = req.query?.action;
  const fn = ACTIONS[action];

  if (!fn) {
    return res.status(404).json({ error: `Unknown payments action: ${action}` });
  }

  return fn(req, res);
}
