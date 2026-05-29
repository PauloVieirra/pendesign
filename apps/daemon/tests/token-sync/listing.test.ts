import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { listProjectSourceFiles } from '../../src/token-sync/listing.js';

async function makeTree(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'od-listing-'));
  await writeFile(path.join(root, 'a.css'), '.x { color: red; }', 'utf8');
  await writeFile(path.join(root, 'b.html'), '<div></div>', 'utf8');
  await writeFile(path.join(root, 'c.htm'), '<div></div>', 'utf8');
  await writeFile(path.join(root, 'README.md'), '# x', 'utf8');
  await mkdir(path.join(root, 'sub'), { recursive: true });
  await writeFile(path.join(root, 'sub', 'd.css'), '.y { color: blue; }', 'utf8');
  await mkdir(path.join(root, 'node_modules', 'foo'), { recursive: true });
  await writeFile(path.join(root, 'node_modules', 'foo', 'e.css'), '.z {}', 'utf8');
  await mkdir(path.join(root, 'dist'), { recursive: true });
  await writeFile(path.join(root, 'dist', 'bundled.css'), '.w {}', 'utf8');
  await mkdir(path.join(root, '.git'), { recursive: true });
  await writeFile(path.join(root, '.git', 'config'), 'x', 'utf8');
  return root;
}

test('lists .css, .html, .htm files recursively', async () => {
  const root = await makeTree();
  const files = await listProjectSourceFiles(root);
  const rels = files.map((f) => path.relative(root, f.path)).sort();
  assert.deepEqual(rels, ['a.css', 'b.html', 'c.htm', 'sub/d.css']);
});

test('skips node_modules, dist, build, .next, out, hidden directories', async () => {
  const root = await makeTree();
  const files = await listProjectSourceFiles(root);
  for (const f of files) {
    assert.ok(!f.path.includes('node_modules'), `must skip node_modules: ${f.path}`);
    assert.ok(!f.path.includes('/dist/'), `must skip dist/: ${f.path}`);
    assert.ok(!f.path.includes('/.git/'), `must skip .git/: ${f.path}`);
  }
});

test('tags each file with its parser kind', async () => {
  const root = await makeTree();
  const files = await listProjectSourceFiles(root);
  for (const f of files) {
    if (f.path.endsWith('.css')) assert.equal(f.kind, 'css');
    else assert.equal(f.kind, 'html');
  }
});

test('caps at 200 files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'od-listing-cap-'));
  for (let i = 0; i < 250; i++) {
    await writeFile(path.join(root, `f${i}.css`), '.x{}', 'utf8');
  }
  const files = await listProjectSourceFiles(root);
  assert.equal(files.length, 200);
});
