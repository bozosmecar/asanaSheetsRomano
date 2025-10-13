// Vercel supports CommonJS handlers that accept (req, res)
// We'll export a handler compatible with both Vercel and local testing.

const crypto = require('node:crypto');
const {
  handleWebhookEvent,
  storeWebhookSecret,
  getWebhookSecrets,
} = require('../src/config/webhookHandler');
const { getGoogleSheetsClient } = require('../src/config/googleSheets');

// Helper to safely parse body for serverless envs (no external deps)
async function parseRequestBody(req) {
  if (req.body) return req.body;

  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        // If JSON.parse fails, return an empty object to avoid crashing
        resolve({});
      }
    });
    req.on('error', (err) => reject(err));
  });
}

module.exports = async (req, res) => {
  try {
    // Vercel passes url with query string on req.url
    const url = new URL(req.url, `https://${req.headers.host || 'vercel.app'}`);
    const spreadsheetId = url.searchParams.get('sheetId');

    if (!spreadsheetId) {
      res.statusCode = 400;
      res.end('Missing sheetId query parameter');
      return;
    }

    const sheets = await getGoogleSheetsClient();

    const body = await parseRequestBody(req);

    // Handshake
    const hookSecret = req.headers['x-hook-secret'];
    if (hookSecret) {
      const webhookId = body.data?.id;
      try {
        await storeWebhookSecret(sheets, webhookId, hookSecret, spreadsheetId);
        res.setHeader('X-Hook-Secret', hookSecret);
        res.statusCode = 200;
        res.end('Webhook handshake completed');
        return;
      } catch (err) {
        console.error('Failed to store webhook secret:', err);
        res.statusCode = 500;
        res.end('Failed to store webhook secret');
        return;
      }
    }

    // Event processing - verify signature
    const signature = req.headers['x-hook-signature'];
    if (!signature) {
      res.statusCode = 400;
      res.end('Missing required webhook headers');
      return;
    }

    const bodyString = JSON.stringify(body);

    let webhookSecrets;
    try {
      webhookSecrets = await getWebhookSecrets(sheets, spreadsheetId);
    } catch (err) {
      console.error('Failed to retrieve webhook secrets:', err);
      res.statusCode = 500;
      res.end('Failed to verify webhook signature');
      return;
    }

    let isValid = false;
    for (const [secret] of webhookSecrets) {
      const computed = crypto.createHmac('SHA256', secret).update(bodyString).digest('hex');
      if (computed === signature) {
        isValid = true;
        break;
      }
    }

    if (!isValid) {
      res.statusCode = 401;
      res.end('Invalid webhook signature');
      return;
    }

    // Respond quickly then process events asynchronously
    res.statusCode = 200;
    res.end('OK');

    // Process events without blocking response
    if (body.events && Array.isArray(body.events)) {
      (async () => {
        for (const event of body.events) {
          try {
            await handleWebhookEvent(event, spreadsheetId);
          } catch (err) {
            console.error('Error processing event:', err);
          }
        }
      })();
    }
  } catch (error) {
    console.error('Webhook function error:', error);
    try {
      res.statusCode = 500;
      res.end('Internal server error');
    } catch (e) {
      // Ignore
    }
  }
};
