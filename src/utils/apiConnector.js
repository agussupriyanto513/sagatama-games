import { getAuth } from "firebase/auth";

const BACKEND_URL = "https://sagatama-backend.vercel.app";

async function panggilAPI(endpoint, body) {
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) throw new Error("User belum login atau session habis.");

  // 1. Ambil ID Token dari user yang sedang login (ini otomatis memverifikasi bahwa dia user sah)
  const idToken = await user.getIdToken();

  // 2. Tembak ke server pusat di Vercel
  const res = await fetch(`${BACKEND_URL}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${idToken}`, // Dikirim lewat header sebagai satpam keamanan
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || "Terjadi kesalahan pada server backend.");
  }

  return data;
}