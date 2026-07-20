// /api/debug-firebase.js
// Endpoint diagnostik SEMENTARA — cek apakah kredensial Firebase Admin
// (FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY)
// di Vercel project INI (Sagatama Games) valid dan bisa dipakai untuk
// baca/tulis Firestore. TIDAK menampilkan private key asli, hanya info
// non-sensitif (panjang, awalan/akhiran, dsb).
//
// PENTING: hapus file ini (atau tambahkan proteksi) setelah selesai
// debugging, supaya tidak jadi endpoint publik permanen.
import { admin, getFirebaseApp } from '../firebase-init.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const rawKey = process.env.FIREBASE_PRIVATE_KEY || '';
  const projectId = process.env.FIREBASE_PROJECT_ID || '';
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL || '';

  const envInfo = {
    FIREBASE_PROJECT_ID: projectId || '(KOSONG)',
    FIREBASE_CLIENT_EMAIL: clientEmail
      ? clientEmail.replace(/^(.{6}).+(@.+)$/, '$1***$2')
      : '(KOSONG)',
    FIREBASE_PRIVATE_KEY_length: rawKey.length,
    FIREBASE_PRIVATE_KEY_startsWithQuote: rawKey.startsWith('"'),
    FIREBASE_PRIVATE_KEY_hasLiteralBackslashN: rawKey.includes('\\n'),
    FIREBASE_PRIVATE_KEY_hasRealNewline: rawKey.includes('\n'),
    FIREBASE_PRIVATE_KEY_startsCorrectly: rawKey
      .replace(/^["']/, '')
      .startsWith('-----BEGIN PRIVATE KEY-----'),
    FIREBASE_PRIVATE_KEY_endsCorrectly: rawKey
      .replace(/["']$/, '')
      .trim()
      .endsWith('-----END PRIVATE KEY-----'),
  };

  let initOk = false;
  let initError = null;
  let firestoreOk = false;
  let firestoreError = null;

  try {
    getFirebaseApp();
    initOk = true;
  } catch (e) {
    initError = e.message;
  }

  if (initOk) {
    try {
      const db = admin.firestore();
      await db.collection('_debug').doc('ping').set({
        ts: admin.firestore.FieldValue.serverTimestamp(),
      });
      await db.collection('_debug').doc('ping').get();
      firestoreOk = true;
    } catch (e) {
      firestoreError = e.message;
    }
  }

  return res.status(200).json({
    envInfo,
    initOk,
    initError,
    firestoreOk,
    firestoreError,
  });
}
