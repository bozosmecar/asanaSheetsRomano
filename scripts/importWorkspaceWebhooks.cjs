require('dotenv').config();
const axios = require('axios');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

// Retry helper (simple)
async function retryOperation(operation, maxRetries = 3, baseDelay = 1000) {
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (attempt > 0) await new Promise((r) => setTimeout(r, baseDelay * Math.pow(2, attempt)));
      return await operation();
    } catch (err) {
      lastError = err;
      if (err.response?.status === 429) {
        const retryAfter = parseInt(err.response.headers['retry-after'] || '0') * 1000;
        const wait = retryAfter > 0 ? retryAfter : baseDelay * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      if (attempt === maxRetries - 1) throw lastError;
    }
  }
  throw lastError;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--workspaceId') out.workspaceId = args[++i];
    else if (a === '--spreadsheetId') out.spreadsheetId = args[++i];
    else if (a === '--token') out.token = args[++i];
    else if (a === '--targetBase') out.targetBase = args[++i];
    else if (a === '--recreate') out.recreate = true;
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

async function ensureSecretsSheet(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const has = meta.data.sheets.some(s => s.properties.title === 'webhook_secrets');
  if (!has) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, resource: { requests: [{ addSheet: { properties: { title: 'webhook_secrets', hidden: true } } }] } });
    await sheets.spreadsheets.values.update({ spreadsheetId, range: 'webhook_secrets!A1:B1', valueInputOption: 'RAW', resource: { values: [['webhook_id','secret']] } });
  }
}

async function appendOrUpdate(sheets, spreadsheetId, webhookId, secret) {
  await ensureSecretsSheet(sheets, spreadsheetId);
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'webhook_secrets!A2:B' }).catch(() => ({ data: { values: [] } }));
  const rows = resp.data.values || [];
  const idx = rows.findIndex(r => r[0] === webhookId);
  if (idx !== -1) {
    const rowNum = idx + 2;
    await sheets.spreadsheets.values.update({ spreadsheetId, range: `webhook_secrets!A${rowNum}:B${rowNum}`, valueInputOption: 'RAW', resource: { values: [[webhookId, secret]] } });
    return { updated: true, row: rowNum };
  }
  await sheets.spreadsheets.values.append({ spreadsheetId, range: 'webhook_secrets!A:B', valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', resource: { values: [[webhookId, secret]] } });
  return { appended: true };
}

async function listWebhooks(workspaceId, token) {
  const url = 'https://app.asana.com/api/1.0/webhooks';
  const webhooks = [];
  let offset = null;
  do {
    const params = { workspace: workspaceId, limit: 100, ...(offset ? { offset } : {}), opt_fields: 'gid,resource,target' };
    const resp = await retryOperation(() => axios.get(url, { headers: { Authorization: `Bearer ${token}` }, params }));
    webhooks.push(...(resp.data.data || []));
    offset = resp.data.next_page?.offset;
  } while (offset);
  return webhooks;
}

async function recreateWebhook(oldGid, wh, token, spreadsheetId, sheets) {
  try {
    await retryOperation(() => axios.delete(`https://app.asana.com/api/1.0/webhooks/${oldGid}`, { headers: { Authorization: `Bearer ${token}` } }));
  } catch (err) { /* ignore */ }

  const clientId = `client-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  // Allow overriding base target (useful when Asana stored an old deployment URL)
  let target;
  if (process.overrideTargetBase || process.overrideTargetBase === undefined) {
    // noop to placate some linters
  }
  const base = (globalThis.importArgs && importArgs.targetBase) || process.env.TARGET_BASE || null;
  if (base) {
    // Construct from provided base
    const baseUrl = base.endsWith('/') ? base.slice(0, -1) : base;
    target = new URL(baseUrl + '/api/webhook');
  } else {
    target = new URL(wh.target);
  }
  target.searchParams.set('sheetId', spreadsheetId);
  target.searchParams.set('clientWebhookId', clientId);

  const payload = { data: { resource: wh.resource?.gid || wh.resource, target: target.toString() } };
  const created = await retryOperation(() => axios.post('https://app.asana.com/api/1.0/webhooks', payload, { headers: { Authorization: `Bearer ${token}` } }));
  const newGid = created.data.data.gid;

  // append placeholder under the new gid while waiting for secret
  await appendOrUpdate(sheets, spreadsheetId, newGid, '<pending-secret>');

  // poll for the clientId row to be populated (handler should write it)
  const maxWait = 60000; let waited = 0; const poll = 2000; let captured = null;
  while (waited < maxWait) {
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'webhook_secrets!A2:B' }).catch(() => ({ data: { values: [] } }));
    const rows = resp.data.values || [];
    const clientRow = rows.find(r => r[0] === clientId);
    if (clientRow && clientRow[1] && clientRow[1] !== '<pending-secret>') { captured = clientRow[1]; break; }
    // also check if the newGid's row was directly updated
    const gidRow = rows.find(r => r[0] === newGid && r[1] && r[1] !== '<pending-secret>');
    if (gidRow) { captured = gidRow[1]; break; }
    await new Promise(r => setTimeout(r, poll)); waited += poll;
  }

  if (captured) {
    // write captured secret under the real GID and remove client row by updating it
    await appendOrUpdate(sheets, spreadsheetId, newGid, captured);
    // attempt to delete clientId row (by replacing with blank) — we'll update that row to empty
    const resp2 = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'webhook_secrets!A2:B' }).catch(() => ({ data: { values: [] } }));
    const rows2 = resp2.data.values || [];
    const idx = rows2.findIndex(r => r[0] === clientId);
    if (idx !== -1) {
      const rowNum = idx + 2;
      await sheets.spreadsheets.values.update({ spreadsheetId, range: `webhook_secrets!A${rowNum}:B${rowNum}`, valueInputOption: 'RAW', resource: { values: [['', '']] } });
    }
  }
  return { newGid, captured };
}

async function main() {
  const args = parseArgs();
  // Make args available to recreateWebhook
  global.importArgs = args;
  const workspaceId = args.workspaceId || process.env.ASANA_WORKSPACE_ID;
  const spreadsheetId = args.spreadsheetId;
  const token = args.token || process.env.ASANA_ACCESS_TOKEN;
  const recreate = !!args.recreate;
  if (!workspaceId || !spreadsheetId || !token) { console.error('Usage: --workspaceId <id> --spreadsheetId <id> [--token <token>] [--recreate]'); process.exit(2); }

  const sheets = await getSheetsClient();
  console.log(`Listing webhooks for workspace ${workspaceId}...`);
  const webhooks = await listWebhooks(workspaceId, token);
  console.log(`Found ${webhooks.length} webhooks`);

  for (const wh of webhooks) {
    const gid = wh.gid;
    const target = wh.target;
    console.log(`Importing webhook ${gid} (target: ${target})`);
    await appendOrUpdate(sheets, spreadsheetId, gid, '<pending-secret>');
    if (recreate) {
      console.log(`Recreating ${gid} to capture handshake...`);
      const res = await recreateWebhook(gid, wh, token, spreadsheetId, sheets);
      console.log(`Recreated -> ${res.newGid}. secret captured: ${!!res.captured}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  console.log('Import complete.');
}

if (require.main === module) main();
