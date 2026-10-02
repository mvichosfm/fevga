// Copies the game's web files into app/www for Capacitor. Run before `npx cap sync android`.
// The game has no build step, so this is a plain copy of what the website serves.
import { cpSync, rmSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const www = join(here, 'www');
rmSync(www, { recursive: true, force: true });
mkdirSync(www, { recursive: true });
for (const f of ['index.html', 'strategy.html', 'src', 'vendor']) cpSync(join(root, f), join(www, f), { recursive: true });
console.log('copied web files to', www);
