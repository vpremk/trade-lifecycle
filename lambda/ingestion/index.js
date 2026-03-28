// Ingestion Lambda
// - Accepts API Gateway POST with a FIX string
// - Stores raw FIX in S3 (audit)
// - Stores response in S3 (audit)
// - Pushes the raw FIX string to SQS for processing

const { S3Client, PutObjectCommand }    = require('@aws-sdk/client-s3');
const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');

const s3  = new S3Client({});
const sqs = new SQSClient({});

const QUEUE_URL = process.env.FIX_QUEUE_URL;
const BUCKET    = process.env.RAW_BUCKET;

function extractFixFromEvent(event) {
  if (!event) return null;
  const body = event.body;
  if (!body) return null;
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      if (parsed && parsed.fix !== undefined) return parsed.fix;
      return body;
    } catch (e) {
      return body;
    }
  }
  if (typeof body === 'object') {
    return body.fix || JSON.stringify(body);
  }
  return null;
}

function makeId() {
  return `${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
}

exports.handler = async (event) => {
  const fix = extractFixFromEvent(event) || '';
  const id  = makeId();
  const ts  = new Date().toISOString();
  const fixKey      = `raw/${ts}-${id}.fix`;
  const responseKey = `responses/${ts}-${id}.json`;

  // store raw FIX in S3 for audit
  try {
    await s3.send(new PutObjectCommand({
      Bucket:      BUCKET,
      Key:         fixKey,
      Body:        fix,
      ContentType: 'text/plain',
    }));
  } catch (err) {
    console.error('S3 PutObject error', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'failed to store raw fix' }) };
  }

  // push to SQS — Base64-encode to avoid SQS rejecting SOH (\u0001) delimiters
  const encoded = Buffer.from(fix).toString('base64');
  try {
    await sqs.send(new SendMessageCommand({
      QueueUrl:          QUEUE_URL,
      MessageBody:       encoded,
      MessageAttributes: {
        RawKey:   { DataType: 'String', StringValue: fixKey },
        Encoding: { DataType: 'String', StringValue: 'base64' },
      },
    }));
  } catch (err) {
    console.error('SQS SendMessage error', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'failed to enqueue fix' }) };
  }

  const response = {
    statusCode: 200,
    body: JSON.stringify({ message: 'received', s3Key: fixKey, responseKey }),
  };

  // store response in S3 for audit
  try {
    await s3.send(new PutObjectCommand({
      Bucket:      BUCKET,
      Key:         responseKey,
      Body:        response.body,
      ContentType: 'application/json',
      Metadata: {
        fixKey,
        statusCode: String(response.statusCode),
      },
    }));
  } catch (err) {
    console.error('S3 PutObject (response) error', err);
    // non-fatal — request was already processed, log and continue
  }

  return response;
};
