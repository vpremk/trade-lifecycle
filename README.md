# Trade Lifecycle

An AWS CDK project implementing a trade ingestion pipeline for FIX protocol messages.

## Overview

Incoming FIX (Financial Information eXchange) strings are accepted via API Gateway, stored raw in S3 for audit, and forwarded to SQS for downstream processing. Infrastructure is fully defined in TypeScript using AWS CDK v2.

## Architecture

```
API Gateway  POST /ingest
      │
      ▼
Lambda (Ingestion)
      │
      ├──▶ S3  (raw FIX audit trail)
      │
      └──▶ SQS fix-orders-queue
                    │
                    ▼
             Downstream Processing
```

### AWS Resources

| Resource  | Name                        | Purpose                        |
|-----------|-----------------------------|--------------------------------|
| API GW    | `trade-lifecycle-api`       | `POST /ingest` entry point     |
| Lambda    | `trade-lifecycle-ingestion` | Parses, stores, enqueues FIX   |
| SQS       | `fix-orders-queue`          | Inbound FIX order messages     |
| SQS       | `execution-reports-queue`   | Outbound execution reports     |
| S3        | `audit-trail-{acct}-{region}` | Immutable raw FIX archive    |
| DynamoDB  | `Orders`                    | Order state (pay-per-request)  |

## Project Structure

```
trade-lifecycle/
├── bin/
│   └── trade-lifecycle.ts        # CDK app entry point
├── lib/
│   └── trade-lifecycle-stack.ts  # Stack definition (all AWS resources)
├── lambda/
│   └── ingestion/
│       └── index.js              # Ingestion Lambda handler
├── test/
│   ├── features/
│   │   └── fix-ingestion.feature # Gherkin BDD scenarios
│   ├── fixtures/                 # One JSON per test case (input + expected)
│   └── steps/
│       └── fix-ingestion.steps.js # Cucumber step definitions
├── cdk.json                      # CDK config (app command + resource names)
├── sck.json                      # Placeholder resource config for local tooling
├── run.sh                        # End-to-end install → build → deploy script
├── package.json
└── tsconfig.json
```

## Prerequisites

- Node.js >= 18
- AWS CDK v2 (`npm install -g aws-cdk`)
- AWS CLI v2 with credentials configured

## Quickstart

### 1. Install dependencies

```bash
npm install
```

### 2. Configure AWS credentials

```bash
aws configure --profile trade-lifecycle
# or use an existing profile
export AWS_PROFILE=trade-lifecycle
```

### 3. Deploy (everything in one command)

```bash
./run.sh
# or with overrides:
CDK_REGION=us-west-2 AWS_PROFILE=trade-lifecycle ./run.sh
```

The script runs: prerequisites check → `npm install` → `tsc` build → `cdk bootstrap` → `cdk synth` → `cdk deploy`. Outputs (API URL, bucket name, queue URL) are written to `cdk-outputs.json`.

### Manual deploy

```bash
npm run build          # compile TypeScript
cdk bootstrap          # one-time per account/region
cdk synth              # preview CloudFormation template
cdk deploy --profile trade-lifecycle
```

## Ingestion Lambda

**Handler:** `lambda/ingestion/index.js`

Accepts `POST /ingest` with a FIX message. Body formats supported:

```json
{ "fix": "8=FIX.4.2\u000135=D\u000155=AAPL\u0001..." }
```
or a raw FIX string directly.

**Flow:**
1. Extract FIX string from the request body.
2. Store raw FIX in S3 at `raw/<timestamp>-<id>.fix` for immutable audit.
3. Send FIX to `fix-orders-queue` with the S3 key as a message attribute.
4. Return `200 { message: "received", s3Key: "..." }`.

**Environment variables** (injected by CDK):

| Variable        | Description                    |
|-----------------|--------------------------------|
| `FIX_QUEUE_URL` | SQS ingestion queue URL        |
| `RAW_BUCKET`    | S3 audit trail bucket name     |
| `ORDERS_TABLE`  | DynamoDB orders table name     |

## Testing

After deploy, tests auto-read the endpoint from `cdk-outputs.json`.

```bash
npm install
npm run test:bdd

# Override endpoint manually
API_URL=https://abc123.execute-api.us-east-1.amazonaws.com/prod npm run test:bdd
```

Fixtures in `test/fixtures/` (one JSON per scenario):

| Fixture                            | MsgType | Description                         |
|------------------------------------|---------|-------------------------------------|
| `new-order-buy-market`             | `35=D`  | Buy 100 AAPL market                 |
| `new-order-sell-limit`             | `35=D`  | Sell 50 MSFT limit $420             |
| `order-cancel-request`             | `35=F`  | Cancel ORD001                       |
| `execution-report-partial-fill`    | `35=8`  | Partial fill 40 AAPL @ $178.50      |
| `missing-fix-body`                 | —       | Empty FIX edge case                 |

To add a new test: create a fixture JSON in `test/fixtures/` and add a row to the `Examples` table in `test/features/fix-ingestion.feature`.

## Configuration

`sck.json` holds placeholder resource names for local tooling. Update after first deploy:

```json
{
  "resources": {
    "s3":       { "rawBucket": "audit-trail-<account>-us-east-1" },
    "sqs":      { "fixQueue": "fix-orders-queue", "reportsQueue": "execution-reports-queue" },
    "dynamodb": { "ordersTable": "Orders" }
  }
}
```

## IAM Permissions Required

The deploying IAM user/role needs:

- `cloudformation:*`
- `s3:*`, `sqs:*`, `dynamodb:*`, `lambda:*`, `apigateway:*`
- `iam:*` (CDK creates execution roles)
- `ssm:GetParameter` (CDK bootstrap reads SSM)
