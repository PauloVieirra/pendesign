import type { Express } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { readFile as fsReadFile } from 'node:fs/promises';
import { detectAgents } from './agents.js';
import {
  SkillImportError,
  deleteUserSkill,
  findSkillById,
  importUserSkill,
  listSkillFiles,
  splitDerivedSkillId,
  updateUserSkill,
} from './skills.js';
import { listCodexPets, readCodexPetSpritesheet } from './codex-pets.js';
import { syncCommunityPets } from './community-pets-sync.js';
import { readDesignSystem } from './design-systems.js';
import {
  LocalDesignSystemImportError,
  cleanDisplayName,
  importLocalDesignSystemProject,
  nextAvailableSlug,
  slugify,
} from './design-system-import.js';
import {
  applyCreateCollection,
  applyCreateGroup,
  applyCreateVariable,
  applyDeleteCollection,
  applyDeleteGroup,
  applyDeleteVariable,
  applyUpdateVariable,
  migrateFromTokensCss,
  newCollectionId,
  newGroupId,
  readVariables,
  saveVariables,
  VariablesError,
  withDsLock,
  type VariablesFile,
} from './design-system-variables.js';
import { importGitHubDesignSystemProject } from './design-system-github-import.js';
import { FigmaImportError, importFigmaDesignSystem } from './design-system-figma.js';
import { getFigmaPat, readMcpConfig, writeMcpConfig } from './mcp-config.js';
import { renderDesignSystemPreview } from './design-system-preview.js';
import { renderDesignSystemShowcase } from './design-system-showcase.js';
import { listPromptTemplates, readPromptTemplate } from './prompt-templates.js';
import { readAppConfig } from './app-config.js';
import { installFromTarget, uninstallById } from './library-install.js';
import type { RouteDeps } from './server-context.js';

export interface RegisterStaticResourceRoutesDeps extends RouteDeps<'http' | 'paths' | 'resources' | 'db' | 'events'> {}

