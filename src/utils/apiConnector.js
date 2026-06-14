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

    // Menggunakan BACKEND_URL secara absolut menuju server backend pusat
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
      alert("⚠️ Eror dari Server Backend: " + (data.error || "Gagal memproses"));
      throw new Error(data.error || "Terjadi kesalahan pada server backend.");
    }

    return data;

  } catch (error) {
    alert("🚨 Kegagalan Sistem Frontend:\n" + error.message);
    throw error;
  }
}
