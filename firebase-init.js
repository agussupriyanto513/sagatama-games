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

  return admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey })
  });
}

export { admin, getFirebaseApp };
