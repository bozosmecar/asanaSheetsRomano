import handler from '../api/webhook.js';

async function run() {
  // Provide sheetId via query param in URL so handler picks it up
  const sheetId = process.argv[2] || process.env.SPREADSHEET_ID || process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!sheetId) {
    console.error('Usage: node simulateHandshake.mjs <sheetId> (or set SPREADSHEET_ID env)');
    process.exit(2);
  }

  const clientId = `sim-client-${Date.now()}`;
  const hookSecret = `sim-secret-${Date.now()}`;

  // Minimal req/res mocks compatible with the handler
  const req = {
    url: `/api/webhook?sheetId=${sheetId}&clientWebhookId=${clientId}`,
    headers: {
      host: 'localhost',
      'x-hook-secret': hookSecret,
    },
  };

  let status = null;
  let headers = {};
  let body = '';

  const res = {
    setHeader(k, v) { headers[k] = v; },
    end(b) { body = b; },
    get statusCode() { return status; },
    set statusCode(v) { status = v; },
  };

  try {
    await handler(req, res);
    console.log('Handler returned. statusCode=', status, 'respBody=', body, 'respHeaders=', headers);
    console.log('Client id used:', clientId, 'hookSecret:', hookSecret);
    console.log('Now you can run the read script to confirm the sheet was updated.');
  } catch (err) {
    console.error('Handler threw:', err);
    process.exitCode = 1;
  }
}

run();
