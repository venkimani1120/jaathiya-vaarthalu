// npm run dev at the repo root: the backend (http://localhost:4000) and the frontend (http://localhost:3000) together,
// each with its own .env and restarting on changes. Ctrl+C stops both.
const { spawn } = require('child_process');
const path = require('path');

const env = { backend: {}, frontend: { API_URL: process.env.API_URL || 'http://localhost:4000' } };
const kids = Object.entries(env).map(([dir, extra]) => {
  const p = spawn('npm', ['run', 'dev'], { cwd: path.join(__dirname, '..', dir), env: { ...process.env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const s of [p.stdout, p.stderr]) s.on('data', (b) => process.stdout.write(b.toString().replace(/^(?=.)/gm, `[${dir}] `)));
  p.on('exit', (code) => { console.log(`[${dir}] stopped (${code})`); stop(); });
  return p;
});
function stop() { for (const p of kids) if (p.exitCode === null) p.kill(); }
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
