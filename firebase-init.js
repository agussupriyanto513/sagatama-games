// firebase-init.js — taruh di root project, import dari semua API handler
import admin from "firebase-admin";

function getFirebaseApp() {
  // ── DEBUG SEMENTARA: selalu print, baik warm maupun cold start ──
  const _pk = process.env.FIREBASE_PRIVATE_KEY || '';
  const _ce = process.env.FIREBASE_CLIENT_EMAIL || '';
  const _pid = process.env.FIREBASE_PROJECT_ID || '';
  console.log(`[DEBUG-firebase-init] alreadyInitialized=${admin.apps.length > 0} projectId="${_pid || '(KOSONG)'}" clientEmail_length=${_ce.length} privateKey_length=${_pk.length} privateKey_hasBeginMarker=${_pk.includes('BEGIN PRIVATE KEY')}`);

  if (admin.apps.length) return admin.apps[0];

  // Decode private key — handle semua kemungkinan format Vercel
  let privateKey = _pk;
  
  // Hapus tanda kutip di awal/akhir jika ada
  privateKey = privateKey.replace(/^["']|["']$/g, '');
  
  // Ganti literal \n dengan newline asli
  privateKey = privateKey.replace(/\\n/g, '\n');

  // Hapus tanda kutip di project_id jika ada  
  const projectId = _pid.replace(/^["']|["']$/g, '');
  const clientEmail = _ce.replace(/^["']|["']$/g, '');

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