export function registerStaticResourceRoutes(app: Express, ctx: RegisterStaticResourceRoutesDeps) {
  const {
    RUNTIME_DATA_DIR,
    RUNTIME_DATA_DIR_CANONICAL,
    PROJECT_ROOT,
    DESIGN_SYSTEMS_DIR,
    USER_DESIGN_SYSTEMS_DIR,
    DESIGN_TEMPLATES_DIR,
    USER_DESIGN_TEMPLATES_DIR,
    SKILLS_DIR,
    USER_SKILLS_DIR,
    PROMPT_TEMPLATES_DIR,
    BUNDLED_PETS_DIR,
  } = ctx.paths;
  const {
    listAllSkills,
    listAllDesignTemplates,
    listAllSkillLikeEntries,
    listAllDesignSystems,
    mimeFor,
  } = ctx.resources;
  const { isLocalSameOrigin, resolvedPortRef, sendApiError } = ctx.http;
  // Subproject B: when DS variables change we (a) source-patch every project
  // HTML file whose `:root { ... }` declarations reference variables that
  // appear in the regenerated tokens.css and (b) fan out a
  // `design-system-changed` SSE event to the project events sinks so the
  // FileViewer iframe reloads against the patched source. Both helpers are
  // best-effort: failures must never block the variables-save handler that
  // produced the change.
  const projectEventSinks = ctx.events?.activeProjectEventSinks as
    | Map<string, Set<(payload: any) => void>>
    | undefined;
  const db = ctx.db;
  const requireLocalOrigin = (req: any, res: any) => {
    if (isLocalSameOrigin(req, resolvedPortRef.current)) return true;
    sendApiError(res, 403, 'FORBIDDEN', 'local origin required');
    return false;
  };

  app.get('/api/agents', async (_req, res) => {
    try {
      const config = await readAppConfig(RUNTIME_DATA_DIR);
      const list = await detectAgents(config.agentCliEnv ?? {});
      res.json({ agents: list });
    } catch (err: any) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get('/api/skills', async (_req, res) => {
    try {
      const skills = await listAllSkills();
      // Strip full body + on-disk dir from the listing — frontend fetches the
      // body via /api/skills/:id when needed (keeps the listing payload small).
      res.json({
        skills: skills.map(({ body, dir: _dir, ...rest }) => ({
          ...rest,
          hasBody: typeof body === 'string' && body.length > 0,
        })),
      });
    } catch (err: any) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get('/api/skills/:id', async (req, res) => {
    try {
      const skills = await listAllSkills();
      const skill = findSkillById(skills, req.params.id);
      if (!skill) return res.status(404).json({ error: 'skill not found' });
      const { dir: _dir, ...serializable } = skill;
      res.json(serializable);
    } catch (err: any) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Design templates — the rendering catalogue. Same shape as /api/skills
  // (so the web client can reuse SkillSummary types) but rooted at
  // DESIGN_TEMPLATE_ROOTS so the listing stays focused on template-style
  // entries without bleeding functional skills into the EntryView gallery.
  app.get('/api/design-templates', async (_req, res) => {
    try {
      const templates = await listAllDesignTemplates();
      res.json({
        designTemplates: templates.map(({ body, dir: _dir, ...rest }) => ({
          ...rest,
          hasBody: typeof body === 'string' && body.length > 0,
        })),
      });
    } catch (err: any) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get('/api/design-templates/:id', async (req, res) => {
    try {
      const templates = await listAllDesignTemplates();
      const template = findSkillById(templates, req.params.id);
      if (!template) return res.status(404).json({ error: 'design template not found' });
      const { dir: _dir, ...serializable } = template;
      res.json(serializable);
    } catch (err: any) {
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /api/skills/import — write a new SKILL.md under USER_SKILLS_DIR
  // from a UI-supplied body. The next /api/skills request surfaces it
  // automatically because listSkills walks USER_SKILLS_DIR first.
  app.post('/api/skills/import', async (req, res) => {
    try {
      const result = await importUserSkill(USER_SKILLS_DIR, req.body || {});
      const skills = await listAllSkills();
      const skill = findSkillById(skills, result.id);
      if (!skill) {
        return sendApiError(
          res,
          500,
          'INTERNAL_ERROR',
          'imported skill was not found in catalog',
        );
      }
      const { dir: _dir, body: _body, ...serializable } = skill;
      res.status(201).json({
        skill: {
          ...serializable,
          hasBody: typeof skill.body === 'string' && skill.body.length > 0,
        },
      });
    } catch (err: any) {
      if (err instanceof SkillImportError) {
        const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'BAD_REQUEST' ? 400 : 500;
        return sendApiError(res, status, err.code, err.message);
      }
      sendApiError(res, 500, 'INTERNAL_ERROR', String(err));
    }
  });

  // PUT /api/skills/:id — update an existing user-managed skill's
  // SKILL.md (and, when the user edits a built-in for the first time,
  // clone its side files into USER_SKILLS_DIR/<slug>/ so subsequent
  // /api/skills/:id/{files,example,assets/*} requests keep resolving
  // the bundled assets/references/scripts/examples). See PR #955 review.
  app.put('/api/skills/:id', async (req, res) => {
    try {
      const skills = await listAllSkills();
      const skill = findSkillById(skills, req.params.id);
      if (!skill) {
        return sendApiError(res, 404, 'NOT_FOUND', 'skill not found');
      }
      const result = await updateUserSkill(USER_SKILLS_DIR, {
        ...(req.body || {}),
        id: skill.id,
        sourceDir: skill.dir,
      });
      const next = await listAllSkills();
      const updated = findSkillById(next, result.id);
      if (!updated) {
        return sendApiError(
          res,
          500,
          'INTERNAL_ERROR',
          'updated skill was not found in catalog',
        );
      }
      const { dir: _dir, body: _body, ...serializable } = updated;
      res.json({
        skill: {
          ...serializable,
          hasBody: typeof updated.body === 'string' && updated.body.length > 0,
        },
      });
    } catch (err: any) {
      if (err instanceof SkillImportError) {
        const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'BAD_REQUEST' ? 400 : 500;
        return sendApiError(res, status, err.code, err.message);
      }
      sendApiError(res, 500, 'INTERNAL_ERROR', String(err));
    }
  });

  // GET /api/skills/:id/files — flat listing of the files that ship with
  // a skill. Used by the Settings → Skills detail panel to render the
  // file tree (capped server-side to keep payload bounded).
  app.get('/api/skills/:id/files', async (req, res) => {
    try {
      const skills = await listAllSkills();
      const skill = findSkillById(skills, req.params.id);
      if (!skill) {
        return sendApiError(res, 404, 'NOT_FOUND', 'skill not found');
      }
      const files = await listSkillFiles(skill.dir);
      res.json({ files });
    } catch (err: any) {
      sendApiError(res, 500, 'INTERNAL_ERROR', String(err));
    }
  });

  // Codex hatch-pet registry — pets packaged by the upstream `hatch-pet`
  // skill under `${CODEX_HOME:-$HOME/.codex}/pets/`. Surfaced so the web
  // pet settings can offer one-click adoption of recently-hatched pets.
  app.get('/api/codex-pets', async (_req, res) => {
    try {
      const result = await listCodexPets({
        baseUrl: '',
        bundledRoot: BUNDLED_PETS_DIR,
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: String(err) });
    }
  });

  // One-click community sync. Hits the Codex Pet Share + j20 Hatchery
  // catalogs and drops every pet into `${CODEX_HOME:-$HOME/.codex}/pets/`
  // so `GET /api/codex-pets` (and the web Pet settings) pick them up
  // immediately. The body is intentionally tiny — we keep the heavier
  // tuning knobs (`--limit`, `--concurrency`) on the CLI script and
  // only surface `force` + `source` here.
  app.post('/api/codex-pets/sync', async (req, res) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const sourceRaw = typeof body.source === 'string' ? body.source : 'all';
      const source =
        sourceRaw === 'petshare' || sourceRaw === 'hatchery'
          ? sourceRaw
          : 'all';
      const result = await syncCommunityPets({
        source,
        force: Boolean(body.force),
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: String((err && err.message) || err) });
    }
  });

  app.get('/api/codex-pets/:id/spritesheet', async (req, res) => {
    try {
      const sheet = await readCodexPetSpritesheet(req.params.id, {
        bundledRoot: BUNDLED_PETS_DIR,
      });
      if (!sheet) {
        return res
          .status(404)
          .type('text/plain')
          .send('codex pet spritesheet not found');
      }
      const mime =
        sheet.ext === 'webp'
          ? 'image/webp'
          : sheet.ext === 'gif'
            ? 'image/gif'
            : 'image/png';
      res.type(mime);
      // Same-origin callers (the web app proxies `/api/*` through to
      // the daemon, so PetSettings adoption fetches arrive same-origin)
      // do not need any CORS header here. We only echo
      // `Access-Control-Allow-Origin` for sandboxed iframes / data:
      // URIs (Origin: null) which need it to draw the bytes onto a
      // canvas without tainting. Local pet bytes should not be exposed
      // to arbitrary third-party origins via a wildcard ACAO.
      if (req.headers.origin === 'null') {
        res.setHeader('Access-Control-Allow-Origin', 'null');
      }
      res.setHeader('Cache-Control', 'no-store');
      res.sendFile(sheet.absPath);
    } catch (err: any) {
      res.status(500).type('text/plain').send(String(err));
    }
  });

  // Parse the tokens.css generated by saveVariables and return a map from
  // CSS custom-property name (e.g. `--brand-primary-500`) to its declared
  // value. The grammar is intentionally simple: we only care about the
  // `--name: value;` declarations, since those are the entries we'll
  // rewrite inside each project's `:root { ... }` block.
  function extractTokensFromCss(css: string): Map<string, string> {
    const tokens = new Map<string, string>();
    if (!css) return tokens;
    const re = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
    let match: RegExpExecArray | null;
    while ((match = re.exec(css)) !== null) {
      const name = match[1];
      const value = match[2]?.trim();
      if (name && value) tokens.set(name, value);
    }
    return tokens;
  }

  // Rewrite declarations inside every `:root { ... }` block of an HTML file
  // so that any custom-property whose name appears in `tokens` gets its
  // value replaced by the new value. Declarations whose names are NOT in
  // `tokens` are left untouched — this is critical, otherwise we'd risk
  // clobbering project-local overrides the user has hand-edited into the
  // file. Non-`:root` CSS and the rest of the HTML are also untouched.
  function patchTokensInHtml(html: string, tokens: Map<string, string>): string {
    if (!html || tokens.size === 0) return html;
    return html.replace(/:root\s*\{([^}]*)\}/g, (full, body: string) => {
      let patched = body;
      for (const [name, value] of tokens) {
        // Hyphens are literal outside character classes, so we can drop the
        // value straight into the pattern. Capture the prefix (`  --x:`) and
        // trailing `;` so the rewrite preserves the surrounding whitespace.
        const re = new RegExp(`(${name})\\s*:\\s*[^;]+;`, 'g');
        patched = patched.replace(re, `$1: ${value};`);
      }
      return `:root {${patched}}`;
    });
  }

  // Extract the body of the first `:root { ... }` block from a tokens.css
  // string. Returns the inner declarations only (no braces, trimmed).
  function extractRootBlock(tokensCss: string): string {
    const match = /:root\s*\{([\s\S]*?)\}/.exec(tokensCss);
    if (!match || !match[1]) return '';
    return match[1].trim();
  }

  // Ensure each project HTML file owns a singleton `<style data-od-ds-tokens>`
  // element in `<head>` containing the DS's current `:root { ... }`. This is
  // what lets Preview mode (URL-load, no bridge) resolve `var(--token)`
  // references — the runtime style injected by the iframe bridge only lives
  // while Edit/Dual mode is active. If the tag already exists we replace its
  // contents; otherwise we inject it as the first child inside `<head>` so
  // any later sheet can still override the cascade.
  function ensureDsTokensStyleTag(html: string, tokensCss: string): string {
    const rootBody = extractRootBlock(tokensCss);
    if (!rootBody) return html;
    const styleBlock = `<style data-od-ds-tokens>:root {\n${rootBody}\n}</style>`;

    const existing = /<style\s+data-od-ds-tokens[^>]*>[\s\S]*?<\/style>/i;
    if (existing.test(html)) {
      return html.replace(existing, styleBlock);
    }

    const headOpen = /<head\b[^>]*>/i;
    const headMatch = headOpen.exec(html);
    if (headMatch) {
      const insertAt = headMatch.index + headMatch[0].length;
      return html.slice(0, insertAt) + `\n  ${styleBlock}` + html.slice(insertAt);
    }

    const bodyOpen = /<body\b[^>]*>/i;
    const bodyMatch = bodyOpen.exec(html);
    if (bodyMatch) {
      return html.slice(0, bodyMatch.index) + `<head>${styleBlock}</head>\n` + html.slice(bodyMatch.index);
    }
    return html;
  }

  // Walk a project root recursively and return absolute paths to every
  // `*.html` / `*.htm` file. We skip dotfiles and common build/output
  // directories so a project with `node_modules/` or `dist/` doesn't make us
  // open thousands of files for no win.
  async function walkProjectHtmlFiles(root: string): Promise<string[]> {
    const fsp = await import('node:fs/promises');
    const out: string[] = [];
    const queue: string[] = [root];
    while (queue.length > 0) {
      const current = queue.shift()!;
      let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }> = [];
      try {
        entries = await fsp.readdir(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        if (['node_modules', 'dist', 'build', 'figma'].includes(entry.name)) continue;
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) queue.push(full);
        else if (entry.isFile() && /\.html?$/i.test(entry.name)) out.push(full);
      }
    }
    return out;
  }

  // Walk every project whose `designSystemId` matches the changed DS and
  // source-patch the `:root` blocks of their HTML files in place. Projects
  // whose HTML never had matching var declarations remain bitwise identical
  // (the `replace` returns the same string and we skip the write).
  async function patchProjectsUsingDesignSystem(designSystemId: string, dsDir: string): Promise<void> {
    if (!db) return;
    const projectsDir = ctx.paths.PROJECTS_DIR;
    if (!projectsDir) return;
    let tokensCss = '';
    try {
      tokensCss = await fsReadFile(path.join(dsDir, 'tokens.css'), 'utf8');
    } catch {
      return;
    }
    const tokens = extractTokensFromCss(tokensCss);

    let projects: Array<{ id: string; designSystemId?: string | null }> = [];
    try {
      const { listProjects } = await import('./db.js');
      projects = listProjects(db) as any;
    } catch {
      return;
    }

    const fsp = await import('node:fs/promises');
    for (const project of projects) {
      if (project?.designSystemId !== designSystemId) continue;
      const projectRoot = path.join(projectsDir, project.id);
      let files: string[] = [];
      try { files = await walkProjectHtmlFiles(projectRoot); } catch { continue; }
      for (const file of files) {
        try {
          const original = await fsp.readFile(file, 'utf8');
          // First: rewrite any `:root { ... }` blocks the agent inlined into
          // the source so existing declarations track the new values. Second:
          // inject/refresh the DS-owned `<style data-od-ds-tokens>` block in
          // `<head>` so Preview mode (no bridge) can still resolve `var()`
          // references against the current tokens.
          let patched = patchTokensInHtml(original, tokens);
          patched = ensureDsTokensStyleTag(patched, tokensCss);
          if (patched !== original) {
            await fsp.writeFile(file, patched, 'utf8');
          }
        } catch {
          // Skip unreadable / locked files — best-effort propagation.
        }
      }
    }
  }

  // Broadcast a `design-system-changed` event to every project SSE sink so
  // FileViewer iframes can reload against the freshly-patched HTML. We
  // intentionally fan out to ALL active project sinks; the web client
  // filters by its own state (it ignores the event when the project's
  // designSystemId doesn't match). That's cheaper and simpler than indexing
  // sinks by DS id, and the fan-out cost is bounded by the number of
  // currently-open project tabs.
  function notifyDesignSystemChanged(designSystemId: string): void {
    if (!projectEventSinks) return;
    for (const [projectId, sinks] of projectEventSinks.entries()) {
      const payload = {
        type: 'design-system-changed' as const,
        designSystemId,
        projectId,
        ts: Date.now(),
      };
      for (const sink of Array.from(sinks)) {
        try {
          sink(payload);
        } catch {
          sinks.delete(sink);
        }
      }
    }
  }

  // Single closure called after every variables-mutating handler. Wraps the
  // patch + notify into one best-effort step so a failure in either branch
  // never propagates into the response of the underlying save handler.
  async function afterDesignSystemSave(designSystemId: string, dsDir: string): Promise<void> {
    try {
      await patchProjectsUsingDesignSystem(designSystemId, dsDir);
    } catch {
      // Source-patch is best-effort; the SSE fan-out still tells the UI to
      // reload, and the next manual save (or daemon restart) re-runs the
      // patch loop with the same tokens.css.
    }
    try {
      notifyDesignSystemChanged(designSystemId);
    } catch {
      // SSE fan-out is best-effort; the next file-changed event from
      // chokidar (if any matching file gets re-saved) still triggers a
      // reload via the existing path.
    }
  }

  async function resolveDsDir(id: string): Promise<{ dir: string; key: string } | null> {
    // The catalog lists user-owned DSs with a `user:` id prefix; the
    // on-disk directory is the bare slug. Built-in DSs are not editable
    // through this endpoint.
    if (!id.startsWith('user:')) return null;
    const dirName = id.slice('user:'.length);
    if (!/^[a-z0-9-]+$/.test(dirName)) return null;
    const dir = path.join(USER_DESIGN_SYSTEMS_DIR, dirName);
    try {
      const stats = fs.statSync(dir);
      if (!stats.isDirectory()) return null;
    } catch {
      return null;
    }
    return { dir, key: id };
  }

  app.get('/api/design-systems', async (_req, res) => {
    try {
      const systems = await listAllDesignSystems();
      res.json({
        designSystems: systems.map(({ body, ...rest }) => rest),
      });
    } catch (err: any) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get('/api/design-systems/:id', (_req, _res, next) => {
    // The design-system workflow owns the detail shape now because user-created
    // systems may be backed by a review workspace project. Let the richer route
    // registered in server.ts answer this request.
    next();
  });

  app.get('/api/prompt-templates', async (_req, res) => {
    try {
      const templates = await listPromptTemplates(PROMPT_TEMPLATES_DIR);
      res.json({
        promptTemplates: templates.map(({ prompt: _prompt, ...rest }) => rest),
      });
    } catch (err: any) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get('/api/prompt-templates/:surface/:id', async (req, res) => {
    try {
      const tpl = await readPromptTemplate(
        PROMPT_TEMPLATES_DIR,
        req.params.surface,
        req.params.id,
      );
      if (!tpl)
        return res.status(404).json({ error: 'prompt template not found' });
      res.json({ promptTemplate: tpl });
    } catch (err: any) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Showcase HTML for a design system — palette swatches, typography
  // samples, sample components, and the full DESIGN.md rendered as prose.
  // Built at request time from the on-disk DESIGN.md so any update to the
  // file shows up on the next view, no rebuild needed.
  app.get('/api/design-systems/:id/preview', (_req, _res, next) => {
    next();
  });

  // Marketing-style showcase derived from the same DESIGN.md — full landing
  // page parameterised by the system's tokens. Same lazy-render strategy as
  // /preview: built at request time, no caching.
  app.get('/api/design-systems/:id/showcase', (_req, _res, next) => {
    next();
  });

  app.get('/api/design-systems/:id/variables', async (req, res) => {
    if (!requireLocalOrigin(req, res)) return;
    try {
      const resolved = await resolveDsDir(req.params.id);
      if (!resolved) {
        return sendApiError(res, 404, 'DS_NOT_FOUND', `design system not found or not editable: ${req.params.id}`);
      }
      const existing = await readVariables(resolved.dir);
      if (existing) return res.json({ variables: existing });
      let tokensCss = '';
      try {
        tokensCss = await fsReadFile(path.join(resolved.dir, 'tokens.css'), 'utf8');
      } catch { /* tokens.css may not exist for empty DSs */ }
      const migrated = migrateFromTokensCss(tokensCss);
      await withDsLock(resolved.key, () => saveVariables(resolved.dir, migrated));
      res.json({ variables: migrated, migrated: true });
    } catch (err: any) {
      sendApiError(res, 500, 'INTERNAL_ERROR', String(err?.message ?? err));
    }
  });

  // Raw tokens.css for a user-owned DS. Same-origin reads need no auth
  // beyond the local-origin gate already enforced by the variables routes;
  // we mirror it here so future generated artifacts can drop a regular
  // `<link rel="stylesheet" href="/api/design-systems/<id>/tokens.css">`
  // and have it stay live as the variables are edited. Cache-Control
  // no-store so an iframe reload always sees the freshly-saved file.
  app.get('/api/design-systems/:id/tokens.css', async (req, res) => {
    try {
      const resolved = await resolveDsDir(req.params.id);
      if (!resolved) {
        res.status(404).type('text/plain').send('design system not found');
        return;
      }
      const css = await fsReadFile(path.join(resolved.dir, 'tokens.css'), 'utf8').catch(() => null);
      if (css == null) {
        res.status(404).type('text/plain').send('tokens.css not found');
        return;
      }
      res.type('text/css').set('Cache-Control', 'no-store').send(css);
    } catch (err: any) {
      res.status(500).type('text/plain').send(String(err?.message ?? err));
    }
  });

  app.put('/api/design-systems/:id/variables', async (req, res) => {
    if (!requireLocalOrigin(req, res)) return;
    try {
      const resolved = await resolveDsDir(req.params.id);
      if (!resolved) {
        return sendApiError(res, 404, 'DS_NOT_FOUND', `design system not found or not editable: ${req.params.id}`);
      }
      const body = req.body as VariablesFile | undefined;
      if (!body || body.version !== 1 || !Array.isArray(body.collections)) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'request body must be a VariablesFile { version: 1, collections: [...] }');
      }
      await withDsLock(resolved.key, () => saveVariables(resolved.dir, body));
      await afterDesignSystemSave(req.params.id, resolved.dir);
      res.json({ variables: body });
    } catch (err: any) {
      sendApiError(res, 500, 'INTERNAL_ERROR', String(err?.message ?? err));
    }
  });

  async function loadOrMigrate(dir: string, key: string): Promise<VariablesFile> {
    const existing = await readVariables(dir);
    if (existing) return existing;
    let css = '';
    try { css = await fsReadFile(path.join(dir, 'tokens.css'), 'utf8'); } catch {}
    const migrated = migrateFromTokensCss(css);
    await withDsLock(key, () => saveVariables(dir, migrated));
    return migrated;
  }

  function variablesErrorToStatus(err: unknown): { status: number; code: string; message: string } | null {
    if (err instanceof VariablesError) {
      return { status: err.code === 'NOT_FOUND' ? 404 : 400, code: err.code, message: err.message };
    }
    return null;
  }

  app.put('/api/design-systems/:id/variables/:variableId', async (req, res) => {
    if (!requireLocalOrigin(req, res)) return;
    try {
      const resolved = await resolveDsDir(req.params.id);
      if (!resolved) return sendApiError(res, 404, 'DS_NOT_FOUND', `design system not found: ${req.params.id}`);
      const patch = req.body as Partial<{ name: string; type: string; value: unknown }>;
      if (!patch || typeof patch !== 'object') {
        return sendApiError(res, 400, 'BAD_REQUEST', 'patch body required');
      }
      await withDsLock(resolved.key, async () => {
        const current = await loadOrMigrate(resolved.dir, resolved.key);
        const next = applyUpdateVariable(current, { variableId: req.params.variableId, patch: patch as any });
        await saveVariables(resolved.dir, next);
        return next;
      });
      await afterDesignSystemSave(req.params.id, resolved.dir);
      res.json({ ok: true });
    } catch (err) {
      const mapped = variablesErrorToStatus(err);
      if (mapped) return sendApiError(res, mapped.status, mapped.code, mapped.message);
      sendApiError(res, 500, 'INTERNAL_ERROR', String((err as any)?.message ?? err));
    }
  });

  app.delete('/api/design-systems/:id/variables/:variableId', async (req, res) => {
    if (!requireLocalOrigin(req, res)) return;
    try {
      const resolved = await resolveDsDir(req.params.id);
      if (!resolved) return sendApiError(res, 404, 'DS_NOT_FOUND', `design system not found: ${req.params.id}`);
      await withDsLock(resolved.key, async () => {
        const current = await loadOrMigrate(resolved.dir, resolved.key);
        const next = applyDeleteVariable(current, { variableId: req.params.variableId });
        await saveVariables(resolved.dir, next);
      });
      await afterDesignSystemSave(req.params.id, resolved.dir);
      res.json({ ok: true });
    } catch (err) {
      sendApiError(res, 500, 'INTERNAL_ERROR', String((err as any)?.message ?? err));
    }
  });

  app.post('/api/design-systems/:id/variables/collections', async (req, res) => {
    if (!requireLocalOrigin(req, res)) return;
    try {
      const resolved = await resolveDsDir(req.params.id);
      if (!resolved) return sendApiError(res, 404, 'DS_NOT_FOUND', `design system not found: ${req.params.id}`);
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      if (!name) return sendApiError(res, 400, 'BAD_REQUEST', 'collection name required');
      await withDsLock(resolved.key, async () => {
        const current = await loadOrMigrate(resolved.dir, resolved.key);
        const next = applyCreateCollection(current, { name });
        await saveVariables(resolved.dir, next);
      });
      await afterDesignSystemSave(req.params.id, resolved.dir);
      res.json({ ok: true });
    } catch (err) {
      sendApiError(res, 500, 'INTERNAL_ERROR', String((err as any)?.message ?? err));
    }
  });

  app.delete('/api/design-systems/:id/variables/collections/:collectionId', async (req, res) => {
    if (!requireLocalOrigin(req, res)) return;
    try {
      const resolved = await resolveDsDir(req.params.id);
      if (!resolved) return sendApiError(res, 404, 'DS_NOT_FOUND', `design system not found: ${req.params.id}`);
      await withDsLock(resolved.key, async () => {
        const current = await loadOrMigrate(resolved.dir, resolved.key);
        const next = applyDeleteCollection(current, { collectionId: req.params.collectionId });
        await saveVariables(resolved.dir, next);
      });
      await afterDesignSystemSave(req.params.id, resolved.dir);
      res.json({ ok: true });
    } catch (err) {
      sendApiError(res, 500, 'INTERNAL_ERROR', String((err as any)?.message ?? err));
    }
  });

  app.post('/api/design-systems/:id/variables/collections/:collectionId/groups', async (req, res) => {
    if (!requireLocalOrigin(req, res)) return;
    try {
      const resolved = await resolveDsDir(req.params.id);
      if (!resolved) return sendApiError(res, 404, 'DS_NOT_FOUND', `design system not found: ${req.params.id}`);
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      if (!name) return sendApiError(res, 400, 'BAD_REQUEST', 'group name required');
      await withDsLock(resolved.key, async () => {
        const current = await loadOrMigrate(resolved.dir, resolved.key);
        const next = applyCreateGroup(current, { collectionId: req.params.collectionId, name });
        await saveVariables(resolved.dir, next);
      });
      await afterDesignSystemSave(req.params.id, resolved.dir);
      res.json({ ok: true });
    } catch (err) {
      const mapped = variablesErrorToStatus(err);
      if (mapped) return sendApiError(res, mapped.status, mapped.code, mapped.message);
      sendApiError(res, 500, 'INTERNAL_ERROR', String((err as any)?.message ?? err));
    }
  });

  app.delete('/api/design-systems/:id/variables/collections/:collectionId/groups/:groupId', async (req, res) => {
    if (!requireLocalOrigin(req, res)) return;
    try {
      const resolved = await resolveDsDir(req.params.id);
      if (!resolved) return sendApiError(res, 404, 'DS_NOT_FOUND', `design system not found: ${req.params.id}`);
      await withDsLock(resolved.key, async () => {
        const current = await loadOrMigrate(resolved.dir, resolved.key);
        const next = applyDeleteGroup(current, {
          collectionId: req.params.collectionId,
          groupId: req.params.groupId,
        });
        await saveVariables(resolved.dir, next);
      });
      await afterDesignSystemSave(req.params.id, resolved.dir);
      res.json({ ok: true });
    } catch (err) {
      const mapped = variablesErrorToStatus(err);
      if (mapped) return sendApiError(res, mapped.status, mapped.code, mapped.message);
      sendApiError(res, 500, 'INTERNAL_ERROR', String((err as any)?.message ?? err));
    }
  });

  app.post('/api/design-systems/:id/variables/collections/:collectionId/groups/:groupId/variables', async (req, res) => {
    if (!requireLocalOrigin(req, res)) return;
    try {
      const resolved = await resolveDsDir(req.params.id);
      if (!resolved) return sendApiError(res, 404, 'DS_NOT_FOUND', `design system not found: ${req.params.id}`);
      const { name, type, value } = req.body ?? {};
      if (typeof name !== 'string' || !name.trim()) return sendApiError(res, 400, 'BAD_REQUEST', 'variable name required');
      if (!['color', 'number', 'string', 'boolean'].includes(type)) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'type must be color | number | string | boolean');
      }
      await withDsLock(resolved.key, async () => {
        const current = await loadOrMigrate(resolved.dir, resolved.key);
        const next = applyCreateVariable(current, {
          collectionId: req.params.collectionId,
          groupId: req.params.groupId,
          name: name.trim(),
          type,
          value,
        });
        await saveVariables(resolved.dir, next);
      });
      await afterDesignSystemSave(req.params.id, resolved.dir);
      res.json({ ok: true });
    } catch (err) {
      const mapped = variablesErrorToStatus(err);
      if (mapped) return sendApiError(res, mapped.status, mapped.code, mapped.message);
      sendApiError(res, 500, 'INTERNAL_ERROR', String((err as any)?.message ?? err));
    }
  });

  // Pre-built example HTML for a skill — what a typical artifact from this
  // skill looks like. Lets users browse skills without running an agent.
  //
  // The skill's `id` (from SKILL.md frontmatter `name`) can differ from its
  // on-disk folder name (e.g. id `magazine-web-ppt` lives in `skills/guizang-ppt/`),
  // so we resolve the actual directory via listSkills() rather than guessing.
  //
  // Resolution order:
  //   1. Derived id (`<parent>:<child>`):
  //      <parentDir>/examples/<child>.html — pre-baked single-file sample.
  //      Subfolder layouts (e.g. live-artifact's
  //      `examples/<name>/template.html`) are intentionally not served:
  //      they still contain `{{data.x}}` placeholders that only the
  //      daemon-side renderer fills in, and serving the raw template
  //      would render visible placeholder braces in the gallery.
  //   2. <skillDir>/example.html — fully-baked static example (preferred)
  //   3. <skillDir>/assets/template.html  +
  //      <skillDir>/assets/example-slides.html — assemble at request time
  //      by replacing the `<!-- SLIDES_HERE -->` marker with the snippet
  //      and patching the placeholder <title>. Lets a skill ship one
  //      canonical seed plus a small content fragment, so the example
  //      never drifts from the seed.
  //   4. <skillDir>/assets/template.html — raw template, no content slides
  //   5. <skillDir>/assets/index.html — generic fallback
  //   6. First .html in <skillDir>/examples/ — used as a friendly fallback
  //      so a skill that aggregates examples (like live-artifact) still has
  //      a real preview on its parent card instead of returning 404.
  app.get('/api/skills/:id/example', async (req, res) => {
    try {
      // Span both functional skills and design templates: rendered example
      // HTML rewrites assets to /api/skills/<id>/... and we want those URLs
      // to keep resolving regardless of which root owns the backing folder
      // after the skills/design-templates split.
      const skills = await listAllSkillLikeEntries();

      // 1. Derived `<parent>:<child>` id — resolve straight to the matching
      // file under <parentDir>/examples/. Done before findSkillById so the
      // parent's normal fallback chain never accidentally serves a stale
      // file when a sample is missing (we'd rather 404 explicitly).
      const derived = splitDerivedSkillId(req.params.id);
      if (derived) {
        const parent = findSkillById(skills, derived.parentId);
        if (!parent) {
          return res.status(404).type('text/plain').send('skill not found');
        }
        const candidate = path.join(
          parent.dir,
          'examples',
          `${derived.childKey}.html`,
        );
        if (fs.existsSync(candidate)) {
          const html = await fs.promises.readFile(candidate, 'utf8');
          return res
            .type('text/html')
            .send(rewriteSkillAssetUrls(html, parent.id));
        }
        return res
          .status(404)
          .type('text/plain')
          .send('derived example not found');
      }

      const skill = findSkillById(skills, req.params.id);
      if (!skill) {
        return res.status(404).type('text/plain').send('skill not found');
      }

      const baked = path.join(skill.dir, 'example.html');
      if (fs.existsSync(baked)) {
        const html = await fs.promises.readFile(baked, 'utf8');
        return res
          .type('text/html')
          .send(rewriteSkillAssetUrls(html, skill.id));
      }

      const tpl = path.join(skill.dir, 'assets', 'template.html');
      const slides = path.join(skill.dir, 'assets', 'example-slides.html');
      if (fs.existsSync(tpl) && fs.existsSync(slides)) {
        try {
          const tplHtml = await fs.promises.readFile(tpl, 'utf8');
          const slidesHtml = await fs.promises.readFile(slides, 'utf8');
          const assembled = assembleExample(tplHtml, slidesHtml, skill.name);
          return res
            .type('text/html')
            .send(rewriteSkillAssetUrls(assembled, skill.id));
        } catch {
          // Fall through to raw template on read failure.
        }
      }
      if (fs.existsSync(tpl)) {
        const html = await fs.promises.readFile(tpl, 'utf8');
        return res
          .type('text/html')
          .send(rewriteSkillAssetUrls(html, skill.id));
      }
      const idx = path.join(skill.dir, 'assets', 'index.html');
      if (fs.existsSync(idx)) {
        const html = await fs.promises.readFile(idx, 'utf8');
        return res
          .type('text/html')
          .send(rewriteSkillAssetUrls(html, skill.id));
      }

      // Friendly fallback for skills that aggregate examples in a sibling
      // `examples/` folder (e.g. live-artifact). The parent card would
      // otherwise 404 even though plenty of perfectly valid samples ship
      // alongside SKILL.md; pick the first .html file alphabetically so
      // direct URL access (e.g. deep links) shows something representative.
      // Subfolder layouts are excluded for the same reason as the derived
      // resolver above — their `template.html` still has unresolved
      // `{{data.x}}` placeholders.
      const examplesDir = path.join(skill.dir, 'examples');
      if (fs.existsSync(examplesDir)) {
        let entries: string[] = [];
        try {
          entries = await fs.promises.readdir(examplesDir);
        } catch {
          entries = [];
        }
        entries.sort();
        for (const name of entries) {
          if (name.startsWith('.')) continue;
          if (!name.toLowerCase().endsWith('.html')) continue;
          const direct = path.join(examplesDir, name);
          try {
            const html = await fs.promises.readFile(direct, 'utf8');
            return res
              .type('text/html')
              .send(rewriteSkillAssetUrls(html, skill.id));
          } catch {
            continue;
          }
        }
      }

      res
        .status(404)
        .type('text/plain')
        .send(
          'no example.html, assets/template.html, assets/index.html, or examples/*.html for this skill',
        );
    } catch (err: any) {
      res.status(500).type('text/plain').send(String(err));
    }
  });

  // Static assets shipped beside a skill's example/template HTML. Lets the
  // example HTML reference `./assets/foo.png`-style paths that resolve
  // correctly when the response is loaded into a sandboxed `srcdoc` iframe
  // (where relative URLs would otherwise resolve against `about:srcdoc`).
  // The example response above rewrites `./assets/<file>` into a request
  // against this route; we still keep the on-disk paths human-friendly so
  // contributors can preview `example.html` straight from disk.
  app.get('/api/skills/:id/assets/*', async (req, res) => {
    try {
      // Same rationale as /example above — assets need to resolve whether
      // the owning skill folder lives under skills/ or design-templates/.
      const skills = await listAllSkillLikeEntries();
      const skill = findSkillById(skills, req.params.id);
      if (!skill) {
        return res.status(404).type('text/plain').send('skill not found');
      }
      const relPath = String((req.params as any)[0] || '');
      const assetsRoot = path.resolve(skill.dir, 'assets');
      const target = path.resolve(assetsRoot, relPath);
      if (target !== assetsRoot && !target.startsWith(assetsRoot + path.sep)) {
        return res.status(400).type('text/plain').send('invalid asset path');
      }
      if (!fs.existsSync(target)) {
        return res.status(404).type('text/plain').send('asset not found');
      }
      // The example HTML is rendered inside a sandboxed iframe (Origin: null).
      // Mirror the project /raw route's allowance so the iframe can fetch the
      // image bytes; same-origin web callers do not need this header.
      if (req.headers.origin === 'null') {
        res.header('Access-Control-Allow-Origin', '*');
      }
      res.type(mimeFor(target)).sendFile(target);
    } catch (err: any) {
      res.status(500).type('text/plain').send(String(err));
    }
  });

  app.post('/api/skills/install', async (req, res) => {
    if (!requireLocalOrigin(req, res)) return;
    try {
      const result = await installFromTarget(req.body, USER_SKILLS_DIR, 'skill');
      if (!result.ok) return res.status(400).json({ error: result.error });
      if (typeof result.dir !== 'string' || !result.dir) {
        return res.status(500).json({ error: 'skill install did not return an installation directory' });
      }
      const skills = await listAllSkills();
      const installedDir = fs.realpathSync.native(result.dir);
      const skill = skills.find((candidate) => fs.realpathSync.native(candidate.dir) === installedDir);
      if (!skill) {
        return res.status(500).json({ error: `installed skill was not found in catalog: ${result.dir}` });
      }
      res.json({
        skill: {
          ...skill,
          dir: undefined,
          body: undefined,
          hasBody: typeof skill.body === 'string' && skill.body.length > 0,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.delete('/api/skills/:id', async (req, res) => {
    if (!requireLocalOrigin(req, res)) return;
    try {
      const result = await uninstallById(req.params.id, USER_SKILLS_DIR, SKILLS_DIR, 'skill');
      if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post('/api/design-systems/install', async (req, res) => {
    if (!requireLocalOrigin(req, res)) return;
    try {
      const result = await installFromTarget(req.body, USER_DESIGN_SYSTEMS_DIR, 'design-system');
      if (!result.ok) return res.status(400).json({ error: result.error });
      if (typeof result.dir !== 'string' || !result.dir) {
        return res.status(500).json({ error: 'design system install did not return an installation directory' });
      }
      const systems = await listAllDesignSystems();
      const designSystemId = path.basename(fs.realpathSync.native(result.dir));
      const designSystem = systems.find((system) => system.id === designSystemId);
      if (!designSystem) {
        return res.status(500).json({ error: `installed design system was not found in catalog: ${result.dir}` });
      }
      res.json({ designSystem });
    } catch (err: any) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post('/api/design-systems/import/local', async (req, res) => {
    if (!requireLocalOrigin(req, res)) return;
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const inputPath =
        typeof body.baseDir === 'string'
          ? body.baseDir
          : typeof body.path === 'string'
            ? body.path
            : typeof body.localPath === 'string'
              ? body.localPath
              : '';
      if (!path.isAbsolute(inputPath)) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'local project path must be absolute');
      }
      let sourceRoot: string;
      let sourceStats: fs.Stats;
      try {
        sourceRoot = fs.realpathSync.native(inputPath);
        sourceStats = fs.statSync(sourceRoot);
      } catch {
        return sendApiError(res, 400, 'BAD_REQUEST', 'local project path was not found');
      }
      if (!sourceStats.isDirectory()) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'local project path must be a directory');
      }
      const sourceParent = path.dirname(sourceRoot);
      if (sourceRoot === sourceParent) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'local project path cannot be a filesystem root');
      }
      try {
        const runtimeRoot = fs.realpathSync.native(RUNTIME_DATA_DIR_CANONICAL);
        if (sourceRoot === runtimeRoot || sourceRoot.startsWith(`${runtimeRoot}${path.sep}`)) {
          return sendApiError(res, 400, 'BAD_REQUEST', 'cannot import Open Design runtime data');
        }
      } catch {
        // The runtime data directory may not exist yet in first-run tests.
      }

      const before = await listAllDesignSystems();
      const result = await importLocalDesignSystemProject(sourceRoot, USER_DESIGN_SYSTEMS_DIR, {
        name: typeof body.name === 'string' ? body.name : undefined,
        reservedIds: before.map((system) => system.id),
      });
      const systems = await listAllDesignSystems();
      const designSystem = systems.find((system) => system.id === result.id);
      if (!designSystem) {
        return sendApiError(
          res,
          500,
          'INTERNAL_ERROR',
          `imported design system was not found in catalog: ${result.dir}`,
        );
      }
      res.status(201).json({ designSystem });
    } catch (err: any) {
      if (err instanceof LocalDesignSystemImportError) {
        return sendApiError(res, err.code === 'BAD_REQUEST' ? 400 : 500, err.code, err.message);
      }
      sendApiError(res, 500, 'INTERNAL_ERROR', String(err));
    }
  });

  // Verify a Figma Personal Access Token before kicking off the
  // tokens-import flow. Two-step UX: the UI calls this on open with no
  // body to test whatever is saved in the figma-context MCP server; if
  // that fails, it prompts for a new PAT and calls this again with the
  // pasted value. Successful verification with a fresh PAT writes it
  // back to the figma-context env so the New Project Figma step picks
  // it up automatically.
  app.post('/api/design-systems/import/figma/verify-token', async (req, res) => {
    if (!requireLocalOrigin(req, res)) return;
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const providedToken = typeof body.pat === 'string' ? body.pat.trim() : '';
      let token = providedToken;
      if (!token) token = (await getFigmaPat(RUNTIME_DATA_DIR)) ?? '';
      if (!token) {
        return sendApiError(
          res,
          400,
          'FIGMA_TOKEN_REQUIRED',
          'No Figma token saved. Paste a personal access token to authorize.',
        );
      }
      // Figma PATs are ASCII-only (`figd_` + URL-safe characters). If
      // the user pasted prose by accident (the error explainer copy is
      // a common source of "→" sneaking in), the fetch call throws
      // "ByteString" because HTTP headers cannot carry non-ASCII. We
      // surface that as a clean BAD_REQUEST so the UI can guide them.
      if (!/^[\x20-\x7E]+$/.test(token)) {
        return sendApiError(
          res,
          400,
          'FIGMA_TOKEN_INVALID',
          'The Figma token has invalid characters. Personal access tokens look like `figd_…` and contain only letters, digits, `_`, and `-`. Re-copy from Figma → Settings → Personal access tokens — make sure you copied only the token, not the surrounding text.',
        );
      }
      if (!/^figd_[A-Za-z0-9_-]{20,}$/.test(token)) {
        // Loose shape check — Figma PATs all start with `figd_`. A
        // value that lacks the prefix is almost certainly the wrong
        // string (a URL, file id, or instruction snippet).
        return sendApiError(
          res,
          400,
          'FIGMA_TOKEN_INVALID',
          `That does not look like a Figma personal access token. Tokens start with \`figd_\` followed by 20+ URL-safe characters. Re-generate at Figma → Settings → Personal access tokens and paste only the token string.`,
        );
      }
      let figmaResp: Response;
      try {
        // PATs use X-Figma-Token, not Bearer. Bearer is for OAuth2 — a
        // scoped PAT sent via Bearer returns 403 "Invalid token" which
        // is hard to distinguish from a real scope issue.
        figmaResp = await fetch('https://api.figma.com/v1/me', {
          headers: { 'X-Figma-Token': token },
        });
      } catch (err: any) {
        return sendApiError(res, 502, 'FIGMA_API', `Could not reach Figma: ${String(err?.message ?? err)}`);
      }
      if (!figmaResp.ok) {
        let detail = '';
        try {
          const text = await figmaResp.text();
          try {
            const parsed = JSON.parse(text);
            if (parsed && typeof parsed.message === 'string') detail = parsed.message;
            else if (parsed && typeof parsed.err === 'string') detail = parsed.err;
          } catch {
            detail = text.slice(0, 240);
          }
        } catch { /* ignore */ }
        if (figmaResp.status === 401) {
          return sendApiError(
            res,
            401,
            'FIGMA_TOKEN_INVALID',
            `Figma rejected the token (401). The Personal Access Token is missing or revoked. Generate a new one at Figma → Settings → Personal access tokens.${detail ? ` Figma said: ${detail}` : ''}`,
          );
        }
        if (figmaResp.status === 403) {
          return sendApiError(
            res,
            403,
            'FIGMA_FORBIDDEN',
            `Figma rejected the token (403). Token may have been generated without the "current_user:read" scope. Generate a new token at Figma → Settings → Personal access tokens and check both "Read all files" and "Read your user info".${detail ? ` Figma said: ${detail}` : ''}`,
          );
        }
        return sendApiError(
          res,
          502,
          'FIGMA_API',
          `Figma verify failed: ${figmaResp.status} ${figmaResp.statusText}${detail ? ` — ${detail}` : ''}`,
        );
      }
      const meBody = (await figmaResp.json().catch(() => ({}))) as { id?: string; handle?: string; email?: string; img_url?: string };
      // Persist a freshly-verified token so subsequent imports + the
      // New Project Figma step reuse it. Best-effort.
      if (providedToken) {
        try {
          const cfg = await readMcpConfig(RUNTIME_DATA_DIR);
          const idx = cfg.servers.findIndex((s) => s.id === 'figma-context');
          if (idx >= 0) {
            const existing = cfg.servers[idx];
            if (existing) existing.env = { ...(existing.env ?? {}), FIGMA_API_KEY: providedToken };
          } else {
            cfg.servers.push({
              id: 'figma-context',
              command: 'npx',
              args: ['-y', 'figma-context-mcp'],
              transport: 'stdio',
              authMode: 'none',
              env: { FIGMA_API_KEY: providedToken },
            } as any);
          }
          await writeMcpConfig(RUNTIME_DATA_DIR, cfg);
        } catch { /* persistence is best-effort */ }
      }
      res.json({
        ok: true,
        user: {
          handle: meBody.handle ?? null,
          email: meBody.email ?? null,
          imgUrl: meBody.img_url ?? null,
        },
        savedToken: !!providedToken,
      });
    } catch (err: any) {
      sendApiError(res, 500, 'INTERNAL_ERROR', String(err && err.message ? err.message : err));
    }
  });

  // Figma-driven design-system import. Token comes from either the
  // request body or the figma-context MCP server's saved FIGMA_API_KEY;
  // a missing token surfaces a typed 400 so the UI can prompt the user
  // for one instead of failing with a generic "FIGMA_API 401". Token
  // sent in the request body is persisted to the figma-context server
  // env so subsequent imports / migrations reuse it without re-asking.
  app.post('/api/design-systems/import/figma', async (req, res) => {
    if (!requireLocalOrigin(req, res)) return;
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const figmaUrl = typeof body.figmaUrl === 'string'
        ? body.figmaUrl.trim()
        : typeof body.url === 'string'
          ? body.url.trim()
          : '';
      if (!figmaUrl) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'figmaUrl is required');
      }
      const providedToken = typeof body.pat === 'string'
        ? body.pat.trim()
        : typeof body.token === 'string'
          ? body.token.trim()
          : '';
      let token = providedToken;
      if (!token) {
        token = (await getFigmaPat(RUNTIME_DATA_DIR)) ?? '';
      }
      if (!token) {
        return sendApiError(
          res,
          400,
          'FIGMA_TOKEN_REQUIRED',
          'Figma personal access token not configured. Paste a token to authorize, or save one in Settings → MCP → figma-context.',
        );
      }
      if (!/^[\x20-\x7E]+$/.test(token) || !/^figd_[A-Za-z0-9_-]{20,}$/.test(token)) {
        return sendApiError(
          res,
          400,
          'FIGMA_TOKEN_INVALID',
          'The saved Figma token is not a valid personal access token. Re-paste it (Figma → Settings → Personal access tokens).',
        );
      }
      const before = await listAllDesignSystems();
      let result;
      try {
        result = await importFigmaDesignSystem(figmaUrl, token, USER_DESIGN_SYSTEMS_DIR, {
          name: typeof body.name === 'string' ? body.name : undefined,
          reservedIds: before.map((system) => system.id),
        });
      } catch (err: any) {
        if (err instanceof FigmaImportError) {
          const statusByCode: Record<string, number> = {
            BAD_REQUEST: 400,
            FIGMA_TOKEN_INVALID: 401,
            FIGMA_FORBIDDEN: 403,
            FIGMA_NOT_FOUND: 404,
            FIGMA_API: 502,
            INTERNAL_ERROR: 500,
          };
          return sendApiError(res, statusByCode[err.code] ?? 500, err.code, err.message);
        }
        throw err;
      }
      // Persist a freshly-provided token to the figma-context MCP server
      // env so subsequent imports + the New Project Figma step reuse it
      // without re-asking. We only do this when the user supplied the
      // token in this request AND it actually worked (i.e. we got here),
      // so a bad paste does not overwrite a working saved value.
      if (providedToken) {
        try {
          const cfg = await readMcpConfig(RUNTIME_DATA_DIR);
          const idx = cfg.servers.findIndex((s) => s.id === 'figma-context');
          if (idx >= 0) {
            const existing = cfg.servers[idx];
            if (existing) existing.env = { ...(existing.env ?? {}), FIGMA_API_KEY: providedToken };
          } else {
            cfg.servers.push({
              id: 'figma-context',
              command: 'npx',
              args: ['-y', 'figma-context-mcp'],
              transport: 'stdio',
              authMode: 'none',
              env: { FIGMA_API_KEY: providedToken },
            } as any);
          }
          await writeMcpConfig(RUNTIME_DATA_DIR, cfg);
        } catch {
          // Persistence is best-effort — the import already succeeded.
        }
      }
      const systems = await listAllDesignSystems();
      // User-owned DSs come back from `listAllDesignSystems` with the
      // `user:` id prefix (see `listDesignSystems` opts in server.ts);
      // the import function returns the bare directory slug. Match
      // both forms so the response carries the prefixed id the rest
      // of the UI (registry, picker) keys on.
      const designSystem =
        systems.find((system) => system.id === `user:${result.id}`)
        ?? systems.find((system) => system.id === result.id);
      if (!designSystem) {
        return sendApiError(
          res,
          500,
          'INTERNAL_ERROR',
          `imported Figma design system was not found in catalog: ${result.dir}`,
        );
      }
      res.status(201).json({ designSystem, warnings: result.warnings, stats: result.stats });
    } catch (err: any) {
      sendApiError(res, 500, 'INTERNAL_ERROR', String(err && err.message ? err.message : err));
    }
  });

  // Create an EMPTY design system attached to a project. Bypasses the full
  // DesignSystemCreationFlow wizard for users who want to start blank and
  // add tokens manually via the Manager. The slug is derived from the
  // project name with a short token suffix so multiple projects can host
  // "<project>-ds" without colliding. Writes the minimum scaffold the
  // catalog list expects (DESIGN.md + tokens.css + manifest.json +
  // variables.json), then updates the project's designSystemId so the
  // Manager picks it up on the next fetch.
  app.post('/api/projects/:projectId/design-system/create-empty', async (req, res) => {
    if (!requireLocalOrigin(req, res)) return;
    try {
      const { getProject, updateProject } = await import('./db.js');
      const project = getProject(db, req.params.projectId);
      if (!project) {
        return sendApiError(res, 404, 'PROJECT_NOT_FOUND', `project ${req.params.projectId} not found`);
      }
      const fsp = await import('node:fs/promises');
      const before = await listAllDesignSystems();
      const baseSlug = slugify(`${project.name || 'project'}-ds`);
      const id = await nextAvailableSlug(USER_DESIGN_SYSTEMS_DIR, baseSlug, before.map((s) => s.id));
      const outDir = path.join(USER_DESIGN_SYSTEMS_DIR, id);
      await fsp.mkdir(outDir, { recursive: true });

      const displayName = cleanDisplayName(project.name ? `${project.name} DS` : 'New design system');
      const designMd = `# ${displayName}\n\n> Category: User\n\nEmpty design system attached to project ${project.name ?? project.id}. Add color, typography, spacing, and other tokens from the Design Systems manager.\n`;
      await fsp.writeFile(path.join(outDir, 'DESIGN.md'), designMd, 'utf8');
      const manifest = {
        id,
        name: displayName,
        summary: 'Empty design system — add tokens from the manager.',
        category: 'User',
        source: { type: 'manual', projectId: req.params.projectId, createdAt: new Date().toISOString() },
        isEditable: true,
      };
      await fsp.writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

      // Seed an empty variables.json so the Manager's fetch hits the
      // already-migrated fast path (no tokens.css to parse). saveVariables
      // also regenerates tokens.css to keep the two derived artifacts in
      // lock-step.
      await saveVariables(outDir, {
        version: 1,
        collections: [
          {
            id: newCollectionId(),
            name: 'Default',
            groups: [{ id: newGroupId(), name: 'Default', variables: [] }],
          },
        ],
      });

      // Attach the new DS to the project.
      const fullDsId = `user:${id}`;
      try {
        updateProject(db, req.params.projectId, { designSystemId: fullDsId });
      } catch (err: any) {
        // Roll back the on-disk DS so we don't leave an orphan.
        try { await fsp.rm(outDir, { recursive: true, force: true }); } catch { /* ignore */ }
        return sendApiError(res, 500, 'ATTACH_FAILED', `failed to attach DS to project: ${String(err?.message ?? err)}`);
      }

      // Patch the project's HTML files NOW so the `<style data-od-ds-tokens>`
      // element lands in the source immediately — otherwise Preview mode
      // wouldn't see any DS tokens until the user edited a variable.
      try {
        await patchProjectsUsingDesignSystem(fullDsId, outDir);
      } catch {
        // Best-effort: the SSE fan-out and the next variable edit will
        // re-run the patcher.
      }

      const systems = await listAllDesignSystems();
      const designSystem = systems.find((s) => s.id === fullDsId);
      res.status(201).json({ designSystem, designSystemId: fullDsId });
    } catch (err: any) {
      sendApiError(res, 500, 'INTERNAL_ERROR', String(err?.message ?? err));
    }
  });

  app.post('/api/design-systems/import/github', async (req, res) => {
    if (!requireLocalOrigin(req, res)) return;
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const githubUrl =
        typeof body.githubUrl === 'string'
          ? body.githubUrl
          : typeof body.url === 'string'
            ? body.url
            : '';
      const before = await listAllDesignSystems();
      const result = await importGitHubDesignSystemProject(
        githubUrl,
        path.join(PROJECT_ROOT, '.tmp'),
        USER_DESIGN_SYSTEMS_DIR,
        {
          name: typeof body.name === 'string' ? body.name : undefined,
          branch: typeof body.branch === 'string' ? body.branch : undefined,
          reservedIds: before.map((system) => system.id),
        },
      );
      const systems = await listAllDesignSystems();
      const designSystem = systems.find((system) => system.id === result.id);
      if (!designSystem) {
        return sendApiError(
          res,
          500,
          'INTERNAL_ERROR',
          `imported GitHub design system was not found in catalog: ${result.dir}`,
        );
      }
      res.status(201).json({ designSystem });
    } catch (err: any) {
      if (err instanceof LocalDesignSystemImportError) {
        return sendApiError(res, err.code === 'BAD_REQUEST' ? 400 : 500, err.code, err.message);
      }
      sendApiError(res, 500, 'INTERNAL_ERROR', String(err));
    }
  });

  app.delete('/api/design-systems/:id', async (req, res, next) => {
    if (!requireLocalOrigin(req, res)) return;
    if (req.params.id.startsWith('user:')) {
      return next();
    }
    try {
      const result = await uninstallById(
        req.params.id,
        USER_DESIGN_SYSTEMS_DIR,
        DESIGN_SYSTEMS_DIR,
        'design-system',
      );
      if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: String(err) });
    }
  });

}

function assembleExample(templateHtml: string, slidesHtml: string, title: string) {
  return templateHtml
    .replace('<!-- SLIDES_HERE -->', slidesHtml)
    .replace(/<title>.*?<\/title>/, `<title>${title} | Open Design Example</title>`);
}

function rewriteSkillAssetUrls(html: string, skillId: string) {
  if (typeof html !== 'string' || html.length === 0) return html;
  return html.replace(
    /(\s(?:src|href)\s*=\s*)(['"])((?:\.\.\/([^/'"#?]+)\/)?(?:\.\/)?assets\/([^'"#?]+))(\2)/gi,
    (_match, attr, openQuote, _fullPath, siblingSkillId, relPath, closeQuote) => {
      const resolvedSkillId = siblingSkillId || skillId;
      const prefix = `/api/skills/${encodeURIComponent(resolvedSkillId)}/assets/`;
      return `${attr}${openQuote}${prefix}${relPath}${closeQuote}`;
    },
  );
}
