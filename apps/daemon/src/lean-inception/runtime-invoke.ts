import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import path from 'node:path';

export interface LeanInceptionRuntimeAttachment {
  filename: string;
  mimeType: string;
  content: Buffer;
}

export interface LeanInceptionRuntimeRequest {
  runtime: string;            // 'claude' | 'codex' | ...
  systemPrompt: string;
  userPrompt: string;
  timeoutMs: number;
  /** Optional image attachments. Each is written to a temp file and passed via --image flags. */
  attachments?: LeanInceptionRuntimeAttachment[];
}

export interface LeanInceptionRuntimeResponse {
  rawStdout: string;
  durationMs: number;
  model: string | null;
  promptTokens: number | null;
  outputTokens: number | null;
}

export type LeanInceptionRuntimeInvoker =
  (req: LeanInceptionRuntimeRequest) => Promise<LeanInceptionRuntimeResponse>;

export class RuntimeInvocationError extends Error {
  constructor(
    public readonly code: 'RUNTIME_UNAVAILABLE' | 'EXTRACTION_TIMEOUT' | 'EXTRACTION_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'RuntimeInvocationError';
  }
}

/**
 * Default invoker: spawns `<runtime>` as a subprocess, feeds the user prompt via stdin,
 * passes the system prompt via --system-prompt. For Claude specifically, uses
 * `-p` and `--output-format json` to get a one-shot JSON response.
 *
 * Tests should NOT exercise this code path — pass a stubbed `LeanInceptionRuntimeInvoker`
 * to the extraction service instead.
 */
export const invokeAgentForExtraction: LeanInceptionRuntimeInvoker = async (req) => {
  if (req.runtime !== 'claude') {
    throw new RuntimeInvocationError(
      'RUNTIME_UNAVAILABLE',
      `runtime not supported in MVP: ${req.runtime} (only 'claude' is wired)`,
    );
  }
  const args = [
    '-p',
    '--output-format', 'json',
    '--system-prompt', req.systemPrompt,
  ];

  // Write image attachments to temp files and pass via --image flags.
  let tempDir: string | null = null;
  const tempPaths: string[] = [];
  if (req.attachments && req.attachments.length > 0) {
    tempDir = mkdtempSync(path.join(tmpdir(), 'li-img-'));
    for (const att of req.attachments) {
      const tmpPath = path.join(tempDir, att.filename);
      writeFileSync(tmpPath, att.content);
      tempPaths.push(tmpPath);
      args.push('--image', tmpPath);
    }
  }

  const start = Date.now();
  return new Promise<LeanInceptionRuntimeResponse>((resolve, reject) => {
    const child = spawn('claude', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const cleanupTempFiles = () => {
      for (const p of tempPaths) {
        try { unlinkSync(p); } catch { /* best-effort */ }
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, req.timeoutMs);

    child.on('error', (err: any) => {
      clearTimeout(timer);
      cleanupTempFiles();
      if (err?.code === 'ENOENT') {
        reject(new RuntimeInvocationError('RUNTIME_UNAVAILABLE', `claude CLI not found on PATH`));
        return;
      }
      reject(new RuntimeInvocationError('EXTRACTION_FAILED', String(err?.message ?? err)));
    });

    child.stdout?.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString('utf8'); });

    child.on('close', (code) => {
      clearTimeout(timer);
      cleanupTempFiles();
      if (timedOut) {
        reject(new RuntimeInvocationError('EXTRACTION_TIMEOUT', `claude extraction timed out after ${req.timeoutMs}ms`));
        return;
      }
      if (code !== 0) {
        reject(new RuntimeInvocationError(
          'EXTRACTION_FAILED',
          `claude exited with code ${code}: ${stderr.slice(0, 500)}`,
        ));
        return;
      }
      resolve({
        rawStdout: stdout,
        durationMs: Date.now() - start,
        model: null,
        promptTokens: null,
        outputTokens: null,
      });
    });

    child.stdin?.write(req.userPrompt);
    child.stdin?.end();
  });
};
