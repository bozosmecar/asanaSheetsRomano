import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loadCredentials() {
  if (process.env.GOOGLE_SHEETS_CREDENTIALS) {
    try {
      return JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS);
    } catch (err) {
      console.error('Invalid GOOGLE_SHEETS_CREDENTIALS JSON:', err.message);
      throw err;
    }
  }

  const fallback = path.join(__dirname, '..', 'asanaromano-cbfe64665e8e.json');
  try {
    const raw = await fs.readFile(fallback, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    throw new Error('No Google Sheets credentials found in env or local file');
  }
}

async function persistHookSecret(sheetId, webhookId, secret) {
  try {
    const creds = await loadCredentials();
    if (!creds.client_email || !creds.private_key) throw new Error('Invalid credentials');

    const client = new google.auth.JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive.file',
      ],
    });
    await client.authorize();
    const sheets = google.sheets({ version: 'v4', auth: client });

    // Ensure webhook_secrets sheet exists
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    const hasSecrets = meta.data.sheets.some((s) => s.properties.title === 'webhook_secrets');
    if (!hasSecrets) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        resource: {
          requests: [
            { addSheet: { properties: { title: 'webhook_secrets', hidden: true } } },
          ],
        },
      });
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: 'webhook_secrets!A1:B1',
        valueInputOption: 'RAW',
        resource: { values: [['webhook_id', 'secret']] },
      });
    }

    // Read existing rows
    let resp;
    try {
      resp = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: 'webhook_secrets!A2:B' });
    } catch (err) {
      resp = { data: { values: [] } };
    }
    const rows = resp.data.values || [];
    const idx = rows.findIndex((r) => r[0] === webhookId);
    if (idx !== -1) {
      const rowNum = idx + 2;
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `webhook_secrets!A${rowNum}:B${rowNum}`,
        valueInputOption: 'RAW',
        resource: { values: [[webhookId, secret]] },
      });
      console.log(`Updated webhook secret for ${webhookId} at row ${rowNum}`);
    } else {
      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: 'webhook_secrets!A:B',
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        resource: { values: [[webhookId, secret]] },
      });
      console.log(`Appended webhook secret for ${webhookId}`);
    }
  } catch (err) {
    console.error('Error persisting hook secret:', err.message || err);
    throw err;
  }
}

export default async function handler(req, res) {
  try {
    // Parse sheetId from query string if provided
    const base = `https://${req.headers.host || 'example.com'}`;
    const full = new URL(req.url || '/', base);
    const sheetId = full.searchParams.get('sheetId') || process.env.SPREADSHEET_ID || process.env.GOOGLE_SHEETS_SPREADSHEET_ID;

  const hookSecret = req.headers['x-hook-secret'];
  // Support multiple ways to identify webhook: explicit header, or query params
  const webhookIdHeader = req.headers['x-hook-id'] || req.headers['x-hook-gid'] || full.searchParams.get('webhookId') || full.searchParams.get('clientWebhookId');

    if (hookSecret) {
      // Debug: log incoming headers and query param extraction
      console.log('Incoming handshake. headers:', req.headers);
      console.log('Parsed sheetId:', sheetId, 'webhookIdHeader:', webhookIdHeader);

      // Echo immediate handshake header per Asana requirement
      res.setHeader('X-Hook-Secret', hookSecret);

      // IMPORTANT: On serverless platforms (Vercel), background promises may be terminated
      // when the function returns. Await persistence so the write completes before returning.
      const webhookId = webhookIdHeader || `asana-${Date.now()}`;
      if (!sheetId) {
        console.log('No sheetId provided; skipping secret persistence');
        res.statusCode = 200;
        // Add a handler version header so we can verify deployed code
        const hv = process.env.WEBHOOK_HANDLER_VERSION || new Date().toISOString();
        res.setHeader('X-Webhook-Handler-Version', hv);
        res.end('Handshake OK (no sheetId)');
        return;
      }

      try {
        await persistHookSecret(sheetId, webhookId, hookSecret);
        console.log('Persisted hook secret for', webhookId);
      } catch (err) {
        console.error('Error persisting hook secret (will still respond 200):', err.message || err);
      }

      res.statusCode = 200;
      // Expose handler version to help confirm the deployment that answered the request
      const handlerVersion = process.env.WEBHOOK_HANDLER_VERSION || new Date().toISOString();
      res.setHeader('X-Webhook-Handler-Version', handlerVersion);
      res.end('Handshake OK (persist attempt completed)');
      return;
    }

    // For event POSTs, accept and return 200 quickly. You may process events later.
    res.statusCode = 200;
    res.end('Event received');
  } catch (err) {
    console.error('Webhook handler error:', err);
    res.statusCode = 500;
    res.end('Internal error');
  }
}
