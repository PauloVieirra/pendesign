// Minimal .env loader. The daemon calls this once at startup so OD_CLOUD_URL
// / OD_CLOUD_ANON_KEY land in process.env without the user having to source
// shell config first.
//
// Rules:
//   - Reads `<projectRoot>/.env.local` if present.
//   - Then reads `<projectRoot>/.env` if present (lower precedence).
//   - Quoted values strip surrounding " or '.
//   - Lines starting with # are comments.
//   - Existing process.env values WIN — env vars supplied via the shell beat
//     anything in .env files.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const FILES_IN_ORDER = ['.env.local', '.env'];

export function loadDotenvFromProjectRoot(projectRoot: string): void {
  for (const filename of FILES_IN_ORDER) {
    const filePath = path.join(projectRoot, filename);
    if (!existsSync(filePath)) continue;
    let content: string;
    try {
      content = readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      if (!key) continue;
      // Existing shell values win.
      if (process.env[key] !== undefined && process.env[key] !== '') continue;
      let value = line.slice(eq + 1).trim();
      if (value.length >= 2) {
        const first = value[0];
        const last = value[value.length - 1];
        if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
          value = value.slice(1, -1);
        }
      }
      process.env[key] = value;
    }
  }
}
