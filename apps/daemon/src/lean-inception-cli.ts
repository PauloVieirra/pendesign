// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { resolveDaemonUrl } from './daemon-url.js';

const SUPPORTED_EXTENSIONS = new Set(['.md', '.txt']);

function printHelp() {
  process.stdout.write(`Usage:
  od lean-inception extract <doc-path...> [--project <id>] [--runtime <name>] [--json] [--quiet]
  od lean-inception status [--project <id>] [--json]
  od lean-inception list [--project <id>] [--json]
  od lean-inception remove-doc <doc-id> [--project <id>] [--json] [--yes]
  od lean-inception reset [--project <id>] [--yes] [--json]
`);
}

function parseFlags(args: string[]): { flags: Record<string, string | boolean>; positional: string[] } {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) {
      if (a.startsWith('-') && a.length > 1) {
        if (a === '-h') flags['help'] = true;
        continue;
      }
      positional.push(a);
      continue;
    }
    const name = a.slice(2);
    if (['json', 'quiet', 'yes', 'help'].includes(name)) {
      flags[name] = true;
    } else {
      flags[name] = args[++i] ?? '';
    }
  }
  return { flags, positional };
}

function resolveProjectId(flags: Record<string, string | boolean>): string {
  const fromFlag = typeof flags['project'] === 'string' ? flags['project'] : '';
  if (fromFlag) return fromFlag;
  const fromEnv = process.env.OD_PROJECT_ID;
  if (fromEnv) return fromEnv;
  process.stderr.write('error: no project resolved; pass --project <id> or set OD_PROJECT_ID\n');
  process.exit(3);
}

async function callDaemon(method: string, url: string, body?: unknown): Promise<any> {
  const daemonUrl = await resolveDaemonUrl();
  const res = await fetch(`${daemonUrl}${url}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: any = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch { /* leave parsed as {} */ }
  return { status: res.status, body: parsed };
}

function countByConfidence(cards: Array<{ confidence: string }>): string {
  const counts: Record<string, number> = { high: 0, medium: 0, low: 0 };
  for (const c of cards) counts[c.confidence] = (counts[c.confidence] ?? 0) + 1;
  return Object.entries(counts).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(', ');
}

function printState(state: any): void {
  process.stdout.write('↳ Lean Inception status:\n');
  for (const [key, snap] of Object.entries(state.columns)) {
    const padded = key.padEnd(22, ' ');
    const cards = (snap as any).cards as Array<any>;
    const dist = cards.length > 0 ? ` (${countByConfidence(cards)})` : '';
    process.stdout.write(`    ${padded}${(snap as any).status}${dist}\n`);
  }
}

async function extract(args: string[]): Promise<void> {
  const { flags, positional } = parseFlags(args);
  if (flags['help']) { printHelp(); process.exit(0); }
  if (positional.length === 0) {
    process.stderr.write('error: extract requires at least one document path\n');
    process.exit(2);
  }
  const projectId = resolveProjectId(flags);
  const json = flags['json'] === true;
  const quiet = flags['quiet'] === true;
  const runtime = typeof flags['runtime'] === 'string' ? flags['runtime'] : undefined;

  const documents = [];
  for (const p of positional) {
    const abs = path.resolve(p);
    if (!fs.existsSync(abs)) {
      process.stderr.write(`error: file not found: ${p}\n`);
      process.exit(5);
    }
    const ext = path.extname(abs).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      process.stderr.write(`error: unsupported format (only .md and .txt): ${p}\n`);
      process.exit(5);
    }
    const buf = fs.readFileSync(abs);
    documents.push({
      filename: path.basename(abs),
      mime_type: ext === '.md' ? 'text/markdown' : 'text/plain',
      content_base64: buf.toString('base64'),
    });
  }

  if (!json && !quiet) {
    for (const d of documents) process.stdout.write(`↳ ${d.filename} ... extracting ...\n`);
  }

  const { status, body } = await callDaemon(
    'POST',
    `/api/projects/${encodeURIComponent(projectId)}/lean-inception/documents`,
    { documents, runtime },
  );
  if (status >= 400) {
    if (json) process.stdout.write(JSON.stringify(body) + '\n');
    else process.stderr.write(`error: ${body?.error?.code ?? 'UNKNOWN'}: ${body?.error?.message ?? ''}\n`);
    process.exit(1);
  }
  if (json) {
    process.stdout.write(JSON.stringify(body) + '\n');
    return;
  }
  printState(body.state);
}

async function status(args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const projectId = resolveProjectId(flags);
  const { status: code, body } = await callDaemon(
    'GET', `/api/projects/${encodeURIComponent(projectId)}/lean-inception`,
  );
  if (code >= 400) {
    process.stderr.write(`error: ${body?.error?.message ?? code}\n`);
    process.exit(1);
  }
  if (flags['json']) {
    process.stdout.write(JSON.stringify(body) + '\n');
    return;
  }
  printState(body.state);
}

async function list(args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const projectId = resolveProjectId(flags);
  const { status: code, body } = await callDaemon(
    'GET', `/api/projects/${encodeURIComponent(projectId)}/lean-inception/documents`,
  );
  if (code >= 400) {
    process.stderr.write(`error: ${body?.error?.message ?? code}\n`);
    process.exit(1);
  }
  if (flags['json']) {
    process.stdout.write(JSON.stringify(body) + '\n');
    return;
  }
  for (const d of body.documents as Array<any>) {
    process.stdout.write(`${d.id}  ${d.filename}  (${d.card_count} cards, ${d.extraction_status})\n`);
  }
}

async function removeDoc(args: string[]): Promise<void> {
  const { flags, positional } = parseFlags(args);
  const docId = positional[0];
  if (!docId) {
    process.stderr.write('error: remove-doc requires a document id\n');
    process.exit(2);
  }
  const projectId = resolveProjectId(flags);
  if (process.stdin.isTTY && !flags['yes']) {
    process.stderr.write(`warning: pass --yes to confirm removal of ${docId}\n`);
    process.exit(2);
  }
  const { status: code, body } = await callDaemon(
    'DELETE',
    `/api/projects/${encodeURIComponent(projectId)}/lean-inception/documents/${encodeURIComponent(docId)}`,
  );
  if (code >= 400) {
    process.stderr.write(`error: ${body?.error?.message ?? code}\n`);
    process.exit(1);
  }
  if (flags['json']) process.stdout.write(JSON.stringify(body) + '\n');
  else printState(body.state);
}

async function reset(args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const projectId = resolveProjectId(flags);
  if (!flags['yes']) {
    process.stderr.write('error: reset is destructive; pass --yes to confirm\n');
    process.exit(2);
  }
  const { status: code, body } = await callDaemon(
    'DELETE', `/api/projects/${encodeURIComponent(projectId)}/lean-inception`,
  );
  if (code >= 400) {
    process.stderr.write(`error: ${body?.error?.message ?? code}\n`);
    process.exit(1);
  }
  if (flags['json']) process.stdout.write(JSON.stringify(body) + '\n');
}

export async function runLeanInception(args: string[]): Promise<void> {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printHelp();
    process.exit(0);
  }
  const sub = args[0];
  const rest = args.slice(1);
  switch (sub) {
    case 'extract':    return extract(rest);
    case 'status':     return status(rest);
    case 'list':       return list(rest);
    case 'remove-doc': return removeDoc(rest);
    case 'reset':      return reset(rest);
    default:
      process.stderr.write(`error: unknown subcommand: ${sub}\n`);
      printHelp();
      process.exit(2);
  }
}
