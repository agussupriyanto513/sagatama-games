// /api/debug-env.js
// FILE SEMENTARA UNTUK DEBUG — HAPUS SETELAH SELESAI
export default async function handler(req, res) {
  const key = process.env.FIREBASE_PRIVATE_KEY || '';
  
  res.status(200).json({
    // Cek karakter pertama dan terakhir
    starts_with: key.substring(0, 40),
    ends_with:   key.substring(key.length - 40),
    length:      key.length,
    
    // Cek apakah newline nyata ada atau masih literal \n
    has_real_newlines:    key.includes('\n'),
    has_literal_backslash_n: key.includes('\\n'),
    
    // Hitung berapa baris
    line_count: key.split('\n').length,
    
    // Cek env lain
    has_project_id:   !!process.env.FIREBASE_PROJECT_ID,
    has_client_email: !!process.env.FIREBASE_CLIENT_EMAIL,
    has_pi_api_key:   !!process.env.PI_API_KEY,
    
    project_id:   process.env.FIREBASE_PROJECT_ID || 'KOSONG',
    client_email: process.env.FIREBASE_CLIENT_EMAIL || 'KOSONG',
  });
}
