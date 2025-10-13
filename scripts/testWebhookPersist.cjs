#!/usr/bin/env node
/**
 * scripts/testWebhookPersist.cjs
 * Spawns the storeSecret script to add a test secret to the webhook_secrets sheet.
 * Usage: node scripts/testWebhookPersist.cjs --spreadsheetId <id>
 */

const { spawn } = require('child_process');
const path = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--spreadsheetId') out.spreadsheetId = args[++i];
  }
  return out;
}

const { spreadsheetId } = parseArgs();
if (!spreadsheetId) {
  console.error('Usage: node scripts/testWebhookPersist.cjs --spreadsheetId <id>');
  process.exit(2);
}

const secret = `test-secret-${Date.now()}`;
const webhookId = `test-${Date.now()}`;

console.log(`Running storeSecret.cjs to persist test secret: ${secret}`);

const child = spawn(process.execPath, [path.join(__dirname, 'storeSecret.cjs'), '--secret', secret, '--webhookId', webhookId, '--spreadsheetId', spreadsheetId], { stdio: 'inherit' });

child.on('exit', (code) => {
  if (code === 0) {
    console.log('Test script completed successfully. Check webhook_secrets sheet for test row.');
  } else {
    console.error('Test script failed with exit code', code);
  }
});
