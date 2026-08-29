import { expect, test, type Locator, type Page } from '@playwright/test';

const PROJECT_ID = 'maple-street-kitchen-demo-2025';
const PROJECT_ROUTE = `/project/${PROJECT_ID}`;
const MAY_15 = '2025-05-15';
const EDITED_DAILY_RECORD =
  'Installed the cabinet fronts and hardware, adjusted the doors and drawers, cleaned the work area, and completed the final walk-through.';

type ToolResult = { content: { type: 'text'; text: string }[] };

type ToolHandle = {
  name: string;
  execute: (input: Record<string, unknown>, options: object) => Promise<ToolResult>;
};

type AuditData = {
  blocker_count: number;
  warning_count: number;
  counts: {
    workdays: number;
    photos: number;
    punch_items: number;
    daily_logs: number;
  };
  findings: Array<{ code: string; entity_id?: string; workday?: string }>;
  candidates: Array<{
    punch_item_id: string;
    photo_id: string;
    workday: string;
  }>;
  daily_log_contexts: Array<{
    log_date: string;
    work_items: Array<{ id: string; text: string }>;
    photos: Array<{ id: string; caption?: string }>;
  }>;
};

type RepairState = {
  frontsPhotoIds: string[];
  cleanupPhotoIds: string[];
  may15Log: string | null;
};

async function installWebMcpStub(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const tools = new Map<string, ToolHandle>();
    Object.defineProperty(window, '__fieldproofTools', {
      configurable: true,
      value: tools,
    });
    Object.defineProperty(window, '__fieldproofRetainedTool', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    Object.defineProperty(document, 'modelContext', {
      configurable: true,
      value: {
        registerTool: async (
          tool: ToolHandle,
          options?: { signal?: AbortSignal },
        ) => {
          tools.set(tool.name, tool);
          options?.signal?.addEventListener(
            'abort',
            () => {
              if (tools.get(tool.name) === tool) tools.delete(tool.name);
            },
            { once: true },
          );
        },
      },
    });
  });
}

async function callTool(
  page: Page,
  name: string,
  input: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  return page.evaluate(
    async ({ toolName, toolInput }) => {
      const tools = (window as unknown as { __fieldproofTools?: Map<string, ToolHandle> })
        .__fieldproofTools;
      const tool = tools?.get(toolName);
      if (!tool) throw new Error(`Missing tool: ${toolName}`);
      const result = await tool.execute(toolInput, {});
      return JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>;
    },
    { toolName: name, toolInput: input },
  );
}

async function retainTool(page: Page, name: string): Promise<void> {
  await page.evaluate((toolName) => {
    const target = window as unknown as {
      __fieldproofTools?: Map<string, ToolHandle>;
      __fieldproofRetainedTool?: ToolHandle;
    };
    target.__fieldproofRetainedTool = target.__fieldproofTools?.get(toolName);
  }, name);
}

async function callRetainedTool(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(async () => {
    const tool = (window as unknown as { __fieldproofRetainedTool?: ToolHandle })
      .__fieldproofRetainedTool;
    if (!tool) throw new Error('No retained tool');
    const result = await tool.execute({}, {});
    return JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>;
  });
}

async function loadSample(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open sample' }).click();
  await expect(page).toHaveURL(new RegExp(`${PROJECT_ROUTE.replaceAll('/', '\\/')}(?:\\?|$)`));
  await expect(
    page.getByRole('heading', { level: 1, name: 'Maple Street Kitchen Demo' }),
  ).toBeVisible();
}

async function waitForTools(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __fieldproofTools?: Map<string, ToolHandle> })
            .__fieldproofTools?.size ?? 0,
      ),
    )
    .toBe(6);
}

async function expectStartingLedger(page: Page): Promise<void> {
  await expect(page.locator('[data-workday]')).toHaveCount(3);
  await expect(page.locator('[data-workday="2025-05-13"]')).toContainText(
    'Tuesday, May 13, 2025',
  );
  await expect(page.locator('[data-workday="2025-05-14"]')).toContainText(
    'Wednesday, May 14, 2025',
  );
  const may15 = page.locator(`[data-workday="${MAY_15}"]`);
  await expect(may15).toContainText('Thursday, May 15, 2025');
  await expect(may15.getByText('Photo proof missing', { exact: true })).toHaveCount(2);
  await expect(may15.getByText('Daily record missing', { exact: true })).toBeVisible();
  await expect(page.getByText('3 workdays', { exact: true })).toBeVisible();
  await expect(page.getByText('18 photos', { exact: true })).toBeVisible();
  await expect(page.getByText('10 completed items', { exact: true })).toBeVisible();
}

