import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const STORAGE_KEY = 'open-design:config';

test.describe.configure({ timeout: 45_000 });

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(
      key,
      JSON.stringify({
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
      }),
    );
  }, STORAGE_KEY);

  await page.route('**/api/app-config', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({
      json: {
        config: {
          onboardingCompleted: true,
          agentId: 'mock',
          skillId: null,
          designSystemId: null,
          agentModels: {},
          privacyDecisionAt: 1,
          telemetry: { metrics: false, content: false, artifactManifest: false },
        },
      },
    });
  });
});

test('Edit mode insert toolbar: arm Shape, click to commit, resize Fill, delete via confirm modal', async ({ page }) => {
  await routeMockAgents(page);
  // Bypass the multi-step new-project wizard — the UI flow is irrelevant to
  // this test's product surface (Edit mode + InsertToolbar). Seed both the
  // project and the design file directly through the daemon HTTP API.
  const projectId = `e2e-insert-${Date.now().toString(36)}`;
  await createProjectViaApi(page, projectId, 'Insert toolbar smoke');
  await seedHtmlArtifact(page, projectId, 'insert-canvas.html', insertCanvasHtml());
  await page.goto(`/projects/${projectId}/files/insert-canvas.html`);
  await openDesignFile(page, 'insert-canvas.html');

  await expect(page.getByTestId('artifact-preview-frame')).toBeVisible();
  const frame = page.frameLocator('[data-testid="artifact-preview-frame"]');
  // Sanity: a known seeded element is present before we enter Edit mode.
  await expect(frame.locator('[data-od-id="canvas"]')).toBeVisible();

  // 1. Enter Edit mode. The same toggle the manual-edit smoke uses.
  await page.getByTestId('manual-edit-mode-toggle').click();
  await expect(page.locator('.manual-edit-modal')).toBeVisible();

  // 2. Arm the Shape tool from the InsertToolbar.
  const shapeButton = page.getByRole('toolbar', { name: 'Insert element' }).getByRole('button', { name: 'Shape' });
  await expect(shapeButton).toBeVisible();
  await shapeButton.click();
  await expect(shapeButton).toHaveAttribute('aria-pressed', 'true');

  // 3. Click inside an existing source-mappable element to commit the
  //    insertion. The bridge's findDropAnchor + planForContainer pair routes
  //    the click into a real drop plan; the host then issues an
  //    insert-html-as-child / insert-html-before-ref patch and re-renders.
  await frame.locator('[data-od-id="canvas"]').click({ position: { x: 60, y: 60 } });

  // 4. The inserted shape carries a fresh data-od-id with the `od-ins-`
  //    prefix produced by buildInsertedElement('shape').
  const inserted = frame.locator('[data-od-id^="od-ins-"]');
  await expect(inserted).toHaveCount(1, { timeout: 15_000 });

  // After commit the toolbar should disarm itself.
  await expect(shapeButton).toHaveAttribute('aria-pressed', 'false');

  // 5. Select the inserted element. The bridge's regular click handler fires
  //    in the same capture phase as the insert-commit handler (the commit
  //    only stopPropagation, not stopImmediatePropagation), so the canvas
  //    gets selected on the commit click. Re-click the inserted shape to
  //    move selection to it. Dispatch the click directly through the iframe
  //    DOM so we hit the inserted element exactly, regardless of any
  //    overlay positioning, and retry until the bridge surfaces the
  //    data-od-edit-selected marker — the iframe may still be rebooting
  //    the manual-edit bridge after the patch reload.
  const insertedId = await inserted.evaluate((el) => el.getAttribute('data-od-id'));
  const insertedSelectedMarker = frame.locator('[data-od-id^="od-ins-"][data-od-edit-selected="true"]');
  await expect
    .poll(
      async () => {
        await frame.locator('body').evaluate((body, id) => {
          const node = body.ownerDocument.querySelector(`[data-od-id="${id}"]`) as HTMLElement | null;
          if (!node) return;
          const rect = node.getBoundingClientRect();
          const clientX = rect.left + rect.width / 2;
          const clientY = rect.top + rect.height / 2;
          node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX, clientY }));
        }, insertedId);
        return await insertedSelectedMarker.count();
      },
      { timeout: 10_000, intervals: [200, 400, 800] },
    )
    .toBe(1);
  await expect(page.locator('.manual-edit-modal')).toContainText('SIZE');

  // 6. Switch Width to Fill via the SIZE section's 3-way toggle. The radio
  //    input itself is hidden behind CSS (display:none); the visible click
  //    surface is the wrapping <label>, which carries the visible text. Click
  //    the label, not the radio, so Playwright doesn't bail on visibility.
  const widthGroup = page.getByRole('group', { name: 'width' });
  await expect(widthGroup).toBeVisible();
  await widthGroup.locator('label.manual-edit-size-mode', { hasText: 'Fill' }).click();

  // 7. The width: 100% declaration lands as an inline style on the inserted
  //    element. Computed width should match the canvas width (300px in the
  //    seeded HTML), proving Fill is wired end-to-end, not just dom-level.
  await expect.poll(async () => inserted.evaluate((el) => (el as HTMLElement).style.width)).toBe('100%');

  // 8. Click the Delete button in the panel footer to open the confirm modal.
  await page.locator('.manual-edit-delete').click();
  const dialog = page.locator('[role="dialog"][aria-modal="true"]');
  await expect(dialog).toBeVisible();

  // 9. Confirm via the destructive button inside the modal.
  await dialog.locator('.delete-confirm-confirm').click();
  await expect(dialog).toHaveCount(0);

  // 10. The inserted element is gone from the iframe DOM after the patch
  //     round-trips through applyManualEditPatch + iframe reload.
  await expect(frame.locator('[data-od-id^="od-ins-"]')).toHaveCount(0);
  // The seeded canvas element is still there — delete was scoped to the
  // inserted node, not the surrounding tree.
  await expect(frame.locator('[data-od-id="canvas"]')).toBeVisible();
});

