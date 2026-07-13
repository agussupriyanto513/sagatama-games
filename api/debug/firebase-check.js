// /api/debug/firebase-check.js
// ENDPOINT DIAGNOSTIK SEMENTARA — bukan untuk fitur aplikasi.
// Tujuan: memastikan FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY
// di Vercel sudah benar formatnya, TANPA membocorkan isi rahasianya.
// Buka lewat browser: https://sagatama-games.vercel.app/api/debug/firebase-check
//
// ⚠️ PENTING: HAPUS file ini (dan folder api/debug/) setelah masalah login selesai,
// supaya tidak ada endpoint diagnostik yang menempel permanen di production.

import { admin, getFirebaseApp } from "../../firebase-init.js";

function maskEmail(email) {
  if (!email) return null;
  const [user, domain] = email.split('@');
  if (!domain) return email.slice(0, 3) + '***';
  return user.slice(0, 4) + '***@' + domain;
}

function inspectPrivateKeyRaw() {
  const raw = process.env.FIREBASE_PRIVATE_KEY || '';
  return {
    exists: !!raw,
    length: raw.length,
    startsWithQuote: raw.startsWith('"') || raw.startsWith("'"),
    endsWithQuote: raw.endsWith('"') || raw.endsWith("'"),
    containsLiteralBackslashN: raw.includes('\\n'),
    containsRealNewline: raw.includes('\n'),
    startsCorrectly: raw.replace(/^["']/, '').startsWith('-----BEGIN PRIVATE KEY-----'),
    endsCorrectly: raw.replace(/["']$/, '').trim().endsWith('-----END PRIVATE KEY-----'),
    first20Chars: raw.slice(0, 20),
    last20Chars: raw.slice(-20),
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  const result = {
    step: 'start',
    env: {
      FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID
        ? process.env.FIREBASE_PROJECT_ID.replace(/^["']|["']$/g, '')
        : null,
      FIREBASE_CLIENT_EMAIL_masked: maskEmail(
        (process.env.FIREBASE_CLIENT_EMAIL || '').replace(/^["']|["']$/g, '')
      ),
      FIREBASE_PRIVATE_KEY_raw_inspection: inspectPrivateKeyRaw(),
    },
  };

  try {
    result.step = 'init_admin_app';
    getFirebaseApp();
    result.adminAppInitialized = true;

    result.step = 'create_custom_token (local signing only, no Google network call)';
    const testToken = await admin.auth().createCustomToken('diag_test_uid');
    result.customTokenCreated = !!testToken;

    result.step = 'parse_private_key_with_node_crypto (structural PEM validity check)';
    const crypto = await import('node:crypto');
    let privateKey = process.env.FIREBASE_PRIVATE_KEY || '';
    privateKey = privateKey.replace(/^["']|["']$/g, '').replace(/\\n/g, '\n');
    crypto.createPrivateKey(privateKey); // throws if PEM is structurally broken
    result.privateKeyPemValid = true;

    result.step = 'exchange_credential_for_google_oauth_token (THIS is where a wrong/revoked/mismatched key fails)';
    const app = getFirebaseApp();
    const tokenResult = await app.options.credential.getAccessToken();
    result.oauthTokenObtained = !!tokenResult.access_token;
    result.oauthTokenExpiresInSeconds = tokenResult.expires_in;

    result.step = 'firestore_read (REQUIRES valid OAuth to Google servers)';
    const snap = await admin.firestore().collection('_diagnostic_ping').limit(1).get();
    result.firestoreReadOk = true;
    result.firestoreDocsSeen = snap.size;

    result.success = true;
    result.message = '✅ Semua kredensial Firebase Admin valid dan bisa akses Firestore.';
    return res.status(200).json(result);

  } catch (err) {
    result.success = false;
    result.failedAtStep = result.step;
    result.errorMessage = err.message;
    result.errorCode = err.code || null;
    return res.status(500).json(result);
  }
}
