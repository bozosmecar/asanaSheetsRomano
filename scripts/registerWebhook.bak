#!/usr/bin/env node
/**
 * scripts/registerWebhook.js
 * Usage:
 *  node scripts/registerWebhook.js --resource <ASANA_RESOURCE_GID> --target <https://your.domain/api/webhook?sheetId=SPREADSHEET_ID>
 * Or set ASANA_ACCESS_TOKEN in env and run without --target to use defaults.
 */

const https = require('https');
const { URL } = require('url');

function exitWith(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

function parseArgs() {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--resource' && argv[i + 1]) {
      args.resource = argv[++i];
    } else if (a === '--target' && argv[i + 1]) {
      args.target = argv[++i];
    } else if (a === '--help') {
      args.help = true;
    }
  }
  return args;
}

async function registerWebhook({ token, resource, target }) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ data: { resource, target } });

    const options = {
      hostname: 'app.asana.com',
      port: 443,
      path: '/api/1.0/webhooks',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Authorization: `Bearer ${token}`,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data || '{}');
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            reject(new Error(`Asana API error ${res.statusCode}: ${JSON.stringify(parsed)}`));
          }
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.write(body);
    req.end();
  });
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    console.log('Usage: node scripts/registerWebhook.js --resource <RESOURCE_GID> --target <TARGET_URL>');
    process.exit(0);
  }

  const ASANA_ACCESS_TOKEN = process.env.ASANA_ACCESS_TOKEN;
  if (!ASANA_ACCESS_TOKEN) exitWith('Set ASANA_ACCESS_TOKEN in your environment or .env');

  const resource = args.resource || process.env.ASANA_RESOURCE_GID;
  const target = args.target || process.env.ASANA_WEBHOOK_TARGET;

  if (!resource) exitWith('Missing resource GID. Provide --resource or set ASANA_RESOURCE_GID in env');
  if (!target) exitWith('Missing target URL. Provide --target or set ASANA_WEBHOOK_TARGET in env');

  try {
    // Basic validation of target URL
    new URL(target);
  } catch (err) {
    exitWith('Invalid target URL');
  }

  try {
    console.log('Registering webhook with Asana...');
    const resp = await registerWebhook({ token: ASANA_ACCESS_TOKEN, resource, target });
    console.log('Webhook created:', JSON.stringify(resp, null, 2));
  } catch (err) {
    exitWith(`Failed to create webhook: ${err.message}`);
  }
}

if (require.main === module) {
  main();
}

module.exports = { registerWebhook };
