import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { spawn } from 'node:child_process';
import path from 'node:path';

// Load credentials into the server process only; never send them to Vite.
const envFile = process.env.NEON_ENV_FILE ?? (existsSync('.env') ? '.env' : '.env.local');
if (existsSync(envFile)) loadEnvFile(envFile);
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is missing. Run neon deploy to pull your connection variables.');
  process.exit(1);
}

const migrate = process.argv.includes('--migrate');
// npm run db:import-competition -- <file.json> [--dry-run]: the file is passed through, never read here.
const importAt = process.argv.indexOf('--import-competition');
const importArgs = importAt < 0 ? [] : [
  '--import-competition', path.resolve(process.argv[importAt + 1] ?? ''),
  ...(process.argv.includes('--dry-run') ? ['--dry-run'] : []),
];
const child = spawn('dotnet', [
  'run', '--no-launch-profile', '--project', 'api/MountedGames.Api.csproj', '--',
  ...(migrate ? ['--migrate-database'] : []),
  ...(process.argv.includes('--seed-review') ? ['--seed-review-competitions'] : []),
  ...(process.argv.includes('--seed-history') ? ['--seed-history'] : []),
  ...(process.argv.includes('--reseed-review') ? ['--reseed-review-competitions'] : []),
  ...importArgs,
], {
  stdio: 'inherit',
  env: {
    ...process.env,
    Database__Provider: 'postgres',
    ASPNETCORE_URLS: process.env.ASPNETCORE_URLS ?? 'http://localhost:5050',
  },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', () => {
  console.error('Could not start dotnet. Install the .NET 10 SDK.');
  process.exitCode = 1;
});
child.on('exit', code => { process.exitCode = code ?? 1; });