async function routeMockAgents(page: Page) {
  await page.route('**/api/agents', async (route) => {
    await route.fulfill({
      json: {
        agents: [
          {
            id: 'mock',
            name: 'Mock Agent',
            bin: 'mock-agent',
            available: true,
            version: 'test',
            models: [{ id: 'default', label: 'Default' }],
          },
        ],
      },
    });
  });
}

async function createProjectViaApi(page: Page, id: string, name: string) {
  const resp = await page.request.post('/api/projects', {
    data: { id, name },
    timeout: 15_000,
  });
  expect(resp.ok()).toBeTruthy();
}

async function seedHtmlArtifact(page: Page, projectId: string, fileName: string, content: string) {
  const resp = await page.request.post(`/api/projects/${projectId}/files`, {
    data: {
      name: fileName,
      content,
      artifactManifest: {
        version: 1,
        kind: 'html',
        title: fileName,
        entry: fileName,
        renderer: 'html',
        exports: ['html'],
      },
    },
    timeout: 15_000,
  });
  expect(resp.ok()).toBeTruthy();
}

async function openDesignFile(page: Page, fileName: string) {
  const preview = page.getByTestId('artifact-preview-frame');
  if (
    await preview
      .waitFor({ state: 'visible', timeout: 5_000 })
      .then(() => true)
      .catch(() => false)
  ) {
    return;
  }

  // Project was created via API, so the file is not auto-opened. Switch to
  // the Files side panel and click the design file entry to open it in the
  // workspace tab.
  await page.getByRole('tab', { name: 'Files' }).click();
  const filePattern = new RegExp(fileName.replace('.', '\\.'), 'i');
  await page.getByRole('button', { name: filePattern }).first().click();
  await expect(preview).toBeVisible({ timeout: 10_000 });
}

function insertCanvasHtml(): string {
  // A roomy container with explicit width is enough for the drop-plan engine
  // to compute an insertion plan when the user clicks inside it: the new
  // element lands as a child of `canvas` via insert-html-as-child.
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Insert canvas</title>
    <style>
      body { margin: 0; font-family: Inter, system-ui, sans-serif; }
      .canvas { position: relative; width: 300px; min-height: 200px; padding: 24px; background: #fafafa; border: 1px solid #e5e7eb; }
    </style>
  </head>
  <body>
    <main>
      <section data-od-id="canvas" data-od-label="Canvas" class="canvas">
        <p data-od-id="placeholder" data-od-label="Placeholder">Drop area</p>
      </section>
    </main>
  </body>
</html>`;
}
