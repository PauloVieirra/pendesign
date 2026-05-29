// CLI subcommands for cloud (multi-user) operations.
//
// Talks to the local daemon via HTTP — same model as `od media`, `od plugin`,
// etc. Cloud auth surface (login/logout/whoami) is what Phase 0 ships;
// remaining subcommands (publish/share/proposals/...) come online as later
// phases land.

// @ts-nocheck — matches cli.ts conventions; runtime types live in the daemon
// route layer where they're strictly checked.

import { resolveDaemonUrl } from './daemon-url.js';

interface CloudParsedFlags {
  email?: string;
  password?: string;
  name?: string;
  json?: boolean;
  'daemon-url'?: string;
  help?: boolean;
}

export async function runCloud(args: string[]): Promise<void> {
  const sub = args.find((a) => !a.startsWith('-'));
  if (!sub || sub === 'help' || sub === '-h' || sub === '--help') {
    printCloudHelp();
    return;
  }
  const idx = args.indexOf(sub);
  const rest = [...args.slice(0, idx), ...args.slice(idx + 1)];

  switch (sub) {
    case 'login':
      return runCloudLogin(rest);
    case 'logout':
      return runCloudLogout(rest);
    case 'whoami':
    case 'status':
      return runCloudWhoami(rest, sub === 'status');
    case 'projects':
      return runCloudProjectsSubcmd(rest);
    case 'publish':
      return runCloudPublish(rest);
    case 'open':
      return runCloudOpen(rest);
    case 'delete':
      return runCloudDelete(rest);
    case 'refresh':
      return runCloudRefresh(rest);
    case 'versions':
      return runCloudVersions(rest);
    default:
      console.error(`unknown subcommand: od cloud ${sub}`);
      printCloudHelp();
      process.exit(1);
  }
}

function printCloudHelp(): void {
  console.log(`Usage: od cloud <subcommand> [options]

Auth (Phase 0):
  login          Sign in. Flags: --email <e>  --password <p>  --json
  logout         Clear local session. Flags: --json
  whoami         Print current user. Flags: --json
  status         Print backend configuration + signed-in status. Flags: --json

Projects (Phase 1):
  projects list                          List my cloud projects. Flags: --json
  publish <local-project-id>             Publish a local project to cloud.
                                          Flags: --name <n>  --message <m>  --json
  open <cloud-project-id>                Download + extract to .od/cloud-projects/.
                                          Flags: --json
  refresh <cloud-project-id>             Pull latest if local is behind. Flags: --json
  versions <cloud-project-id>            List version history. Flags: --json
  delete <cloud-project-id>              Owner-only delete. Flags: --json

Common flags:
  --daemon-url <url>   Override the local daemon URL.
  --json               Machine-readable output.

Requires OD_CLOUD_URL + OD_CLOUD_ANON_KEY in the daemon's environment to
enable cloud features. See .env.example and the multi-user spec.`);
}

function parseCloudFlags(args: string[]): CloudParsedFlags {
  const flags: CloudParsedFlags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') { flags.json = true; continue; }
    if (arg === '--help' || arg === '-h') { flags.help = true; continue; }
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = args[i + 1];
      if (value === undefined || value.startsWith('--')) {
        // boolean flag with no value
        (flags as any)[key] = true;
      } else {
        (flags as any)[key] = value;
        i++;
      }
    }
  }
  return flags;
}

async function cliDaemonBaseUrl(flags: CloudParsedFlags): Promise<string> {
  const url = await resolveDaemonUrl({ flagUrl: flags['daemon-url'] });
  return url.replace(/\/$/, '');
}

async function promptHidden(prompt: string): Promise<string> {
  // Read a single line from stdin without echoing (best-effort: tty only).
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error('hidden input requires a TTY (try piping the password via --password instead)'));
      return;
    }
    process.stdout.write(prompt);
    const stdin = process.stdin as any;
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let buffer = '';
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode?.(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          resolve(buffer);
          return;
        }
        if (ch === '') {
          stdin.setRawMode?.(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          process.exit(130);
        }
        if (ch === '' || ch === '\b') {
          buffer = buffer.slice(0, -1);
          continue;
        }
        buffer += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function promptLine(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const stdin = process.stdin as any;
    stdin.resume();
    stdin.setEncoding('utf8');
    let buffer = '';
    const onData = (chunk: string) => {
      buffer += chunk;
      const newlineIdx = buffer.indexOf('\n');
      if (newlineIdx !== -1) {
        const line = buffer.slice(0, newlineIdx).replace(/\r$/, '');
        stdin.pause();
        stdin.removeListener('data', onData);
        resolve(line);
      }
    };
    stdin.on('data', onData);
  });
}

