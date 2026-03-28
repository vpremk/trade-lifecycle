const { Given, When, Then, Before } = require('@cucumber/cucumber');
const assert = require('assert');
const https  = require('https');
const http   = require('http');
const fs     = require('fs');
const path   = require('path');

// ─── Resolve API endpoint ──────────────────────────────────────────────────────
function resolveEndpoint() {
  if (process.env.API_URL) return process.env.API_URL.replace(/\/$/, '') + '/ingest';

  const outputsPath = path.join(__dirname, '..', '..', 'cdk-outputs.json');
  if (fs.existsSync(outputsPath)) {
    const outputs = JSON.parse(fs.readFileSync(outputsPath, 'utf8'));
    const stack = outputs['TradeLifecycleStack'] || {};
    const base = stack['ApiEndpoint'] || stack['TradeLifecycleApiEndpoint'];
    if (base) return base.replace(/\/$/, '') + '/ingest';
  }
  return null;
}

// ─── HTTP helper ───────────────────────────────────────────────────────────────
function post(url, body) {
  return new Promise((resolve, reject) => {
    const data   = JSON.stringify(body);
    const parsed = new URL(url);
    const lib    = parsed.protocol === 'https:' ? https : http;

    const req = lib.request({
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }, (res) => {
      let raw = '';
      res.on('data',  (chunk) => { raw += chunk; });
      res.on('end',   ()      => resolve({ status: res.statusCode, body: raw }));
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ─── Shared world state ────────────────────────────────────────────────────────
Before(function () {
  this.fixture  = null;
  this.response = null;
});

// ─── Steps ────────────────────────────────────────────────────────────────────
Given('the ingestion API endpoint is available', function () {
  const endpoint = resolveEndpoint();
  assert.ok(
    endpoint,
    'No API endpoint found. Deploy first or set API_URL=https://...'
  );
  this.endpoint = endpoint;
});

Given('the fixture file {string}', function (fixtureName) {
  const fixturePath = path.join(
    __dirname, '..', 'fixtures', `${fixtureName}.json`
  );
  assert.ok(
    fs.existsSync(fixturePath),
    `Fixture not found: ${fixturePath}`
  );
  this.fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
});

When('I POST the FIX input to the ingestion API', async function () {
  assert.ok(this.fixture, 'No fixture loaded');
  this.response = await post(this.endpoint, this.fixture.input);
});

Then('the response status code should be {int}', function (expectedStatus) {
  assert.strictEqual(
    this.response.status,
    expectedStatus,
    `Expected status ${expectedStatus}, got ${this.response.status}. Body: ${this.response.body}`
  );
});

Then('the response body should contain message {string}', function (expectedMessage) {
  const parsed = JSON.parse(this.response.body);
  assert.strictEqual(
    parsed.message,
    expectedMessage,
    `Expected message "${expectedMessage}", got "${parsed.message}"`
  );
});

Then('the response body should contain an s3Key matching {string}', function (pattern) {
  const parsed = JSON.parse(this.response.body);
  assert.ok(
    parsed.s3Key,
    `Expected s3Key in response body, got: ${this.response.body}`
  );
  const regex = new RegExp(pattern);
  assert.match(
    parsed.s3Key,
    regex,
    `s3Key "${parsed.s3Key}" does not match pattern "${pattern}"`
  );
});
