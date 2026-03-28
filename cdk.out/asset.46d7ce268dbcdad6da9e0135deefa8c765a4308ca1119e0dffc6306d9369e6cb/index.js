// Ingestion Lambda
// - Accepts API Gateway POST with a FIX string
// - Stores raw FIX in S3 (audit)
// - Pushes the raw FIX string to SQS for processing

const AWS = require('aws-sdk');
const s3 = new AWS.S3();
const sqs = new AWS.SQS();

const QUEUE_URL = process.env.FIX_QUEUE_URL;
const BUCKET = process.env.RAW_BUCKET;

function extractFixFromEvent(event) {
  if (!event) return null;
  // API Gateway proxy integration: body may be string or object
  const body = event.body;
  if (!body) return null;
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      if (parsed && parsed.fix) return parsed.fix;
      // if not JSON with fix, treat as raw string
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
  const id = makeId();
  const ts = new Date().toISOString();
  const key = `raw/${ts}-${id}.fix`;

  // store raw FIX in S3 for audit
  try {
    await s3.putObject({
      Bucket: BUCKET,
      Key: key,
      Body: fix,
      ContentType: 'text/plain'
    }).promise();
  } catch (err) {
    console.error('S3 putObject error', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'failed to store raw fix' }) };
  }

  // push to SQS
  try {
    await sqs.sendMessage({
      QueueUrl: QUEUE_URL,
      MessageBody: fix,
      MessageAttributes: {
        RawKey: { DataType: 'String', StringValue: key }
      }
    }).promise();
  } catch (err) {
    console.error('SQS send error', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'failed to enqueue fix' }) };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'received', s3Key: key })
  };
};
