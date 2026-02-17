# OpenPaint Scripts

This directory contains helper scripts for OpenPaint development workflows.

## op-cli.mjs

The OpenPaint CLI helper provides quick access to common development commands.

### Usage

```bash
cd /home/node/.openclaw/workspace/OpenPaint

# Show help
node scripts/op-cli.mjs help

# Show project status
node scripts/op-cli.mjs status

# List services
node scripts/op-cli.mjs services

# List test directories
node scripts/op-cli.mjs tests

# Development commands
node scripts/op-cli.mjs dev
node scripts/op-cli.mjs dev:all

# Quality commands
node scripts/op-cli.mjs typecheck
node scripts/op-cli.mjs lint
node scripts/op-cli.mjs lint:fix
node scripts/op-cli.mjs validate

# Testing commands
node scripts/op-cli.mjs test
node scripts/op-cli.mjs test:watch
node scripts/op-cli.mjs test:visual
node scripts/op-cli.mjs test:coverage

# Build & Deploy
node scripts/op-cli.mjs build
node scripts/op-cli.mjs deploy:preview
node scripts/op-cli.mjs deploy:prod

# Database commands
node scripts/op-cli.mjs db:migrate
node scripts/op-cli.mjs db:seed
node scripts/op-cli.mjs db:diff
node scripts/op-cli.mjs db:reset
node scripts/op-cli.mjs db:types
```

### As npm script

When bun is available, you can also use:
```bash
npm run op <command>
```

Example:
```bash
npm run op status
npm run op dev
npm run op test
```

## Other Scripts

### dev-all-safe.mjs
Safely starts both dev server and backend.

### run-visual-tests.mjs
Runs visual regression tests using Playwright. Use `--update-snapshots` to update baselines.

### ensure-public-css.js
Ensures public CSS files exist for Tailwind builds.
