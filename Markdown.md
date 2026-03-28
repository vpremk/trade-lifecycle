# Trade Lifecycle

An AWS CDK project implementing a trade ingestion pipeline for FIX protocol messages.

## Overview

This project provisions AWS infrastructure to ingest, audit, and process FIX (Financial Information eXchange) protocol trade messages. Incoming FIX strings are stored raw in S3 for audit and forwarded to SQS for downstream processing.

## Architecture

```
API Gateway POST
      |
      v
Lambda (Ingestion)
      |
      +---> S3 (raw FIX audit trail)
      |
      +---> SQS (fix-orders-queue)
                |
                v
         Downstream Processing
```

### AWS Resources

| Resource   | Name / Purpose                          |
|------------|-----------------------------------------|
| SQS Queue  | `fix-orders-queue` — inbound FIX orders |
| SQS Queue  | `execution-reports-queue` — trade reports |
| S3 Bucket  | `audit_trail` — raw FIX message archive |
| DynamoDB   | `Orders` — order state table            |

## Project Structure

```
trade-lifecycle/
├── bin/
│   └── trade-lifecycle.ts   # CDK app entry point
├── lambda/
│   └── ingestion/
│       └── index.js         # Ingestion Lambda handler
├── cdk.json                 # CDK config
├── sck.json                 # Skeleton resource config / placeholders
├── package.json             # Node dependencies
└── tsconfig.json            # TypeScript config
```

## Prerequisites

- Node.js >= 18
- AWS CDK v2
- AWS credentials configured

## Setup

```bash
npm install
```

## Deploy

```bash
# Synthesize CloudFormation template
npm run synth

# Deploy all stacks
npm run deploy
```

Target a specific account/region via environment variables:

```bash
CDK_ACCOUNT=123456789012 CDK_REGION=us-east-1 npm run deploy
```

## Ingestion Lambda

**Handler:** `lambda/ingestion/index.js`

Accepts an API Gateway `POST` request with a FIX message in the body. The body can be:
- A JSON object with a `fix` field: `{ "fix": "8=FIX.4.2|35=D|..." }`
- A raw FIX string

**Flow:**
1. Extracts the FIX string from the event body.
2. Stores the raw FIX in S3 under `raw/<timestamp>-<id>.fix` for audit.
3. Sends the FIX string to SQS with the S3 key as a message attribute.
4. Returns `{ message: "received", s3Key: "<key>" }` on success.

**Environment Variables:**

| Variable        | Description                       |
|-----------------|-----------------------------------|
| `FIX_QUEUE_URL` | URL of the SQS ingestion queue    |
| `RAW_BUCKET`    | Name of the S3 audit trail bucket |

## Configuration

`sck.json` holds placeholder resource names for local tooling and scripts. Replace values with actual deployed resource names after deployment.

```json
{
  "resources": {
    "s3": { "rawBucket": "REPLACE_WITH_BUCKET_NAME" },
    "sqs": {
      "fixQueue": "fix-orders-queue",
      "reportsQueue": "execution-reports-queue"
    },
    "dynamodb": { "ordersTable": "Orders" }
  }
}
```
