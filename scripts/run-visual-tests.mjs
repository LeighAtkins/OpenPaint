import { spawnSync } from 'node:child_process';

function runPlaywrightTests(extraArgs = []) {
  return spawnSync('npx', ['playwright', 'test', ...extraArgs], {
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'pipe'],
  });
}

function printCapturedOutput(result) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

function containsPlaywrightBrowserMissing(output) {
  return output.includes("Executable doesn't exist");
}

function containsMissingSystemDependencies(output) {
  return (
    output.includes('error while loading shared libraries') ||
    output.includes('Host system is missing dependencies')
  );
}

function printDependencyHelp() {
  process.stderr.write('\n[Playwright] Browser dependencies are missing on this machine.\n');
  process.stderr.write('[Playwright] Run one of the following, then retry:\n');
  process.stderr.write('  npx playwright install --with-deps chromium\n');
  process.stderr.write('  sudo npx playwright install-deps chromium\n\n');
}

const extraArgs = process.argv.slice(2);

let result = runPlaywrightTests(extraArgs);
printCapturedOutput(result);

if (result.status === 0) {
  process.exit(0);
}

const output = `${result.stdout || ''}\n${result.stderr || ''}`;

if (containsPlaywrightBrowserMissing(output)) {
  process.stderr.write('\n[Playwright] Chromium binary missing, installing now...\n');
  const install = spawnSync('npx', ['playwright', 'install', 'chromium'], {
    encoding: 'utf8',
    stdio: 'inherit',
  });

  if (install.status !== 0) {
    process.exit(install.status || 1);
  }

  process.stderr.write('[Playwright] Install complete. Re-running visual tests...\n\n');
  result = runPlaywrightTests(extraArgs);
  printCapturedOutput(result);

  if (result.status === 0) {
    process.exit(0);
  }

  const rerunOutput = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (containsMissingSystemDependencies(rerunOutput)) {
    printDependencyHelp();
  }
  process.exit(result.status || 1);
}

if (containsMissingSystemDependencies(output)) {
  printDependencyHelp();
}

process.exit(result.status || 1);
