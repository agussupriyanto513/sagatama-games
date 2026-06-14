const BACKEND_URL = "https://sagatama-backend.vercel.app";

// Kita buat fungsi ini menempel ke jendela browser (window) agar bisa dipanggil dari HTML
window.panggilAPI = async function(endpoint, body) {
  // Mengambil Firebase Auth yang sudah di-init di file firebase-init.js kamu
  const auth = window.auth || (window.firebase && window.firebase.auth());
  if (!auth) throw new Error("Firebase Auth tidak ditemukan.");

  const user = auth.currentUser;
  if (!user) throw new Error("User belum login atau session habis.");

  // 1. Ambil ID Token dari user Pi / Firebase
  // Jika pakai Firebase SDK v9+ pake user.getIdToken(), jika v8 pake user.getIdToken() juga aman
  const idToken = await user.getIdToken();

  // 2. Tembak ke server pusat di Vercel
  const res = await fetch(`${BACKEND_URL}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${idToken}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || "Terjadi kesalahan pada server backend.");
  }

  return data;
}