async function readRepairState(page: Page): Promise<RepairState> {
  return page.evaluate(
    async ({ projectId, may15 }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('fieldproof');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const transaction = database.transaction(['punchItems', 'dailyLogs'], 'readonly');
      const requestValue = <T>(request: IDBRequest<T>) =>
        new Promise<T>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      const frontsRequest = transaction.objectStore('punchItems').get('msk25w08');
      const cleanupRequest = transaction.objectStore('punchItems').get('msk25w10');
      const logsRequest = transaction.objectStore('dailyLogs').getAll();
      const [fronts, cleanup, logs] = await Promise.all([
        requestValue<Record<string, unknown> | undefined>(frontsRequest),
        requestValue<Record<string, unknown> | undefined>(cleanupRequest),
        requestValue<Array<Record<string, unknown>>>(logsRequest),
      ]);
      database.close();
      const log = logs.find(
        (row) => row.projectId === projectId && row.logDate === may15,
      );
      return {
        frontsPhotoIds: Array.isArray(fronts?.photoIds) ? [...fronts.photoIds] : [],
        cleanupPhotoIds: Array.isArray(cleanup?.photoIds) ? [...cleanup.photoIds] : [],
        may15Log: typeof log?.body === 'string' ? log.body : null,
      };
    },
    { projectId: PROJECT_ID, may15: MAY_15 },
  );
}

async function readProtectedPhoto(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('fieldproof');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction('photos', 'readonly');
    const row = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const request = transaction.objectStore('photos').get('msk25p03');
      request.onsuccess = () => resolve(request.result as Record<string, unknown>);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return {
      id: row.id,
      capturedAt: row.capturedAt,
      sha256: row.sha256,
      lat: row.lat,
      lon: row.lon,
      accuracy: row.accuracy,
      voidedAt: row.voidedAt ?? null,
      voidReason: row.voidReason ?? null,
    };
  });
}

async function expectLoadedImage(image: Locator): Promise<void> {
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBe(960);
}

