#!/usr/bin/env bash
set -euo pipefail

# ─── Config ────────────────────────────────────────────────────────────────────
REGION="${CDK_REGION:-${AWS_REGION:-us-east-1}}"
STACK="TradeLifecycleStack"

log()  { echo "[$(date '+%H:%M:%S')] $*"; }
fail() { echo "[ERROR] $*" >&2; exit 1; }

# ─── 1. Check prerequisites ────────────────────────────────────────────────────
log "Checking prerequisites..."

command -v node  >/dev/null 2>&1 || fail "node not found — install Node.js >= 18"
command -v npm   >/dev/null 2>&1 || fail "npm not found"
command -v aws   >/dev/null 2>&1 || fail "aws CLI not found — install AWS CLI v2"

NODE_VER=$(node -e "process.stdout.write(process.versions.node)")
MAJOR=${NODE_VER%%.*}
[ "$MAJOR" -ge 18 ] || fail "Node.js >= 18 required (found $NODE_VER)"

aws sts get-caller-identity --region "$REGION" >/dev/null 2>&1 \
  || fail "AWS credentials not configured — run 'aws configure' or set AWS_PROFILE"

# ─── 2. Install dependencies ───────────────────────────────────────────────────
log "Installing npm dependencies..."
npm install --silent

# ─── 3. Ensure CDK CLI ────────────────────────────────────────────────────────
if ! npx cdk --version >/dev/null 2>&1; then
  log "Installing aws-cdk globally..."
  npm install -g aws-cdk
fi

CDK_VERSION=$(npx cdk --version)
log "CDK version: $CDK_VERSION"

# ─── 4. Build TypeScript ───────────────────────────────────────────────────────
log "Compiling TypeScript..."
npm run build

# ─── 5. Bootstrap (idempotent) ─────────────────────────────────────────────────
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
log "Bootstrapping CDK for account=$ACCOUNT region=$REGION..."
npx cdk bootstrap "aws://$ACCOUNT/$REGION" --region "$REGION"

# ─── 6. Synth ─────────────────────────────────────────────────────────────────
log "Synthesizing CloudFormation template..."
npx cdk synth "$STACK" --region "$REGION"

# ─── 7. Deploy ────────────────────────────────────────────────────────────────
log "Deploying $STACK..."
npx cdk deploy "$STACK" \
  --region "$REGION" \
  --require-approval never \
  --outputs-file cdk-outputs.json

# ─── 8. Print outputs ─────────────────────────────────────────────────────────
if [ -f cdk-outputs.json ]; then
  log "Stack outputs:"
  node -e "
    const o = require('./cdk-outputs.json')['$STACK'] || {};
    Object.entries(o).forEach(([k,v]) => console.log('  ' + k + ': ' + v));
  "
fi

log "Done. Stack '$STACK' deployed successfully."
