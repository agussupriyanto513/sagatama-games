const BACKEND_URL = "https://sagatama-backend.vercel.app";

window.panggilAPI = async function(endpoint, body) {
  try {
    const auth = window.auth || (window.firebase && window.firebase.auth());
    const user = auth ? auth.currentUser : null;

    let idToken = "";
    
    if (user) {
      idToken = await user.getIdToken();
    } else {
      // Jika tidak terdeteksi login, kita suntik UID testing agar sistem tidak macet di frontend
      if (!body.uid) body.uid = "TES_USER_MANUAL"; 
    }

    // Pastikan parameter uid ikut terkirim ke backend
    if (user && !body.uid) {
      body.uid = user.uid;
    }

    // Eksekusi pengiriman data ke server Vercel
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
      // Jika Vercel menolak, langsung munculkan pesan eror dari server di layar HP
      alert("⚠️ Eror dari Server Vercel: " + (data.error || "Gagal memproses backend"));
      throw new Error(data.error || "Terjadi kesalahan pada server backend.");
    }

    return data;

  } catch (error) {
    // Perangkap Eror: Memaksa browser HP menampilkan kenapa data gagal terkirim
    alert("🚨 Kegagalan Sistem Frontend:\n" + error.message);
    throw error;
  }
}
