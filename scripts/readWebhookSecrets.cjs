#!/usr/bin/env node
/**
 * scripts/readWebhookSecrets.cjs
 * Reads and prints rows from webhook_secrets sheet for verification.
 * Usage: node scripts/readWebhookSecrets.cjs --spreadsheetId <id>
 */

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--spreadsheetId') out.spreadsheetId = args[++i];
  }
  return out;
}

function loadCredentials() {
  if (process.env.GOOGLE_SHEETS_CREDENTIALS) {
    try { return JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS); } catch (e) { throw new Error('Invalid GOOGLE_SHEETS_CREDENTIALS'); }
  }
  const fallback = path.join(__dirname, '..', 'asanaromano-cbfe64665e8e.json');
  if (fs.existsSync(fallback)) return JSON.parse(fs.readFileSync(fallback, 'utf8'));
  throw new Error('No Google Sheets credentials found');
}

async function getSheetsClient() {
  const creds = loadCredentials();
  const client = new google.auth.JWT({ email: creds.client_email, key: creds.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  await client.authorize();
  return google.sheets({ version: 'v4', auth: client });
}

(async function main(){
  const { spreadsheetId } = parseArgs();
  if (!spreadsheetId) { console.error('Usage: node scripts/readWebhookSecrets.cjs --spreadsheetId <id>'); process.exit(2); }
  try {
    const sheets = await getSheetsClient();
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'webhook_secrets!A2:B' });
    const rows = resp.data.values || [];
    if (rows.length === 0) { console.log('No webhook secrets found.'); return; }
    console.log('webhook_secrets rows:');
    rows.forEach((r, i) => console.log(`${i+2}: ${r[0] || ''} | ${r[1] || ''}`));
  } catch (err) {
    console.error('Error reading webhook_secrets:', err.response?.data || err.message || err);
    process.exit(1);
  }
})();
