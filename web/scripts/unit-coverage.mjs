import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// This is the dependency-free unit scope, not whole-application coverage.
// Include every file in this scope even if a test stops importing it.
const files = [
  'src/competition/preference.ts',
  'src/lib/bib.ts',
  'src/lib/csv.ts',
  'src/lib/section.ts',
  'src/lib/time.ts',
  'src/lib/timetableDay.ts',
  'src/lib/timetableRows.ts',
  'src/live/recoverConnection.ts',
  'src/offline/cachePolicy.ts',
  'src/weather/requestCache.ts',
];
const help = spawnSync(process.execPath, ['--help'], { encoding: 'utf8' });
if (!help.stdout?.includes('--test-coverage-include-all')) {
  console.error('This coverage command requires Node with --test-coverage-include-all (verified on Node 26.10).');
  process.exit(1);
}
console.log('Coverage scope: ten helper modules only. React screens and the .NET API are not measured by this command.');
const result = spawnSync(process.execPath, [
  '--test', '--experimental-test-coverage', '--test-coverage-include-all',
  '--test-coverage-lines=97', '--test-coverage-branches=97', '--test-coverage-functions=97',
  ...files.map((file) => `--test-coverage-include=${file}`),
  'tests/*.test.mjs',
], { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'inherit' });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