async function expectReadyPacket(page: Page, dailyRecord: string): Promise<void> {
  await expect(page).toHaveURL(new RegExp(`/packet/${PROJECT_ID}$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Handoff Packet' })).toBeVisible();
  await expect(page.getByText('Ready for handoff', { exact: true })).toBeVisible();
  const orderedDates = await page.locator('[data-workday]').evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-workday')),
  );
  expect(orderedDates).toEqual(['2025-05-13', '2025-05-14', '2025-05-15']);
  await expect(
    page.getByText('Cabinet fronts and hardware installed', { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText('Work area cleaned for final walk-through', { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText(dailyRecord, { exact: true })).toBeVisible();
  await expect(page.locator('.report-appendix tbody tr')).toHaveCount(18);
}

async function linkManualProof(
  page: Page,
  itemId: string,
  itemName: string,
  photoCaption: string,
): Promise<void> {
  const workday = page.getByRole('dialog', { name: 'Workday details' });
  await workday
    .locator(`[data-work-item-id="${itemId}"]`)
    .getByRole('button', { name: 'Manage proof' })
    .click();
  const proofSheet = page.getByRole('dialog', { name: `Photos for ${itemName}` });
  const photoRow = proofSheet.locator('.proof-photo-row').filter({ hasText: photoCaption });
  await photoRow.getByRole('button', { name: 'Link' }).click();
  await expect(photoRow.getByRole('button', { name: 'Remove' })).toBeVisible();
  await proofSheet
    .getByRole('button', { name: `Close Photos for ${itemName}` })
    .click();
}

test('the browser assistant prepares the three-day handoff and a person saves it', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await installWebMcpStub(page);
  await loadSample(page);
  await expectStartingLedger(page);
  await waitForTools(page);
  const startedAt = Date.now();
  const before = await readRepairState(page);
  expect(before).toEqual({ frontsPhotoIds: [], cleanupPhotoIds: [], may15Log: null });

  expect(await callTool(page, 'verify_project_seals')).toMatchObject({
    ok: true,
    code: 'verified',
    data: { summary: { pass: 18, fail: 0, unreadable: 0, excluded: 0 } },
  });
  await expect(page.getByRole('complementary', { name: 'Handoff Review' })).toBeVisible();

  const firstAudit = await callTool(page, 'audit_project_closeout');
  expect(firstAudit).toMatchObject({
    ok: true,
    code: 'audited',
    data: {
      blocker_count: 2,
      warning_count: 1,
      counts: { workdays: 3, photos: 18, punch_items: 10, daily_logs: 2 },
    },
  });
  const audit = firstAudit.data as AuditData;
  expect(audit.findings.filter((finding) => finding.code === 'missing-punch-proof')).toHaveLength(2);
  expect(audit.findings.filter((finding) => finding.code === 'missing-daily-log')).toHaveLength(1);
  const frontsCandidate = audit.candidates.find((item) => item.punch_item_id === 'msk25w08');
  const cleanupCandidate = audit.candidates.find((item) => item.punch_item_id === 'msk25w10');
  expect(frontsCandidate).toMatchObject({ photo_id: 'msk25p13', workday: MAY_15 });
  expect(cleanupCandidate).toMatchObject({ photo_id: 'msk25p17', workday: MAY_15 });
  const dailyContext = audit.daily_log_contexts.find((item) => item.log_date === MAY_15);
  expect(dailyContext?.work_items.map((item) => item.id)).toEqual([
    'msk25w08',
    'msk25w09',
    'msk25w10',
  ]);

  expect(
    await callTool(page, 'stage_photo_link', {
      punch_item_id: 'msk25w08',
      photo_id: 'msk25p13',
      reason: 'The saved date, caption, and work timing make this a possible match.',
    }),
  ).toMatchObject({ ok: true, code: 'proposal_staged' });
  expect(
    await callTool(page, 'stage_photo_link', {
      punch_item_id: 'msk25w10',
      photo_id: 'msk25p17',
      reason: 'The saved date, caption, and work timing make this a possible match.',
    }),
  ).toMatchObject({ ok: true, code: 'proposal_staged' });
  expect(
    await callTool(page, 'stage_daily_log', {
      log_date: MAY_15,
      body: 'Installed cabinet fronts and hardware, adjusted doors and drawers, and cleaned the work area.',
      source_photo_ids: ['msk25p13', 'msk25p17'],
      source_work_item_ids: ['msk25w08', 'msk25w09', 'msk25w10'],
      reason: 'Work and photos were saved for May 15, but the daily record is blank.',
    }),
  ).toMatchObject({ ok: true, code: 'proposal_staged' });

  expect(await readRepairState(page)).toEqual(before);
  const cards = page.locator('[data-proposal-card]');
  await expect(cards).toHaveCount(3);
  const checkboxes = cards.getByRole('checkbox', { name: /Select update for/ });
  await expect(checkboxes).toHaveCount(3);
  for (let index = 0; index < 3; index += 1) {
    await expect(checkboxes.nth(index)).not.toBeChecked();
  }
  await expect(page.getByRole('button', { name: 'Save selected updates (0)' })).toBeDisabled();
  await expectLoadedImage(
    cards.getByRole('img', { name: 'Cabinet fronts and hardware installed' }),
  );
  await expectLoadedImage(
    cards.getByRole('img', { name: 'Work area cleaned for final walk-through' }),
  );

  await cards.getByLabel('Draft daily record').fill(EDITED_DAILY_RECORD);
  for (let index = 0; index < 3; index += 1) await checkboxes.nth(index).check();
  await expect(page.getByRole('button', { name: 'Save selected updates (3)' })).toBeEnabled();
  const timeOrigin = await page.evaluate(() => performance.timeOrigin);
  await page.getByRole('button', { name: 'Save selected updates (3)' }).click();
  await expect(cards.getByText('Saved', { exact: true })).toHaveCount(3);
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);

  const may15 = page.locator(`[data-workday="${MAY_15}"]`);
  await expect(may15.getByText('1 proof photo', { exact: true })).toHaveCount(3);
  await expect(may15.getByText(EDITED_DAILY_RECORD, { exact: true })).toBeVisible();
  await expect(may15.getByText('Check again', { exact: true })).toBeVisible();
  await expect(page.locator('[data-workday="2025-05-13"]')).toContainText('Complete');
  await expect(page.locator('[data-workday="2025-05-14"]')).toContainText('Complete');
  expect(await readRepairState(page)).toEqual({
    frontsPhotoIds: ['msk25p13'],
    cleanupPhotoIds: ['msk25p17'],
    may15Log: EDITED_DAILY_RECORD,
  });

  expect(await callTool(page, 'verify_project_seals')).toMatchObject({
    ok: true,
    code: 'verified',
  });
  expect(await callTool(page, 'audit_project_closeout')).toMatchObject({
    ok: true,
    code: 'audited',
    data: { phase: 'ready', blocker_count: 0, warning_count: 0 },
  });
  await expect(page.getByText('Ready for handoff', { exact: true }).first()).toBeVisible();
  expect(await callTool(page, 'open_evidence_packet')).toMatchObject({
    ok: true,
    code: 'packet_opened',
  });
  await expectReadyPacket(page, EDITED_DAILY_RECORD);
  expect(Date.now() - startedAt).toBeLessThan(180_000);
});

test('manual controls reach the same saved result and packet without WebMCP', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await loadSample(page);
  await expectStartingLedger(page);
  expect(await page.evaluate(() => document.modelContext === undefined)).toBe(true);

  await page.getByRole('button', { name: 'Run handoff review' }).click();
  const review = page.getByRole('dialog', { name: 'Handoff Review' });
  await expect(review.getByRole('heading', { name: 'Needs attention (2)' })).toBeVisible();
  await expect(review.getByRole('heading', { name: 'Worth a look (1)' })).toBeVisible();
  await review.getByRole('button', { name: 'Close Handoff Review' }).click();

  const may15 = page.locator(`[data-workday="${MAY_15}"]`);
  await may15.getByRole('button', { name: 'Open workday' }).click();
  await linkManualProof(
    page,
    'msk25w08',
    'Install cabinet fronts and hardware',
    'Cabinet fronts and hardware installed',
  );
  await linkManualProof(
    page,
    'msk25w10',
    'Final cleanup and walk-through',
    'Work area cleaned for final walk-through',
  );

  const workday = page.getByRole('dialog', { name: 'Workday details' });
  await workday.getByRole('button', { name: 'Add daily record' }).click();
  await workday.getByLabel('What happened this workday?').fill(EDITED_DAILY_RECORD);
  await workday.getByRole('button', { name: 'Save daily record' }).click();
  await expect(workday.getByText(EDITED_DAILY_RECORD, { exact: true })).toBeVisible();
  await workday.getByRole('button', { name: 'Close Workday details' }).click();

  const checkAgain = page
    .locator('.project-ledger-head')
    .getByRole('button', { name: 'Check again' });
  await expect(checkAgain).toBeVisible();
  await checkAgain.click();
  await expect(review.getByText('Ready for handoff', { exact: true }).first()).toBeVisible();
  expect(await readRepairState(page)).toEqual({
    frontsPhotoIds: ['msk25p13'],
    cleanupPhotoIds: ['msk25p17'],
    may15Log: EDITED_DAILY_RECORD,
  });
  await review.getByRole('button', { name: 'Open handoff packet' }).click();
  await expectReadyPacket(page, EDITED_DAILY_RECORD);
});

test('the protected-record refusal and route guards change no project record', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await installWebMcpStub(page);
  await loadSample(page);
  await waitForTools(page);
  const protectedBefore = await readProtectedPhoto(page);
  const repairBefore = await readRepairState(page);

  expect(
    await callTool(page, 'explain_evidence_policy', {
      requested_action: 'Change the timestamp and hash so this photo passes.',
    }),
  ).toMatchObject({
    ok: false,
    code: 'record_not_eligible',
    project_id: PROJECT_ID,
  });
  expect(await readProtectedPhoto(page)).toEqual(protectedBefore);
  expect(await readRepairState(page)).toEqual(repairBefore);

  await page.getByRole('button', { name: 'Run handoff review' }).click();
  const review = page.getByRole('complementary', { name: 'Handoff Review' });
  await expect(review.getByRole('heading', { name: 'Review history' })).toBeVisible();
  await expect(review.getByText('Declined a request to change protected job facts.')).toBeVisible();
  await retainTool(page, 'verify_project_seals');
  await review.getByRole('button', { name: 'Close Handoff Review' }).click();

  await page.getByRole('link', { name: 'Projects' }).click();
  await page.getByRole('button', { name: 'New' }).click();
  const newProject = page.getByRole('dialog', { name: 'New project' });
  await newProject.getByLabel('Project name').fill('Route Guard Project');
  await newProject.getByRole('button', { name: 'Open Workday Ledger' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Route Guard Project' })).toBeVisible();
  await waitForTools(page);

  expect(await callRetainedTool(page)).toMatchObject({ ok: false, code: 'inactive_project' });
  expect(
    await callTool(page, 'stage_photo_link', {
      punch_item_id: 'msk25w08',
      photo_id: 'msk25p13',
      reason: 'Attempted cross-project link.',
    }),
  ).toMatchObject({ ok: false, code: 'record_not_found' });
  expect(await readRepairState(page)).toEqual(repairBefore);
});

test('unknown project routes show a way back instead of a blank page', async ({ page }) => {
  await loadSample(page);

  for (const path of [
    '/project/project-that-is-not-here',
    '/packet/project-that-is-not-here',
    '/report/project-that-is-not-here/2025-05-15',
  ]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: 'Project not found' })).toBeVisible();
    const back = page.getByRole('link', { name: 'Back to projects' });
    await expect(back).toHaveAttribute('href', '/');
    if (path.startsWith('/packet/') || path.startsWith('/report/')) {
      await page.reload();
      await expect(page.getByRole('heading', { level: 1, name: 'Project not found' })).toBeVisible();
    }
  }

  await page.getByRole('link', { name: 'Back to projects' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible();
});

test('the ledger respects its responsive, zoom, focus, and motion boundaries', async ({ page }) => {
  test.setTimeout(60_000);
  await loadSample(page);

  await page.setViewportSize({ width: 1100, height: 820 });
  await page.goto(`${PROJECT_ROUTE}?review=1`);
  const rail = page.getByRole('complementary', { name: 'Handoff Review' });
  await expect(rail).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Handoff Review' })).toHaveCount(0);
  expect(await rail.evaluate((node) => getComputedStyle(node).position)).toBe('sticky');

  await page.setViewportSize({ width: 1099, height: 820 });
  const reviewSheet = page.getByRole('dialog', { name: 'Handoff Review' });
  await expect(reviewSheet).toBeVisible();
  await expect(rail).toHaveCount(0);
  expect(
    await reviewSheet.evaluate((node) => Math.round(node.getBoundingClientRect().height)),
  ).toBe(820);
  await reviewSheet.getByRole('button', { name: 'Close Handoff Review' }).click();

  await page.setViewportSize({ width: 641, height: 820 });
  const columnsAt641 = await page
    .locator('.workday-sections')
    .first()
    .evaluate((node) => getComputedStyle(node).gridTemplateColumns.trim().split(/\s+/).length);
  expect(columnsAt641).toBe(2);
  await page.setViewportSize({ width: 640, height: 820 });
  const columnsAt640 = await page
    .locator('.workday-sections')
    .first()
    .evaluate((node) => getComputedStyle(node).gridTemplateColumns.trim().split(/\s+/).length);
  expect(columnsAt640).toBe(1);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const opener = page
    .locator(`[data-workday="${MAY_15}"]`)
    .getByRole('button', { name: 'Open workday' });
  await opener.click();
  const workdaySheet = page.getByRole('dialog', { name: 'Workday details' });
  await expect(workdaySheet).toBeVisible();
  const animationMilliseconds = await workdaySheet.evaluate((node) => {
    const value = getComputedStyle(node).animationDuration.trim();
    return value.endsWith('ms') ? Number.parseFloat(value) : Number.parseFloat(value) * 1000;
  });
  expect(animationMilliseconds).toBeLessThanOrEqual(0.02);
  await page.keyboard.press('Tab');
  expect(
    await workdaySheet.evaluate((node) => node.contains(document.activeElement)),
  ).toBe(true);
  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);

  // A 550 CSS-pixel viewport represents an 1100-pixel screen at 200 percent browser zoom.
  await page.setViewportSize({ width: 550, height: 820 });
  await page.goto(`${PROJECT_ROUTE}?review=1`);
  const zoomReview = page.getByRole('dialog', { name: 'Handoff Review' });
  await expect(zoomReview).toBeVisible();
  await expect(zoomReview.getByRole('button', { name: 'Run handoff review' })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
});

test('all sample images survive an offline reload and the packet keeps its print rules', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 900, height: 900 });
  await loadSample(page);
  await page.getByRole('button', { name: 'Photos' }).click();
  await expect(page.locator('.photo-card img')).toHaveCount(18);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
  await expect(page.locator('.photo-card img')).toHaveCount(18);

  await page.context().setOffline(true);
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Photos' })).toBeVisible();
    await expect(page.locator('.photo-card img')).toHaveCount(18);
    const loadedWidths = await page
      .locator('.photo-card img')
      .evaluateAll((images) => images.map((image) => (image as HTMLImageElement).naturalWidth));
    expect(loadedWidths).toEqual(Array.from({ length: 18 }, () => 960));
  } finally {
    await page.context().setOffline(false);
  }

  await page.goto(`/packet/${PROJECT_ID}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Handoff Packet' })).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('button', { name: 'Print / Save PDF' })).toBeHidden();
  expect(
    await page
      .locator('.hash-table tbody tr')
      .first()
      .evaluate((node) => getComputedStyle(node).breakInside),
  ).toMatch(/avoid/);
  expect(
    await page
      .locator('[data-workday] > h2')
      .first()
      .evaluate((node) => getComputedStyle(node).breakAfter),
  ).toMatch(/avoid/);
  expect(
    await page.locator('.hash-table thead').evaluate((node) => getComputedStyle(node).display),
  ).toBe('table-header-group');
});
