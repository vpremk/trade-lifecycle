const { Given, When, Then, Before }                   = require('@cucumber/cucumber');
const { S3Client, HeadObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { CloudFormationClient,
        DescribeStacksCommand }                        = require('@aws-sdk/client-cloudformation');
const assert = require('assert');
const https  = require('https');
const http   = require('http');
const fs     = require('fs');
const path   = require('path');

const REGION = process.env.AWS_REGION || 'us-east-1';
const s3  = new S3Client({ region: REGION });
const cfn = new CloudFormationClient({ region: REGION });

// ─── Resolve stack outputs ─────────────────────────────────────────────────────
// Priority: env vars → cdk-outputs.json → CloudFormation DescribeStacks
async function stackOutputs() {
  if (process.env.API_URL && process.env.AUDIT_BUCKET) {
    return { apiBase: process.env.API_URL, bucket: process.env.AUDIT_BUCKET };
  }

  const outputsPath = path.join(__dirname, '..', '..', 'cdk-outputs.json');
  if (fs.existsSync(outputsPath)) {
    const outputs = JSON.parse(fs.readFileSync(outputsPath, 'utf8'));
    const stack   = outputs['TradeLifecycleStack'] || {};
    const apiBase = stack['ApiEndpoint'] || stack['TradeLifecycleApiEndpoint'];
    const bucket  = stack['AuditBucketName'];
    if (apiBase && bucket) return { apiBase, bucket };
  }

  // Fall back to live CloudFormation outputs
  const { Stacks } = await cfn.send(new DescribeStacksCommand({ StackName: 'TradeLifecycleStack' }));
  const outputs = (Stacks?.[0]?.Outputs || []).reduce((acc, o) => {
    acc[o.OutputKey] = o.OutputValue;
    return acc;
  }, {});
  return {
    apiBase: outputs['ApiEndpoint'] || outputs['TradeLifecycleApiEndpoint'] || process.env.API_URL,
    bucket:  outputs['AuditBucketName'] || process.env.AUDIT_BUCKET,
  };
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
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end',  ()      => resolve({ status: res.statusCode, body: raw }));
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ─── Shared world state ────────────────────────────────────────────────────────
Before(function () {
  this.fixture      = null;
  this.response     = null;
  this.s3Key        = null;
  this.responseKey  = null;
  this.bucket       = null;
});

// ─── Steps ────────────────────────────────────────────────────────────────────
Given('the ingestion API endpoint is available', async function () {
  const { apiBase, bucket } = await stackOutputs();
  assert.ok(apiBase, 'No API endpoint found. Deploy first or set API_URL=https://...');
  assert.ok(bucket,  'No audit bucket found. Deploy first or set AUDIT_BUCKET=...');
  this.endpoint = apiBase.replace(/\/$/, '') + '/ingest';
  this.bucket   = bucket;
});

Given('the fixture file {string}', function (fixtureName) {
  const fixturePath = path.join(__dirname, '..', 'fixtures', `${fixtureName}.json`);
  assert.ok(fs.existsSync(fixturePath), `Fixture not found: ${fixturePath}`);
  this.fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
});

When('I POST the FIX input to the ingestion API', async function () {
  assert.ok(this.fixture, 'No fixture loaded');
  this.response = await post(this.endpoint, this.fixture.input);
  if (this.response.status === 200) {
    const parsed     = JSON.parse(this.response.body);
    this.s3Key       = parsed.s3Key       || null;
    this.responseKey = parsed.responseKey || null;
  }
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
  assert.ok(parsed.s3Key, `Expected s3Key in response body, got: ${this.response.body}`);
  assert.match(parsed.s3Key, new RegExp(pattern),
    `s3Key "${parsed.s3Key}" does not match pattern "${pattern}"`);
});

Then('the response should be durably stored in the audit trail', async function () {
  assert.ok(this.responseKey, 'No responseKey captured from response body');
  assert.ok(this.bucket,      'No audit bucket resolved');

  // Confirm the response object exists
  await s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.responseKey }))
    .catch(() => assert.fail(`Response audit object not found in S3: s3://${this.bucket}/${this.responseKey}`));

  // Confirm stored response JSON contains the expected fields
  const { Body } = await s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.responseKey }));
  const chunks = [];
  for await (const chunk of Body) chunks.push(chunk);
  const stored = JSON.parse(Buffer.concat(chunks).toString('utf8'));

  assert.strictEqual(stored.message, 'received', `Expected message "received" in stored response, got "${stored.message}"`);
  assert.ok(stored.s3Key,       'Stored response is missing s3Key');
  assert.ok(stored.responseKey, 'Stored response is missing responseKey');
});

Then('the FIX message should be durably stored in the audit trail', async function () {
  assert.ok(this.s3Key,  'No s3Key captured from response');
  assert.ok(this.bucket, 'No audit bucket resolved');

  // Confirm the object exists
  await s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.s3Key }))
    .catch(() => assert.fail(`Audit object not found in S3: s3://${this.bucket}/${this.s3Key}`));

  // Confirm the stored content decodes back to the original FIX input
  const { Body } = await s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.s3Key }));
  const chunks = [];
  for await (const chunk of Body) chunks.push(chunk);
  const stored = Buffer.concat(chunks).toString('utf8');

  const sentFix = this.fixture.input.fix || '';
  assert.strictEqual(stored, sentFix,
    `Stored FIX content does not match sent input.\nExpected: ${sentFix}\nGot:      ${stored}`);
});
