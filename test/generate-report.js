#!/usr/bin/env node
/**
 * Generates a rich HTML test report from cucumber-report.json.
 * Run automatically after `npm run test:bdd` via the posttest:bdd hook,
 * or standalone: node test/generate-report.js
 */

const reporter = require('multiple-cucumber-html-reporter');
const fs       = require('fs');
const path     = require('path');

const REPORTS_DIR  = path.join(__dirname, 'reports');
const JSON_REPORT  = path.join(REPORTS_DIR, 'cucumber-report.json');
const HTML_DIR     = path.join(REPORTS_DIR, 'html');

if (!fs.existsSync(JSON_REPORT)) {
  console.error(`Report JSON not found: ${JSON_REPORT}`);
  console.error('Run `npm run test:bdd` first.');
  process.exit(1);
}

reporter.generate({
  jsonDir:    REPORTS_DIR,
  reportPath: HTML_DIR,

  metadata: {
    browser:  { name: 'node',     version: process.versions.node },
    device:   'AWS Lambda / API Gateway',
    platform: { name: process.platform, version: process.version },
  },

  customData: {
    title: 'Trade Lifecycle — Test Run',
    data: [
      { label: 'Project',     value: 'trade-lifecycle' },
      { label: 'Environment', value: process.env.NODE_ENV || 'dev' },
      { label: 'Region',      value: process.env.AWS_REGION || 'us-east-1' },
      { label: 'Run date',    value: new Date().toISOString() },
    ],
  },

  pageTitle:   'Trade Lifecycle Test Report',
  reportName:  'FIX Ingestion — BDD Test Results',
  displayDuration: true,
  durationInMS:    true,
  openReportInBrowser: false,
});

console.log(`\nReport generated: ${HTML_DIR}/index.html`);
