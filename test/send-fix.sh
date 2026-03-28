#!/usr/bin/env bash
# Quick curl test — sends one FIX message to the ingestion API.
#
# Usage:
#   ./test/send-fix.sh                                    # reads endpoint from cdk-outputs.json
#   API_URL=https://xxx.execute-api.us-east-1.amazonaws.com/prod ./test/send-fix.sh
set -euo pipefail

# ─── Resolve endpoint ─────────────────────────────────────────────────────────
if [ -z "${API_URL:-}" ]; then
  OUTPUTS="$(dirname "$0")/../cdk-outputs.json"
  if [ -f "$OUTPUTS" ]; then
    API_URL=$(node -e "
      const o = require('$OUTPUTS')['TradeLifecycleStack'] || {};
      const base = o['ApiEndpoint'] || o['TradeLifecycleApiEndpoint'] || '';
      process.stdout.write(base.replace(/\\/$/,'') + '/ingest');
    ")
  fi
fi

if [ -z "${API_URL:-}" ]; then
  echo "Error: no API endpoint found."
  echo "Deploy first or set: API_URL=https://... ./test/send-fix.sh"
  exit 1
fi

echo "Endpoint: $API_URL"
echo "------------------------------------------------------------"

SOH=$'\001'

send() {
  local label="$1"
  local fix="$2"
  echo
  echo "[$label]"
  curl -s -w "\n  HTTP %{http_code}" -X POST "$API_URL" \
    -H "Content-Type: application/json" \
    -d "{\"fix\": \"$fix\"}" | sed 's/^/  /'
  echo
}

# New Order Single — Buy 100 AAPL market
send "New Order Single — Buy 100 AAPL @ market" \
  "8=FIX.4.2${SOH}35=D${SOH}49=CLIENT1${SOH}56=BROKER${SOH}34=1${SOH}52=20240328-10:00:00${SOH}11=ORD001${SOH}21=1${SOH}55=AAPL${SOH}54=1${SOH}38=100${SOH}40=1${SOH}60=20240328-10:00:00${SOH}10=128${SOH}"

# New Order Single — Sell 50 MSFT limit
send "New Order Single — Sell 50 MSFT @ limit \$420" \
  "8=FIX.4.2${SOH}35=D${SOH}49=CLIENT1${SOH}56=BROKER${SOH}34=2${SOH}52=20240328-10:01:00${SOH}11=ORD002${SOH}21=1${SOH}55=MSFT${SOH}54=2${SOH}38=50${SOH}40=2${SOH}44=420.00${SOH}60=20240328-10:01:00${SOH}10=204${SOH}"

# Execution Report — partial fill
send "Execution Report — partial fill 40 AAPL @ \$178.50" \
  "8=FIX.4.2${SOH}35=8${SOH}49=BROKER${SOH}56=CLIENT1${SOH}34=4${SOH}52=20240328-10:03:00${SOH}37=EXEC001${SOH}11=ORD001${SOH}17=FILL001${SOH}20=0${SOH}39=1${SOH}55=AAPL${SOH}54=1${SOH}38=100${SOH}32=40${SOH}31=178.50${SOH}60=20240328-10:03:00${SOH}10=167${SOH}"

echo "------------------------------------------------------------"
echo "Done."
