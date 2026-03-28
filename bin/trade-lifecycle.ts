#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { TradeLifecycleStack } from '../lib/trade-lifecycle-stack';

const app = new cdk.App();

// Allow targeting a specific account/region via environment variables
const env = {
  account: process.env.CDK_ACCOUNT || process.env.AWS_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_REGION || process.env.AWS_REGION || process.env.CDK_DEFAULT_REGION || 'us-east-1'
};

new TradeLifecycleStack(app, 'TradeLifecycleStack', { env });
