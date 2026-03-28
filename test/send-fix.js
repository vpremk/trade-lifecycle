#!/usr/bin/env node
/**
 * Test script — sends sample FIX 4.2 messages to the trade-lifecycle ingestion API.
 *
 * Usage:
 *   node test/send-fix.js                        # reads endpoint from cdk-outputs.json
 *   API_URL=https://xxx.execute-api.us-east-1.amazonaws.com/prod node test/send-fix.js
 *   node test/send-fix.js --raw                  # send raw FIX string instead of JSON wrapper
 */

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

// ─── Resolve API endpoint ──────────────────────────────────────────────────────
function resolveEndpoint() {
  if (process.env.API_URL) return process.env.API_URL.replace(/\/$/, '') + '/ingest';

  const outputsPath = path.join(__dirname, '..', 'cdk-outputs.json');
  if (fs.existsSync(outputsPath)) {
    const outputs = JSON.parse(fs.readFileSync(outputsPath, 'utf8'));
    const stack = outputs['TradeLifecycleStack'] || {};
    const base = stack['ApiEndpoint'] || stack['TradeLifecycleApiEndpoint'];
    if (base) return base.replace(/\/$/, '') + '/ingest';
  }

  console.error('No API endpoint found.');
  console.error('Either deploy first (cdk deploy) or set: API_URL=https://... node test/send-fix.js');
  process.exit(1);
}

// ─── Sample FIX messages ───────────────────────────────────────────────────────
// SOH delimiter represented as | for readability
const SOH = '\u0001';
const fix = (fields) => fields.join(SOH) + SOH;

const MESSAGES = [
  {
    label: 'New Order Single — Buy 100 AAPL @ market',
    fix: fix([
      '8=FIX.4.2', '9=148', '35=D', '49=CLIENT1', '56=BROKER',
      '34=1', '52=20240328-10:00:00', '11=ORD001',
      '21=1', '55=AAPL', '54=1', '38=100', '40=1',
      '60=20240328-10:00:00', '10=128'
    ])
  },
  {
    label: 'New Order Single — Sell 50 MSFT @ limit $420',
    fix: fix([
      '8=FIX.4.2', '9=155', '35=D', '49=CLIENT1', '56=BROKER',
      '34=2', '52=20240328-10:01:00', '11=ORD002',
      '21=1', '55=MSFT', '54=2', '38=50', '40=2', '44=420.00',
      '60=20240328-10:01:00', '10=204'
    ])
  },
  {
    label: 'Order Cancel Request — cancel ORD001',
    fix: fix([
      '8=FIX.4.2', '9=130', '35=F', '49=CLIENT1', '56=BROKER',
      '34=3', '52=20240328-10:02:00', '41=ORD001', '11=ORD003',
      '55=AAPL', '54=1', '38=100', '60=20240328-10:02:00', '10=089'
    ])
  },
  {
    label: 'Execution Report — partial fill 40 AAPL @ $178.50',
    fix: fix([
      '8=FIX.4.2', '9=176', '35=8', '49=BROKER', '56=CLIENT1',
      '34=4', '52=20240328-10:03:00', '37=EXEC001', '11=ORD001',
      '17=FILL001', '20=0', '39=1', '55=AAPL', '54=1',
      '38=100', '32=40', '31=178.50', '151=60', '14=40',
      '6=178.50', '60=20240328-10:03:00', '10=167'
    ])
  },
];

// ─── HTTP helper ───────────────────────────────────────────────────────────────
function post(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;

    const req = lib.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ─── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const endpoint = resolveEndpoint();
  const rawMode  = process.argv.includes('--raw');

  console.log(`Endpoint : ${endpoint}`);
  console.log(`Mode     : ${rawMode ? 'raw FIX string' : 'JSON { fix: "..." }'}`);
  console.log('─'.repeat(60));

  let passed = 0;
  let failed = 0;

  for (const msg of MESSAGES) {
    const payload = rawMode ? msg.fix : { fix: msg.fix };
    process.stdout.write(`\n[${msg.label}]\n  Sending... `);

    try {
      const { status, body } = await post(endpoint, payload);
      const ok = status >= 200 && status < 300;
      if (ok) {
        const parsed = JSON.parse(body);
        console.log(`${status} OK  →  s3Key: ${parsed.s3Key}`);
        passed++;
      } else {
        console.log(`${status} FAIL  →  ${body}`);
        failed++;
      }
    } catch (err) {
      console.log(`ERROR  →  ${err.message}`);
      failed++;
    }
  }

  console.log('\n' + '─'.repeat(60));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
