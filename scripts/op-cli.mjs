#!/usr/bin/env node

/**
 * OpenPaint CLI Helper
 * Quick commands for common OpenPaint workflows from OpenClaw
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const commands = {
  // Quick dev
  dev: () => run('bun run dev'),
  'dev:all': () => run('bun run dev:all'),

  // Quality
  typecheck: () => run('bun run type-check'),
  lint: () => run('bun run lint'),
  'lint:fix': () => run('bun run lint:fix'),
  validate: () => run('bun run validate'),

  // Testing
  test: () => run('bun run test'),
  'test:watch': () => run('bun run test:watch'),
  'test:visual': () => run('bun run test:visual'),
  'test:visual:update': () => run('bun run test:visual:update'),
  'test:coverage': () => run('bun run test:coverage'),

  // Build & Deploy
  build: () => run('bun run build'),
  'deploy:preview': () => run('bun run deploy:preview'),
  'deploy:prod': () => run('bun run deploy'),

  // Database
  'db:migrate': () => run('bun run db:migrate'),
  'db:seed': () => run('bun run db:seed'),
  'db:diff': () => run('bun run db:diff'),
  'db:reset': () => run('bun run db:reset'),
  'db:types': () => run('bun run db:generate-types'),

  // Info
  status: showStatus,
  services: showServices,
  tests: showTests,
  help: showHelp,
};

function run(cmd) {
  console.log(`\n🦞 Running: ${cmd}\n`);
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
}

function showStatus() {
  console.log('\n🦞 OpenPaint Status\n');
  console.log('Location:', ROOT);
  console.log('Branch:', execSync('git branch --show-current', { cwd: ROOT }).toString().trim());
  console.log('Deploy: https://sofapaint.vercel.app');
  console.log('\nQuick Commands:');
  console.log('  op dev           - Start dev server');
  console.log('  op typecheck     - TypeScript check');
  console.log('  op test          - Run tests');
  console.log('  op build         - Production build');
  console.log('  op deploy:preview - Deploy preview');
  console.log('  op help          - Show all commands\n');
}

function showServices() {
  const servicesPath = join(ROOT, 'src/services');
  const files = execSync('ls -1 *.ts', { cwd: servicesPath }).toString().split('\n').filter(Boolean);
  const dirs = execSync('ls -d */', { cwd: servicesPath }).toString().split('\n').filter(Boolean).map(d => d.replace('/', ''));

  console.log('\n🦞 OpenPaint Services\n');

  console.log('\n📄 Core Services:');
  files.forEach(f => console.log(`  ${f}`));

  console.log('\n📁 Service Modules:');
  dirs.forEach(d => console.log(`  ${d}/`));

  console.log('\nKey Files:');
  console.log('  src/main.ts           - Entry point');
  console.log('  src/types/index.ts     - Type exports');
  console.log('  app.js                 - Express server\n');
}

function showTests() {
  const testsPath = join(ROOT, 'tests');
  const dirs = execSync('ls -d */', { cwd: testsPath }).toString().split('\n').filter(Boolean).map(d => d.replace('/', ''));

  console.log('\n🦞 OpenPaint Tests\n');

  console.log('\n📁 Test Directories:');
  dirs.forEach(d => console.log(`  ${d}/`));

  console.log('\n🚀 Commands:');
  console.log('  op test              - Run unit tests');
  console.log('  op test:watch        - Watch mode');
  console.log('  op test:visual       - Visual regression');
  console.log('  op test:coverage      - Coverage report');
  console.log('  op test:visual:update - Update snapshots\n');
}

function showHelp() {
  console.log('\n🦞 OpenPaint CLI Helper\n');
  console.log('Usage: node scripts/op-cli.mjs <command>\n');
  console.log('Development:');
  console.log('  dev           Start dev server');
  console.log('  dev:all       Start dev + backend');
  console.log('\nQuality:');
  console.log('  typecheck     TypeScript validation');
  console.log('  lint          ESLint check');
  console.log('  lint:fix      Auto-fix lint issues');
  console.log('  validate      Full validation (type-check + lint + test)');
  console.log('\nTesting:');
  console.log('  test          Run unit tests');
  console.log('  test:watch    Watch mode');
  console.log('  test:visual   Visual regression tests');
  console.log('  test:coverage Coverage report');
  console.log('\nBuild & Deploy:');
  console.log('  build         Production build');
  console.log('  deploy:preview Deploy preview');
  console.log('  deploy:prod   Deploy production');
  console.log('\nDatabase:');
  console.log('  db:migrate    Push schema changes');
  console.log('  db:seed       Seed database');
  console.log('  db:diff       Show schema diff');
  console.log('  db:reset      Reset database');
  console.log('  db:types      Generate TypeScript types');
  console.log('\nInfo:');
  console.log('  status        Show project status');
  console.log('  services      List all services');
  console.log('  tests         List test directories');
  console.log('  help          Show this help\n');
}

// Parse command
const cmd = process.argv[2] || 'help';

if (commands[cmd]) {
  commands[cmd]();
} else {
  console.error(`\n❌ Unknown command: ${cmd}\n`);
  showHelp();
  process.exit(1);
}
