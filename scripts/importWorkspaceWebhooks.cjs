#!/usr/bin/env node
/**
 * scripts/importWorkspaceWebhooks.cjs
 * Lists all webhooks for an Asana workspace and writes webhook_id and secret
 * into the spreadsheet's hidden `webhook_secrets` sheet.
 *
 * Usage:
 * node scripts/importWorkspaceWebhooks.cjs --workspaceId <id> --spreadsheetId <id> [--token <ASANA_TOKEN>]
 *
 * Notes:
 * - If a webhook has no secret exposed via the API, the script will write an empty secret.
 * - To capture secrets you may need to recreate webhooks or trigger handshake requests.
 */

const axios = require('axios');
const { spawnSync } = require('child_process');
const path = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--workspaceId') out.workspaceId = args[++i];
    else if (a === '--spreadsheetId') out.spreadsheetId = args[++i];
    else if (a === '--token') out.token = args[++i];
    else if (a === '--recreate') out.recreate = true;
  }
  return out;
}

async function listWebhooks(workspaceId, token) {
  const url = 'https://app.asana.com/api/1.0/webhooks';
  const params = { workspace: workspaceId, opt_fields: 'gid,resource,created_by,target' };
  const res = await axios.get(url, { headers: { Authorization: `Bearer ${token}` }, params });
  return res.data.data || [];
}

function storeRowViaStoreSecret(spreadsheetId, webhookId, secret) {
  // reuse storeSecret.cjs as a subprocess to avoid module loader conflicts
  const script = path.join(__dirname, 'storeSecret.cjs');
  const args = ['--secret', secret || '', '--webhookId', webhookId, '--spreadsheetId', spreadsheetId];
  const r = spawnSync(process.execPath, [script, ...args], { stdio: 'inherit' });
  return r.status === 0;
}

async function main() {
  const { workspaceId, spreadsheetId, token } = parseArgs();
  const asanaToken = token || process.env.ASANA_ACCESS_TOKEN;
  const { recreate } = parseArgs();
  if (!workspaceId || !spreadsheetId || !asanaToken) {
    console.error('Usage: node scripts/importWorkspaceWebhooks.cjs --workspaceId <id> --spreadsheetId <id> [--token <ASANA_TOKEN>]');
    process.exit(2);
  }

  console.log(`Listing webhooks for workspace ${workspaceId}...`);
  let webhooks;
  try {
    webhooks = await listWebhooks(workspaceId, asanaToken);
  } catch (err) {
    console.error('Error listing webhooks:', err.response?.data || err.message || err);
    process.exit(1);
  }

  console.log(`Found ${webhooks.length} webhooks. Importing to spreadsheet ${spreadsheetId}...`);
  for (const wh of webhooks) {
    const gid = wh.gid;
    // Asana doesn't expose handshake secrets via list API. We'll store a placeholder
    // and optionally recreate the webhook to trigger a handshake (and capture the secret).
    const placeholder = '<pending-secret>';
    console.log(`Storing webhook ${gid} (target: ${wh.target}) with placeholder secret`);
    const ok = storeRowViaStoreSecret(spreadsheetId, gid, placeholder);
    if (!ok) {
      console.error(`Failed to store webhook ${gid}`);
    }

    if (recreate) {
      try {
        console.log(`Recreating webhook ${gid} to trigger handshake...`);
        // Delete existing webhook
        await axios.delete(`https://app.asana.com/api/1.0/webhooks/${gid}`, { headers: { Authorization: `Bearer ${asanaToken}` } });
        await new Promise((r) => setTimeout(r, 1000));

        // Create a new webhook with same resource and target
        const payload = { data: { resource: wh.resource?.gid || wh.resource, target: wh.target } };
        const created = await axios.post('https://app.asana.com/api/1.0/webhooks', payload, { headers: { Authorization: `Bearer ${asanaToken}` } });
        console.log(`Recreated webhook ${created.data.data.gid}. Waiting 2s for handshake to be processed by your handler...`);
        // Give the deployed webhook handler some time to receive and persist the handshake secret
        await new Promise((r) => setTimeout(r, 2000));
      } catch (err) {
        console.error(`Error recreating webhook ${gid}:`, err.response?.data || err.message || err);
      }
    }
    // small delay between webhooks
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log('Import complete. Note: secrets may be empty unless you re-create webhooks to trigger handshakes.');
}

if (require.main === module) main();
