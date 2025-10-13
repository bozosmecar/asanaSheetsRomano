// Minimal test endpoint to verify Vercel routing and Asana handshake behavior
// Responds 200 and echoes back X-Hook-Secret header if present

module.exports = (req, res) => {
  try {
    const hookSecret = req.headers['x-hook-secret'];
    if (hookSecret) {
      res.setHeader('X-Hook-Secret', hookSecret);
    }
    res.statusCode = 200;
    res.end('pong');
  } catch (err) {
    console.error('ping error', err);
    res.statusCode = 500;
    res.end('error');
  }
};