async function runCloudLogin(args: string[]): Promise<void> {
  const flags = parseCloudFlags(args);
  if (flags.help) { printCloudHelp(); return; }
  const daemonUrl = await cliDaemonBaseUrl(flags);

  let email = flags.email;
  if (!email) {
    email = (await promptLine('Email: ')).trim();
  }
  if (!email) {
    console.error('email required');
    process.exit(2);
  }
  let password = flags.password;
  if (!password) {
    password = await promptHidden('Password: ');
  }
  if (!password) {
    console.error('password required');
    process.exit(2);
  }

  const resp = await fetch(`${daemonUrl}/api/cloud/auth/signin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await safeJson(resp);

  if (!resp.ok) {
    if (flags.json) {
      console.log(JSON.stringify({ ok: false, status: resp.status, ...body }));
    } else {
      console.error(`login failed (${resp.status}): ${body.error ?? 'unknown'}`);
      if (body.details) console.error(`  ${body.details}`);
    }
    process.exit(1);
  }

  if (flags.json) {
    console.log(JSON.stringify({ ok: true, user: body.user }));
  } else {
    console.log(`signed in as ${body.user.email}`);
  }
}

async function runCloudLogout(args: string[]): Promise<void> {
  const flags = parseCloudFlags(args);
  if (flags.help) { printCloudHelp(); return; }
  const daemonUrl = await cliDaemonBaseUrl(flags);
  const resp = await fetch(`${daemonUrl}/api/cloud/auth/signout`, {
    method: 'POST',
  });
  if (!resp.ok && resp.status !== 503) {
    const body = await safeJson(resp);
    if (flags.json) {
      console.log(JSON.stringify({ ok: false, status: resp.status, ...body }));
    } else {
      console.error(`logout failed (${resp.status})`);
    }
    process.exit(1);
  }
  if (flags.json) {
    console.log(JSON.stringify({ ok: true }));
  } else {
    console.log('signed out');
  }
}

async function runCloudWhoami(args: string[], statusOnly: boolean): Promise<void> {
  const flags = parseCloudFlags(args);
  if (flags.help) { printCloudHelp(); return; }
  const daemonUrl = await cliDaemonBaseUrl(flags);

  if (statusOnly) {
    const resp = await fetch(`${daemonUrl}/api/cloud/auth/status`);
    const body = await safeJson(resp);
    if (flags.json) {
      console.log(JSON.stringify(body));
    } else {
      console.log(`configured=${body.configured} signed_in=${body.signed_in}${body.email ? ` email=${body.email}` : ''}`);
    }
    return;
  }

  const resp = await fetch(`${daemonUrl}/api/cloud/auth/me`);
  const body = await safeJson(resp);
  if (!resp.ok) {
    if (flags.json) {
      console.log(JSON.stringify({ ok: false, status: resp.status, ...body }));
    } else if (resp.status === 401) {
      console.log('not signed in');
    } else if (resp.status === 503) {
      console.log('cloud not configured (set OD_CLOUD_URL + OD_CLOUD_ANON_KEY)');
    } else {
      console.error(`whoami failed (${resp.status}): ${body.error ?? 'unknown'}`);
    }
    process.exit(resp.status === 401 || resp.status === 503 ? 0 : 1);
  }
  if (flags.json) {
    console.log(JSON.stringify({ ok: true, user: body.user }));
  } else {
    console.log(`${body.user.email} (${body.user.name})`);
  }
}

async function safeJson(resp: Response): Promise<any> {
  try {
    const text = await resp.text();
    if (!text) return {};
    return JSON.parse(text);
  } catch {
    return {};
  }
}

// =============================================================================
// Phase 1 — Project lifecycle CLI subcommands.
// =============================================================================

async function runCloudProjectsSubcmd(args: string[]): Promise<void> {
  const sub = args.find((a) => !a.startsWith('-')) || 'list';
  const idx = args.indexOf(sub);
  const rest = sub === 'list' ? args : [...args.slice(0, idx), ...args.slice(idx + 1)];
  if (sub !== 'list') {
    console.error(`unknown subcommand: od cloud projects ${sub}`);
    process.exit(1);
  }
  return runCloudProjectsList(rest);
}

async function runCloudProjectsList(args: string[]): Promise<void> {
  const flags = parseCloudFlags(args);
  if (flags.help) { printCloudHelp(); return; }
  const daemonUrl = await cliDaemonBaseUrl(flags);
  const resp = await fetch(`${daemonUrl}/api/cloud/projects`);
  const body = await safeJson(resp);
  if (!resp.ok) {
    handleErrorOutput(flags.json, resp.status, body, 'list_failed');
    return;
  }
  if (flags.json) {
    console.log(JSON.stringify(body));
    return;
  }
  const projects = body.projects ?? [];
  if (projects.length === 0) {
    console.log('(no cloud projects)');
    return;
  }
  for (const p of projects) {
    console.log(`${p.id}  v${p.current_version}  ${p.name} (${p.role})`);
  }
}

async function runCloudPublish(args: string[]): Promise<void> {
  const flags = parseCloudFlags(args);
  if (flags.help) { printCloudHelp(); return; }
  const localId = args.find((a) => !a.startsWith('-'));
  if (!localId) {
    console.error('usage: od cloud publish <local-project-id> [--name <n>] [--message <m>]');
    process.exit(2);
  }
  const daemonUrl = await cliDaemonBaseUrl(flags);
  const resp = await fetch(`${daemonUrl}/api/cloud/projects/publish`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      local_project_id: localId,
      name: (flags as any).name,
      message: (flags as any).message,
    }),
  });
  const body = await safeJson(resp);
  if (!resp.ok) {
    handleErrorOutput(flags.json, resp.status, body, 'publish_failed');
    return;
  }
  if (flags.json) {
    console.log(JSON.stringify(body));
  } else {
    console.log(`published ${body.project.id} (${body.project.name}) v${body.project.current_version}`);
  }
}

async function runCloudOpen(args: string[]): Promise<void> {
  const flags = parseCloudFlags(args);
  if (flags.help) { printCloudHelp(); return; }
  const id = args.find((a) => !a.startsWith('-'));
  if (!id) {
    console.error('usage: od cloud open <cloud-project-id>');
    process.exit(2);
  }
  const daemonUrl = await cliDaemonBaseUrl(flags);
  const resp = await fetch(`${daemonUrl}/api/cloud/projects/${encodeURIComponent(id)}/open`, {
    method: 'POST',
  });
  const body = await safeJson(resp);
  if (!resp.ok) {
    handleErrorOutput(flags.json, resp.status, body, 'open_failed');
    return;
  }
  if (flags.json) {
    console.log(JSON.stringify(body));
  } else {
    console.log(`opened v${body.base_version} → ${body.local_path}`);
  }
}

async function runCloudDelete(args: string[]): Promise<void> {
  const flags = parseCloudFlags(args);
  if (flags.help) { printCloudHelp(); return; }
  const id = args.find((a) => !a.startsWith('-'));
  if (!id) {
    console.error('usage: od cloud delete <cloud-project-id>');
    process.exit(2);
  }
  const daemonUrl = await cliDaemonBaseUrl(flags);
  const resp = await fetch(`${daemonUrl}/api/cloud/projects/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!resp.ok) {
    const body = await safeJson(resp);
    handleErrorOutput(flags.json, resp.status, body, 'delete_failed');
    return;
  }
  if (flags.json) {
    console.log(JSON.stringify({ ok: true }));
  } else {
    console.log(`deleted ${id}`);
  }
}

