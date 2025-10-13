export default function handler(req, res) {
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
}
