// @vitest-environment node

// Phase 10 — e2e smoke for the Design System Variables Modal.
//
// Boots daemon + web via createSmokeSuite/toolsDev, creates a project, seeds
// the default DS collections, then drives the modal through Playwright's
// programmatic chromium API:
//   1. Assert the modal renders after navigating to ?ds=open.
//   2. Assert all 7 seeded collections appear in the sidebar.
//   3. Select Container Size — assert Desktop/Tablet/Mobile mode headers.
//   4. Add an XL/1920 mode column — assert it appears.
//   5. Switch to Grid, search "col" — Columns visible, Margin hidden.
//   6. Esc clears search (modal stays); second Esc closes modal.

import { randomUUID } from 'node:crypto';

import { chromium, expect as pwExpect } from '@playwright/test';
import { describe, expect, test } from 'vitest';

import { requestJson } from '@/vitest/http';
import { createSmokeSuite } from '@/vitest/smoke-suite';

type ProjectResponse = {
  conversationId: string;
  project: { id: string; name: string };
};

type CreateEmptyDsResponse = {
  designSystemId: string;
};

describe('ds-variables-modal e2e', () => {
  test(
    'seed defaults visible, mode CRUD works, search filters, Esc behavior',
    async () => {
      const suite = await createSmokeSuite('ds-variables-modal');

      await suite.with.toolsDev(async ({ webUrl }) => {
        // ── 1. Create a project ──────────────────────────────────────────────
        const projectResp = await requestJson<ProjectResponse>(webUrl, '/api/projects', {
          body: {
            id: randomUUID(),
            name: 'DS Modal E2E',
            metadata: { kind: 'prototype' },
            designSystemId: null,
            pendingPrompt: null,
            skillId: null,
          },
        });
        const projectId = projectResp.project.id;

        // ── 2. Set onboarding completed so the app renders the project view ───
        await requestJson<unknown>(webUrl, '/api/app-config', {
          method: 'PUT',
          body: {
            onboardingCompleted: true,
            agentId: 'mock',
            agentModels: {},
            designSystemId: null,
            skillId: null,
            telemetry: { artifactManifest: false, content: false, metrics: false },
          },
        });

        // ── 3. Seed default DS collections via create-empty ──────────────────
        const dsResp = await requestJson<CreateEmptyDsResponse>(
          webUrl,
          `/api/projects/${projectId}/design-system/create-empty`,
          { body: {} },
        );
        expect(dsResp.designSystemId).toBeTruthy();

        // ── 4. Open the modal in a browser ───────────────────────────────────
        const browser = await chromium.launch({ headless: true });
        try {
          const context = await browser.newContext();
          const page = await context.newPage();

          // Inject localStorage config so the app skips onboarding and
          // renders the project view immediately.
          const STORAGE_KEY = 'open-design:config';
          await page.addInitScript(
            ({ key, config }: { key: string; config: unknown }) => {
              window.localStorage.setItem(key, JSON.stringify(config));
            },
            {
              key: STORAGE_KEY,
              config: {
                mode: 'daemon',
                apiKey: '',
                baseUrl: 'https://api.anthropic.com',
                model: 'claude-sonnet-4-5',
                agentId: 'mock',
                skillId: null,
                designSystemId: null,
                onboardingCompleted: true,
                agentModels: {},
                privacyDecisionAt: 1,
                telemetry: { metrics: false, content: false, artifactManifest: false },
              },
            },
          );

          // Mock the cloud auth status endpoint so the CloudLoginGate renders
          // children (not signed-out wall) without needing a real Supabase session.
          await page.route('**/api/cloud/auth/status', async (route) => {
            await route.fulfill({
              contentType: 'application/json',
              body: JSON.stringify({ configured: false, signed_in: false }),
            });
          });

          // Navigate to the root first (the SPA shell), then use pushState to
          // deep-link to the project with ds=open. The Next.js dev server
          // serves the catch-all SPA from "/" only; deep links must go through
          // client-side routing.
          await page.goto(`${webUrl}/`);

          // Wait for the app shell to hydrate.
          await page.waitForLoadState('domcontentloaded');

          // Use pushState + PopStateEvent to trigger the client router.
          const targetPath = `/projects/${encodeURIComponent(projectId)}?ds=open`;
          await page.evaluate((path) => {
            window.history.pushState(null, '', path);
            window.dispatchEvent(new PopStateEvent('popstate'));
          }, targetPath);

          // ── 4. Modal must be visible ─────────────────────────────────────
          await pwExpect(page.getByTestId('ds-modal')).toBeVisible({ timeout: 15_000 });

          // ── 5. All 7 seeded collections in sidebar ───────────────────────
          for (const name of ['Container Size', 'Grid', 'Typography', 'Cores', 'Spacing', 'Style', 'Controle']) {
            await pwExpect(page.getByTestId(`ds-sidebar-collection-${name}`)).toBeVisible();
          }

          // ── 6. Container Size → 3 mode column headers ────────────────────
          await page.getByTestId('ds-sidebar-collection-Container Size').click();
          await pwExpect(page.getByTestId('ds-mode-header-Desktop')).toBeVisible();
          await pwExpect(page.getByTestId('ds-mode-header-Tablet')).toBeVisible();
          await pwExpect(page.getByTestId('ds-mode-header-Mobile')).toBeVisible();

          // ── 7. Add XL / 1920 mode column ────────────────────────────────
          await page.getByTestId('ds-add-mode').click();
          // The popover has two inputs labelled "Name" and "Width (px)".
          // They live inside <label> elements so we locate them that way.
          const nameInput = page.locator('.ds-add-mode__popover label').filter({ hasText: 'Name' }).locator('input');
          const widthInput = page.locator('.ds-add-mode__popover label').filter({ hasText: 'Width' }).locator('input');
          await nameInput.fill('XL');
          await widthInput.fill('1920');
          await page.locator('.ds-add-mode__actions button').click();
          await pwExpect(page.getByTestId('ds-mode-header-XL')).toBeVisible();

          // ── 8. Switch to Grid, search "col" ──────────────────────────────
          await page.getByTestId('ds-sidebar-collection-Grid').click();
          await page.getByTestId('ds-search-input').fill('col');

          await pwExpect(page.getByTestId('ds-row-Columns')).toBeVisible({ timeout: 5_000 });
          await pwExpect(page.getByTestId('ds-row-Margin')).not.toBeVisible();

          // ── 9. Esc clears search (modal stays) ───────────────────────────
          await page.keyboard.press('Escape');
          await pwExpect(page.getByTestId('ds-modal')).toBeVisible();

          // ── 10. Second Esc closes modal ──────────────────────────────────
          await page.keyboard.press('Escape');
          await pwExpect(page.getByTestId('ds-modal')).not.toBeVisible({ timeout: 5_000 });

          await context.close();
        } finally {
          await browser.close();
        }
      });
    },
    300_000,
  );
});
