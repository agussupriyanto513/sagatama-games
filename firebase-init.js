// firebase-init.js — taruh di root project, import dari semua API handler
import admin from "firebase-admin";

function getFirebaseApp() {
  if (admin.apps.length) return admin.apps[0];

  // Decode private key — handle semua kemungkinan format Vercel
  let privateKey = process.env.FIREBASE_PRIVATE_KEY || '';
  
  // Hapus tanda kutip di awal/akhir jika ada
  privateKey = privateKey.replace(/^["']|["']$/g, '');
  
  // Ganti literal \n dengan newline asli
  privateKey = privateKey.replace(/\\n/g, '\n');

  // Hapus tanda kutip di project_id jika ada  
  const projectId = (process.env.FIREBASE_PROJECT_ID || '').replace(/^["']|["']$/g, '');
  const clientEmail = (process.env.FIREBASE_CLIENT_EMAIL || '').replace(/^["']|["']$/g, '');

  // ── DEBUG SEMENTARA: cek env var mana yang kosong ──
  console.log(`[DEBUG-firebase-init] projectId="${projectId || '(KOSONG)'}" clientEmail_length=${clientEmail.length} privateKey_length=${privateKey.length} privateKey_hasBeginMarker=${privateKey.includes('BEGIN PRIVATE KEY')}`);

  return admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey })
  });
}

// Verifikasi Firebase ID token dari header Authorization: Bearer <token>
// Mengembalikan decoded token (berisi uid asli) atau null jika tidak valid.
// Dipakai supaya endpoint pembayaran tidak bisa "dipalsukan" dengan mengirim
// uid siapa saja lewat body request.
async function verifyAuth(req) {
  try {
    const header = req.headers.authorization || '';
    const match = header.match(/^Bearer (.+)$/);
    if (!match) return null;
    const token = match[1].trim();
    if (!token) return null;
    getFirebaseApp();
    const decoded = await admin.auth().verifyIdToken(token);
    return decoded; // decoded.uid = Firebase UID asli si pemanggil
  } catch (e) {
    console.warn('[verifyAuth] Token tidak valid:', e.message);
    return null;
  }
}

export { admin, getFirebaseApp, verifyAuth };