async function runCloudRefresh(args: string[]): Promise<void> {
  const flags = parseCloudFlags(args);
  if (flags.help) { printCloudHelp(); return; }
  const id = args.find((a) => !a.startsWith('-'));
  if (!id) {
    console.error('usage: od cloud refresh <cloud-project-id>');
    process.exit(2);
  }
  const daemonUrl = await cliDaemonBaseUrl(flags);
  const resp = await fetch(`${daemonUrl}/api/cloud/projects/${encodeURIComponent(id)}/refresh`, {
    method: 'POST',
  });
  const body = await safeJson(resp);
  if (!resp.ok) {
    handleErrorOutput(flags.json, resp.status, body, 'refresh_failed');
    return;
  }
  if (flags.json) {
    console.log(JSON.stringify(body));
  } else {
    console.log(`current_version=${body.current_version} downloaded=${body.downloaded}`);
  }
}

async function runCloudVersions(args: string[]): Promise<void> {
  const flags = parseCloudFlags(args);
  if (flags.help) { printCloudHelp(); return; }
  const id = args.find((a) => !a.startsWith('-'));
  if (!id) {
    console.error('usage: od cloud versions <cloud-project-id>');
    process.exit(2);
  }
  const daemonUrl = await cliDaemonBaseUrl(flags);
  const resp = await fetch(`${daemonUrl}/api/cloud/projects/${encodeURIComponent(id)}/versions`);
  const body = await safeJson(resp);
  if (!resp.ok) {
    handleErrorOutput(flags.json, resp.status, body, 'versions_failed');
    return;
  }
  if (flags.json) {
    console.log(JSON.stringify(body));
    return;
  }
  const versions = body.versions ?? [];
  if (versions.length === 0) {
    console.log('(no versions)');
    return;
  }
  for (const v of versions) {
    console.log(`v${v.version_num}  ${v.size_bytes}b  ${v.message ?? ''}  (${v.created_at})`);
  }
}

function handleErrorOutput(json: boolean | undefined, status: number, body: any, fallback: string): void {
  if (json) {
    console.log(JSON.stringify({ ok: false, status, ...body }));
  } else {
    console.error(`${fallback} (${status}): ${body.error ?? 'unknown'}`);
    if (body.details) console.error(`  ${body.details}`);
  }
  if (status !== 401 && status !== 503 && status !== 404) {
    process.exit(1);
  }
}
