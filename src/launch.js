// Start.bat runs this: starts the server without a window and waits for it to report, so a problem shows in the console.
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const server = path.join(path.dirname(fileURLToPath(import.meta.url)), 'server.js');
const args = process.argv.slice(2).filter((a) => a !== '--background');

console.log('  Starting VOD Review Tool...');
const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', server, '--background', ...args], {
  detached: true, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
});

const done = (code, text) => { if (text) console.log(text); clearTimeout(timer); child.unref(); process.exit(code); };
const timer = setTimeout(() => done(1, '\n  The app did not answer within 30 seconds. Try "Start.bat console" to see what it does.\n'), 30000);

child.on('message', (m) => {
  if (m.ok) return done(0, `  Running at ${m.url}.${m.opened ? ' Your browser opens it; this window closes by itself.' : ''}`);
  if (m.already) return done(0, `  It was already running at ${m.url}${m.opened ? ', opened it in your browser' : ''}.`);
  done(1, `\n  The app could not start:\n  ${m.error}\n${m.log ? `\n  More in ${m.log}\n` : ''}`);
});
child.on('exit', (code) => done(1, `\n  The app stopped right away (code ${code}). Try "Start.bat console" to see why.\n`));
child.on('error', (err) => done(1, `\n  Could not start Node.js: ${err.message}\n`));
