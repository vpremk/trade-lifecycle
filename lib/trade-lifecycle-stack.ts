import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';

export class TradeLifecycleStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // SQS Queues
    const fixQueue = new sqs.Queue(this, 'FixOrdersQueue', {
      queueName: 'fix-orders-queue',
      visibilityTimeout: cdk.Duration.seconds(30),
      retentionPeriod: cdk.Duration.days(4),
    });

    new sqs.Queue(this, 'ExecutionReportsQueue', {
      queueName: 'execution-reports-queue',
      visibilityTimeout: cdk.Duration.seconds(30),
      retentionPeriod: cdk.Duration.days(4),
    });

    // S3 Audit Bucket
    const auditBucket = new s3.Bucket(this, 'AuditTrailBucket', {
      bucketName: `audit-trail-${this.account}-${this.region}`,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(30),
            },
          ],
        },
      ],
    });

    // DynamoDB Orders Table
    const ordersTable = new dynamodb.Table(this, 'OrdersTable', {
      tableName: 'Orders',
      partitionKey: { name: 'orderId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Ingestion Lambda
    const ingestionFn = new lambda.Function(this, 'IngestionLambda', {
      functionName: 'trade-lifecycle-ingestion',
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/ingestion')),
      environment: {
        FIX_QUEUE_URL: fixQueue.queueUrl,
        RAW_BUCKET: auditBucket.bucketName,
        ORDERS_TABLE: ordersTable.tableName,
      },
      timeout: cdk.Duration.seconds(15),
    });

    auditBucket.grantPut(ingestionFn);
    fixQueue.grantSendMessages(ingestionFn);
    ordersTable.grantWriteData(ingestionFn);

    // API Gateway
    const api = new apigw.RestApi(this, 'TradeLifecycleApi', {
      restApiName: 'trade-lifecycle-api',
      description: 'Trade Lifecycle ingestion endpoint',
      defaultCorsPreflightOptions: {
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        allowMethods: ['POST', 'OPTIONS'],
      },
    });

    const ingest = api.root.addResource('ingest');
    ingest.addMethod('POST', new apigw.LambdaIntegration(ingestionFn));

    // Outputs
    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: api.url,
      description: 'API Gateway endpoint URL',
    });

    new cdk.CfnOutput(this, 'AuditBucketName', {
      value: auditBucket.bucketName,
      description: 'S3 audit trail bucket name',
    });

    new cdk.CfnOutput(this, 'FixQueueUrl', {
      value: fixQueue.queueUrl,
      description: 'SQS FIX orders queue URL',
    });
  }
}
