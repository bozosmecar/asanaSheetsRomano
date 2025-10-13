#!/usr/bin/env node
/**
 * scripts/storeSecret.cjs
 * Self-contained script to store an Asana webhook secret into the spreadsheet's
 * hidden sheet `webhook_secrets`. It avoids importing project modules to
 * bypass ESM/CJS conflicts.
 *
 * Usage:
 * node scripts/storeSecret.cjs --secret <secret> --webhookId <id> --spreadsheetId <id>
 *
 * Credentials:
 * - Prefer: set env var GOOGLE_SHEETS_CREDENTIALS to the JSON string of the
 *   service account (client_email and private_key required).
 * - Fallback: the script will try to read ./asanaromano-cbfe64665e8e.json in repo root.
 */

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--secret') out.secret = args[++i];
    else if (a === '--webhookId') out.webhookId = args[++i];
    else if (a === '--spreadsheetId') out.spreadsheetId = args[++i];
  }
  return out;
}

function loadCredentials() {
  if (process.env.GOOGLE_SHEETS_CREDENTIALS) {
    try {
      return JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS);
    } catch (err) {
      throw new Error('Invalid JSON in GOOGLE_SHEETS_CREDENTIALS');
    }
  }

  const fallback = path.join(__dirname, '..', 'asanaromano-cbfe64665e8e.json');
  if (fs.existsSync(fallback)) {
    try {
      const raw = fs.readFileSync(fallback, 'utf8');
      return JSON.parse(raw);
    } catch (err) {
      throw new Error('Failed to parse local credentials file: ' + err.message);
    }
  }

  throw new Error('No Google Sheets credentials found. Set GOOGLE_SHEETS_CREDENTIALS or add the JSON file.');
}

async function getSheetsClient() {
  const creds = loadCredentials();
  if (!creds.client_email || !creds.private_key) throw new Error('Credentials missing client_email or private_key');

  const client = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets','https://www.googleapis.com/auth/drive.file']
  });
  await client.authorize();
  return google.sheets({ version: 'v4', auth: client });
}

async function ensureWebhookSecretsSheet(sheets, spreadsheetId) {
  // Ensure the sheet exists and header row is present
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const found = meta.data.sheets.find(s => s.properties.title === 'webhook_secrets');
  if (!found) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, resource: { requests: [ { addSheet: { properties: { title: 'webhook_secrets', hidden: true } } } ] } });
    await sheets.spreadsheets.values.update({ spreadsheetId, range: 'webhook_secrets!A1:B1', valueInputOption: 'RAW', resource: { values: [['webhook_id','secret']] } });
  }
}

async function storeSecret(sheets, spreadsheetId, webhookId, secret) {
  await ensureWebhookSecretsSheet(sheets, spreadsheetId);

  // Fetch existing rows
  let rowsResp;
  try {
    rowsResp = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'webhook_secrets!A2:B' });
  } catch (err) {
    // If sheet is empty, treat as no rows
    rowsResp = { data: { values: [] } };
  }
  const rows = rowsResp.data.values || [];

  const existingIndex = rows.findIndex(r => r[0] === webhookId);
  if (existingIndex !== -1) {
    const rowNum = existingIndex + 2; // +2 for header + 1-index
    await sheets.spreadsheets.values.update({ spreadsheetId, range: `webhook_secrets!A${rowNum}:B${rowNum}`, valueInputOption: 'RAW', resource: { values: [[webhookId, secret]] } });
    return { updated: true, row: rowNum };
  } else {
    await sheets.spreadsheets.values.append({ spreadsheetId, range: 'webhook_secrets!A:B', valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', resource: { values: [[webhookId, secret]] } });
    return { appended: true };
  }
}

(async function main() {
  const { secret, webhookId, spreadsheetId } = parseArgs();
  if (!secret) {
    console.error('Missing --secret');
    process.exit(2);
  }
  if (!spreadsheetId) {
    console.error('Missing --spreadsheetId');
    process.exit(2);
  }
  const id = webhookId || `manual-${Date.now()}`;
  try {
    console.log('Authenticating to Google Sheets...');
    const sheets = await getSheetsClient();
    console.log(`Storing secret for webhook id=${id} into spreadsheet ${spreadsheetId}`);
    const result = await storeSecret(sheets, spreadsheetId, id, secret);
    console.log('Result:', result);
    console.log('Done.');
  } catch (err) {
    console.error('Error:', err.message || err);
    process.exit(1);
  }
})();
