/**
 * `od images …` CLI subcommand dispatcher.
 *
 * Surface:
 *   od images search "<query>" [--count N] [--orientation horizontal|vertical|square]
 *                              [--min-width N] [--category <name>] [--json]
 *   od images download <url> <project-relative-path> [--no-optimize]
 *
 * Reads PIXABAY_API_KEY from env. (Settings UI writes it via the existing
 * media-config secret store; the daemon's launch env loads it from there.)
 */

import { searchPixabay, MissingApiKeyError, RateLimitedError, type PixabayCategory } from './images-search.js';
import { downloadImage } from './images-download.js';

const HELP = `Usage: od images <command> [options]

Commands:
  search "<query>" [--count N] [--orientation horizontal|vertical|square]
                   [--min-width N] [--category <name>] [--json]
    Searches Pixabay (free tier). Returns up to N results.
    Requires PIXABAY_API_KEY in env (set via Settings).

  download <url> <project-relative-path> [--no-optimize]
    Downloads <url> (must be on pixabay.com/cdn.pixabay.com) to the
    project-relative path. Optimizes JPEGs > 2000px when sharp is present.

Exit codes:
  0  success
  1  invalid usage
  2  PIXABAY_API_KEY not configured
  3  rate-limited (try again after the Retry-After header value)
  4  network/timeout/other`;

function flag(argv: string[], name: string): string | null {
  const i = argv.indexOf(name);
  if (i === -1 || i + 1 >= argv.length) return null;
  return argv[i + 1]!;
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

export async function runImages(argv: string[]): Promise<number> {
  const cmd = argv[0];
  if (!cmd) {
    console.error(HELP);
    return 1;
  }
  const rest = argv.slice(1);
  if (cmd === 'search') return runSearch(rest);
  if (cmd === 'download') return runDownload(rest);
  console.error(HELP);
  return 1;
}

async function runSearch(argv: string[]): Promise<number> {
  const query = argv.find((a) => !a.startsWith('--')) ?? '';
  if (!query) {
    console.error('search requires a query string');
    console.error(HELP);
    return 1;
  }
  const apiKey = process.env.PIXABAY_API_KEY ?? '';
  const countRaw = flag(argv, '--count');
  const orientationRaw = flag(argv, '--orientation');
  const minWidthRaw = flag(argv, '--min-width');
  const categoryRaw = flag(argv, '--category') as PixabayCategory | null;
  const asJson = hasFlag(argv, '--json');

  try {
    const results = await searchPixabay({
      query,
      apiKey,
      ...(countRaw !== null && { count: Number(countRaw) }),
      ...(orientationRaw === 'horizontal' || orientationRaw === 'vertical' ? { orientation: orientationRaw } : {}),
      ...(minWidthRaw !== null && { minWidth: Number(minWidthRaw) }),
      ...(categoryRaw !== null && { category: categoryRaw }),
    });
    if (asJson) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      if (results.length === 0) console.log('(no results)');
      for (const r of results) {
        console.log(`#${r.id}  ${r.width}x${r.height}  by ${r.user}  ${r.tags}`);
        console.log(`  url:  ${r.url}`);
        console.log(`  page: ${r.pageURL}`);
      }
    }
    return 0;
  } catch (err) {
    if (err instanceof MissingApiKeyError) {
      console.error('Error: PIXABAY_API_KEY not configured.');
      console.error('Set it in Settings → API Keys → Pixabay, or export PIXABAY_API_KEY=...');
      return 2;
    }
    if (err instanceof RateLimitedError) {
      console.error(`Pixabay rate-limited. Retry after ${err.retryAfterSec}s.`);
      return 3;
    }
    console.error(`Pixabay search failed: ${err instanceof Error ? err.message : String(err)}`);
    return 4;
  }
}

async function runDownload(argv: string[]): Promise<number> {
  const positional = argv.filter((a) => !a.startsWith('--'));
  const [url, dest] = positional;
  if (!url || !dest) {
    console.error('download requires <url> <project-relative-path>');
    console.error(HELP);
    return 1;
  }
  const noOptimize = hasFlag(argv, '--no-optimize');
  const projectRoot = process.env.OD_PROJECT_ROOT ?? process.cwd();
  try {
    const result = await downloadImage({ url, projectRoot, destRelative: dest, optimize: !noOptimize });
    console.log(result.absolutePath);
    return 0;
  } catch (err) {
    console.error(`download failed: ${err instanceof Error ? err.message : String(err)}`);
    return 4;
  }
}
