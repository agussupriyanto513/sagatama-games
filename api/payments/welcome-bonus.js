// /api/payments/welcome-bonus.js
// A2U: Kirim Pi testnet ke user baru sebagai welcome bonus
// Dipanggil otomatis saat user pertama kali login via Pi Browser
// Syarat mainnet wallet: minimal 5 unique user harus menerima A2U payment
import { admin, getFirebaseApp } from '../../firebase-init.js';
getFirebaseApp();

const WELCOME_PI_AMOUNT = 0.01;   // jumlah Pi testnet yang dikirim
const WELCOME_SGT_BONUS = 50;     // SGT bonus yang dilaporkan ke client

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

// Cancel payment yang stuck
async function cancelPayment(paymentId) {
  try {
    const { ok, data } = await piRequest(
      `https://api.minepi.com/v2/payments/${paymentId}/cancel`,
      { method: 'POST', body: JSON.stringify({}) }
    );
    console.log(`[welcome-bonus] Cancel ${paymentId}:`, ok ? 'OK' : JSON.stringify(data));
    return ok;
  } catch (e) {
    console.warn(`[welcome-bonus] Cancel error:`, e.message);
    return false;
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

  const { uid, piUid } = req.body;
  if (!uid || !piUid) {
    return res.status(400).json({ error: 'uid dan piUid diperlukan' });
  }

  const db = admin.firestore();

  try {
    // ── Cek apakah sudah pernah dapat welcome bonus ──
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

    // ── Step 1: Buat payment ──
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
      // ── Handle ongoing_payment_found ──
      if (createResp.error === 'ongoing_payment_found') {
        const stuckId = createResp.payment?.identifier;
        const stuckStatus = createResp.payment?.status;
        console.log(`[welcome-bonus] Payment stuck: ${stuckId}`, JSON.stringify(stuckStatus));

        if (!stuckId) {
          return res.status(400).json({ error: 'ongoing_payment_found tanpa identifier', detail: createResp });
        }

        // Kalau stuck sudah approved → return paymentId untuk di-resolve client
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

        // Belum approved → cancel lalu buat baru
        console.log(`[welcome-bonus] Cancel stuck payment...`);
        const cancelled = await cancelPayment(stuckId);

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

        // Retry create setelah cancel
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

    // Simpan ke Firestore (pending)
    await db.collection('payouts').doc(paymentId).set({
      paymentId, uid, piUid,
      piAmount: WELCOME_PI_AMOUNT,
      type: 'welcome_bonus',
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

    // ── Step 3: Return ke client ──
    // Pi Platform submit ke blockchain secara async.
    // resolve-stuck akan dipanggil terpisah untuk complete.
    // Tandai welcomeBonusSent = true supaya tidak dobel
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
