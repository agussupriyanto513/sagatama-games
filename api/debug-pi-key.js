// /api/debug-pi-key.js
// Endpoint diagnostik SEMENTARA — cek apakah PI_API_KEY di Vercel project
// ini valid dan diterima oleh server Pi Network, tanpa membuat payment
// sungguhan. TIDAK menampilkan key asli, hanya info non-sensitif.
//
// PENTING: hapus file ini setelah selesai debugging.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const rawKey = process.env.PI_API_KEY || '';

  const keyInfo = {
    length: rawKey.length,
    startsWithQuote: rawKey.startsWith('"') || rawKey.startsWith("'"),
    endsWithQuote: rawKey.endsWith('"') || rawKey.endsWith("'"),
    hasLeadingWhitespace: /^\s/.test(rawKey),
    hasTrailingWhitespace: /\s$/.test(rawKey),
    hasNewline: rawKey.includes('\n') || rawKey.includes('\r'),
    hasInternalSpace: /\s/.test(rawKey.trim()),
    first4: rawKey.slice(0, 4),
    last4: rawKey.slice(-4),
  };

  let piApiStatus = null;
  let piApiOk = false;
  let piApiBody = null;
  let fetchError = null;

  try {
    const resp = await fetch('https://api.minepi.com/v2/payments/incomplete_server_payments', {
      headers: { 'Authorization': `Key ${rawKey}` }
    });
    piApiStatus = resp.status;
    piApiOk = resp.ok;
    const text = await resp.text();
    try {
      piApiBody = JSON.parse(text);
    } catch {
      piApiBody = text.slice(0, 300);
    }
  } catch (e) {
    fetchError = e.message;
  }

  return res.status(200).json({
    keyInfo,
    piApiStatus,
    piApiOk,
    piApiBody,
    fetchError,
  });
}
