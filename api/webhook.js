export default async function handler(req, res) {
  try {
    // Handshake: echo X-Hook-Secret and return 200 immediately (no Google Sheets interaction)
    const hookSecret = req.headers['x-hook-secret'];
    if (hookSecret) {
      res.setHeader('X-Hook-Secret', hookSecret);
      res.statusCode = 200;
      res.end('Handshake OK (temporary)');
      return;
    }

    // For event POSTs, accept and return 200 quickly. You may process events later.
    res.statusCode = 200;
    res.end('Event received (temporary)');
  } catch (err) {
    console.error('Temporary webhook error:', err);
    res.statusCode = 500;
    res.end('Internal error');
  }
}
