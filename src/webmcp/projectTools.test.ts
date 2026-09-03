import { describe, expect, it, vi } from 'vitest';
import type {
  CloseoutAudit,
  DailyLogProposal,
  PhotoLinkProposal,
  SealVerification,
} from '../domain/closeout.ts';
import { CloseoutServiceError } from '../data/closeoutService.ts';
import {
  createCloseoutSessionStore,
  type CloseoutSessionStore,
  type StorageLike,
} from '../data/closeoutSession.ts';
import {
  createReadOnlyProjectTools,
  registerProjectTools,
  type ModelContextRegistry,
  type ProjectToolService,
  type ToolDefinition,
} from './projectTools.ts';

const tools: ToolDefinition[] = [
  {
    name: 'first_tool',
    description: 'First test tool.',
    execute: () => ({ ok: true }),
  },
  {
    name: 'second_tool',
    description: 'Second test tool.',
    execute: () => ({ ok: true }),
  },
];

function createRegistry() {
  const active = new Set<string>();
  const signals: AbortSignal[] = [];
  const registerTool = vi.fn<ModelContextRegistry['registerTool']>(async (tool, options) => {
    active.add(tool.name);
    if (options?.signal) {
      signals.push(options.signal);
      options.signal.addEventListener('abort', () => active.delete(tool.name), { once: true });
    }
  });

  return {
    active,
    signals,
    registry: { registerTool } satisfies ModelContextRegistry,
    registerTool,
  };
}

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const verification: SealVerification = {
  projectId: 'project-1',
  checkedAt: '2026-08-26T16:00:00.000Z',
  photoFingerprint: 'photo-fingerprint',
  results: [
    { photoId: 'photo-pass', status: 'pass' },
    { photoId: 'photo-fail', status: 'fail' },
  ],
  summary: { pass: 1, fail: 1, unreadable: 0, excluded: 0 },
};

function audit(findingCount = 1): CloseoutAudit {
  return {
    projectId: 'project-1',
    checkedAt: '2026-08-26T16:01:00.000Z',
    sourceFingerprint: 'source-fingerprint',
    photoFingerprint: 'photo-fingerprint',
    phase: 'needs-attention',
    blockerCount: findingCount,
    warningCount: 0,
    findings: Array.from({ length: findingCount }, (_, index) => ({
      id: `missing-punch-proof:punch-${index}`,
      code: 'missing-punch-proof' as const,
      severity: 'blocker' as const,
      entityType: 'punch' as const,
      entityId: `punch-${index}`,
      workdayDate: '2026-08-26',
      message: `Private client note ${index} must stay on the page.`,
      suggestedAction: 'Link proof.',
    })),
    candidates: {},
    dailyLogContexts: [],
    counts: { workdays: 1, photos: 2, punchItems: findingCount, dailyLogs: 0 },
    workdayFingerprints: { '2026-08-26': 'workday-fingerprint' },
  };
}

function mapleAudit(): CloseoutAudit {
  return {
    ...audit(),
    blockerCount: 2,
    warningCount: 1,
    findings: [
      {
        id: 'missing-punch-proof:msk25w08',
        code: 'missing-punch-proof',
        severity: 'blocker',
        entityType: 'punch',
        entityId: 'msk25w08',
        workdayDate: '2025-05-15',
        message: 'Private work text.',
        suggestedAction: 'Choose proof.',
      },
      {
        id: 'missing-punch-proof:msk25w10',
        code: 'missing-punch-proof',
        severity: 'blocker',
        entityType: 'punch',
        entityId: 'msk25w10',
        workdayDate: '2025-05-15',
        message: 'Private work text.',
        suggestedAction: 'Choose proof.',
      },
      {
        id: 'missing-daily-log:2025-05-15',
        code: 'missing-daily-log',
        severity: 'warning',
        entityType: 'daily-log',
        entityId: '2025-05-15',
        workdayDate: '2025-05-15',
        message: 'Private daily record text.',
        suggestedAction: 'Add a daily record.',
      },
    ],
    candidates: {
      msk25w08: [
        {
          photoId: 'msk25p13',
          capturedAt: '2025-05-15T09:50:00',
          caption: 'Cabinet fronts and hardware installed',
          sealStatus: 'pass',
        },
        {
          photoId: 'msk25p16',
          capturedAt: '2025-05-15T13:15:00',
          caption: 'Finished cabinet run and hardware detail',
          sealStatus: 'pass',
        },
      ],
      msk25w10: [
        {
          photoId: 'msk25p17',
          capturedAt: '2025-05-15T15:50:00',
          caption: 'Work area cleaned for final walk-through',
          sealStatus: 'pass',
        },
        {
          photoId: 'msk25p18',
          capturedAt: '2025-05-15T16:20:00',
          caption: 'Completed kitchen at final walk-through',
          sealStatus: 'pass',
        },
      ],
    },
    dailyLogContexts: [
      {
        logDate: '2025-05-15',
        workItems: [
          { id: 'msk25w08', text: 'Install cabinet fronts and hardware' },
          { id: 'msk25w09', text: 'Adjust doors and drawers' },
          { id: 'msk25w10', text: 'Final cleanup and walk-through' },
        ],
        photos: [
          { id: 'msk25p13', caption: 'Cabinet fronts and hardware installed' },
          { id: 'msk25p14', caption: 'Doors aligned after adjustment' },
          { id: 'msk25p17', caption: 'Work area cleaned for final walk-through' },
        ],
      },
    ],
    counts: { workdays: 3, photos: 18, punchItems: 10, dailyLogs: 2 },
    workdayFingerprints: {
      '2025-05-13': 'day-1',
      '2025-05-14': 'day-2',
      '2025-05-15': 'day-3',
    },
  };
}

const photoLinkProposal: PhotoLinkProposal = {
  kind: 'photo-link',
  id: 'proposal-photo-1',
  projectId: 'project-1',
  createdAt: '2026-08-26T16:01:00.000Z',
  status: 'pending',
  selected: false,
  dismissed: false,
  reason: 'Private staging reason.',
  punchItemId: 'punch-1',
  punchItemLabel: 'Install cabinet face',
  workdayDate: '2026-08-26',
  photoId: 'photo-pass',
  expectedPunchUpdatedAt: '2026-08-26T15:00:00.000Z',
  expectedPhotoIdentity: 'photo-identity-fingerprint',
  sourceFingerprint: 'photo-source-fingerprint',
};

const dailyLogProposal: DailyLogProposal = {
  kind: 'daily-log',
  id: 'proposal-log-1',
  projectId: 'project-1',
  createdAt: '2026-08-26T16:01:00.000Z',
  status: 'pending',
  selected: false,
  dismissed: false,
  reason: 'Private missing-log reason.',
  logDate: '2026-08-26',
  body: 'Private daily log draft.',
  sourcePhotoIds: ['photo-pass'],
  sourceWorkItemIds: ['punch-1'],
  sourceFingerprint: 'daily-source-fingerprint',
  expectedLogAbsent: true,
};

function createToolService(
  overrides: Partial<ProjectToolService> = {},
): ProjectToolService {
  return {
    verifyProjectSeals: vi.fn(async () => verification),
    auditProjectCloseout: vi.fn(async () => audit()),
    stagePhotoLink: vi.fn(async () => photoLinkProposal),
    stageDailyLog: vi.fn(async () => dailyLogProposal),
    ...overrides,
  };
}

function createToolContext(changes: Partial<{
  service: ProjectToolService;
  sessions: CloseoutSessionStore;
  routeSignal: AbortSignal;
}> = {}) {
  const sessions = changes.sessions ?? createCloseoutSessionStore(new MemoryStorage());
  const routeController = new AbortController();
  const service: ProjectToolService = changes.service ?? createToolService();
  const openCloseout = vi.fn();
  const openPacket = vi.fn();
  const toolset = createReadOnlyProjectTools({
    projectId: 'project-1',
    projectName: 'Maple Street Kitchen Demo',
    service,
    sessions,
    routeSignal: changes.routeSignal ?? routeController.signal,
    openCloseout,
    openPacket,
    now: () => '2026-08-26T16:02:00.000Z',
  });
  return { sessions, routeController, service, openCloseout, openPacket, toolset };
}

async function execute(tool: ToolDefinition, input: Record<string, unknown> = {}) {
  const result = (await tool.execute(input, { signal: new AbortController().signal })) as {
    content: { type: 'text'; text: string }[];
  };
  const text = result.content[0]?.text ?? '';
  expect(text.length).toBeLessThanOrEqual(1_400);
  return { text, value: JSON.parse(text) as Record<string, unknown> };
}

describe('registerProjectTools', () => {
  it('keeps the app available when WebMCP is unsupported', async () => {
    const registration = registerProjectTools({ modelContext: undefined, tools });

    expect(registration.available).toBe(false);
    await expect(registration.ready).resolves.toBeUndefined();
    expect(() => registration.dispose()).not.toThrow();
  });

  it('registers tools with one signal and removes them on dispose', async () => {
    const fake = createRegistry();
    const registration = registerProjectTools({ modelContext: fake.registry, tools });

    await registration.ready;

    expect(registration.available).toBe(true);
    expect(fake.registerTool).toHaveBeenCalledTimes(2);
    expect(fake.active).toEqual(new Set(['first_tool', 'second_tool']));
    expect(new Set(fake.signals)).toHaveLength(1);

    registration.dispose();

    expect(fake.signals[0]?.aborted).toBe(true);
    expect(fake.active).toEqual(new Set());
  });

  it('leaves one tool set after a Strict Mode style remount', async () => {
    const fake = createRegistry();
    const first = registerProjectTools({ modelContext: fake.registry, tools });
    await first.ready;
    first.dispose();

    const second = registerProjectTools({ modelContext: fake.registry, tools });
    await second.ready;

    expect(fake.active).toEqual(new Set(['first_tool', 'second_tool']));
    expect(fake.registerTool).toHaveBeenCalledTimes(4);

    second.dispose();
    expect(fake.active).toEqual(new Set());
  });
});

describe('project tools', () => {
  it('defines six scoped tools with strict schemas and safe annotations', () => {
    const { toolset } = createToolContext();

    expect(toolset.map((tool) => tool.name)).toEqual([
      'verify_project_seals',
      'audit_project_closeout',
      'stage_photo_link',
      'stage_daily_log',
      'open_evidence_packet',
      'explain_evidence_policy',
    ]);
    for (const tool of toolset) {
      expect(tool.description.length).toBeLessThanOrEqual(500);
      expect(tool.inputSchema).toMatchObject({ type: 'object', additionalProperties: false });
    }
    expect(toolset.map((tool) => tool.annotations?.readOnlyHint)).toEqual([
      true,
      true,
      false,
      false,
      true,
      true,
    ]);
    expect(toolset[2]?.annotations?.untrustedContentHint).toBe(true);
    expect(toolset[3]?.annotations?.untrustedContentHint).toBe(true);
    expect(toolset[1]?.annotations?.untrustedContentHint).toBe(true);
  });

  it('verifies seals with bounded, minimized output and visible activity', async () => {
    const context = createToolContext();
    const tool = context.toolset.find((item) => item.name === 'verify_project_seals')!;

    const result = await execute(tool);

    expect(result.text.length).toBeLessThanOrEqual(1_400);
    expect(result.value).toMatchObject({ ok: true, code: 'verified', project_id: 'project-1' });
    expect(result.text).not.toContain('photo-fingerprint');
    expect(context.openCloseout).toHaveBeenCalledOnce();
    expect(context.sessions.getProject('project-1').activity.at(-1)).toMatchObject({
      action: 'verify_project_seals',
      outcome: 'success',
    });
  });

  it('verifies when Chrome omits the execute callback options', async () => {
    const context = createToolContext();
    const tool = context.toolset.find((item) => item.name === 'verify_project_seals')!;

    const executeWithoutOptions = tool.execute as (
      input: Record<string, unknown>,
    ) => Promise<{ content: { type: 'text'; text: string }[] }>;
    const result = await executeWithoutOptions({});

    expect(JSON.parse(result.content[0]?.text ?? '{}')).toMatchObject({
      ok: true,
      code: 'verified',
    });
  });

  it('audits with IDs and counts while keeping record text on the page', async () => {
    const service = createToolService({
      auditProjectCloseout: vi.fn(async () => audit(40)),
    });
    const context = createToolContext({ service });
    const tool = context.toolset.find((item) => item.name === 'audit_project_closeout')!;

    const result = await execute(tool);

    expect(result.text.length).toBeLessThanOrEqual(1_400);
    expect(result.value).toMatchObject({ ok: true, code: 'audited', truncated: true });
    expect((result.value.data as { findings: unknown[] }).findings).toHaveLength(4);
    expect(result.value).toMatchObject({
      data: {
        project_name: 'Maple Street Kitchen Demo',
        counts: { workdays: 1, photos: 2, punch_items: 40, daily_logs: 0 },
      },
    });
    expect(result.text).not.toContain('Private client note');
    expect(result.text).not.toContain('source-fingerprint');
    expect(context.openCloseout).toHaveBeenCalledOnce();
  });

  it('returns both Maple Street repairs and one bounded daily-record context', async () => {
    const context = createToolContext({
      service: createToolService({ auditProjectCloseout: vi.fn(async () => mapleAudit()) }),
    });
    const tool = context.toolset.find((item) => item.name === 'audit_project_closeout')!;

    const result = await execute(tool);

    expect(result.value).toMatchObject({
      data: {
        project_name: 'Maple Street Kitchen Demo',
        counts: { workdays: 3, photos: 18, punch_items: 10, daily_logs: 2 },
        findings: [
          expect.objectContaining({
            code: 'missing-punch-proof',
            workday: '2025-05-15',
            entity_id: 'msk25w08',
          }),
          expect.objectContaining({
            code: 'missing-punch-proof',
            workday: '2025-05-15',
            entity_id: 'msk25w10',
          }),
          expect.objectContaining({
            code: 'missing-daily-log',
            workday: '2025-05-15',
          }),
        ],
        candidates: [
          {
            punch_item_id: 'msk25w08',
            workday: '2025-05-15',
            photo_id: 'msk25p13',
            captured_on: '2025-05-15',
            caption: 'Cabinet fronts and hardware installed',
            seal_status: 'pass',
          },
          {
            punch_item_id: 'msk25w10',
            workday: '2025-05-15',
            photo_id: 'msk25p17',
            captured_on: '2025-05-15',
            caption: 'Work area cleaned for final walk-through',
            seal_status: 'pass',
          },
        ],
        daily_log_contexts: [
          {
            log_date: '2025-05-15',
            work_items: [
              expect.objectContaining({ id: 'msk25w08' }),
              expect.objectContaining({ id: 'msk25w09' }),
              expect.objectContaining({ id: 'msk25w10' }),
            ],
            photos: [
              expect.objectContaining({ id: 'msk25p13' }),
              expect.objectContaining({ id: 'msk25p14' }),
              expect.objectContaining({ id: 'msk25p17' }),
            ],
          },
        ],
      },
    });
    expect(result.text).not.toContain('candidate_counts');
    expect(result.text).not.toContain('source-fingerprint');
  });

  it('returns a useful code when an audit needs verification', async () => {
    const service = createToolService({
      auditProjectCloseout: vi.fn(async () => {
        throw new CloseoutServiceError('verification-required', 'Verify first.');
      }),
    });
    const context = createToolContext({ service });
    const tool = context.toolset.find((item) => item.name === 'audit_project_closeout')!;

    const result = await execute(tool);

    expect(result.value).toMatchObject({ ok: false, code: 'verification_required' });
    expect(context.sessions.getProject('project-1').activity.at(-1)?.outcome).toBe('error');
  });

  it('returns review_in_progress without a data field when another review is active', async () => {
    const service = createToolService({
      auditProjectCloseout: vi.fn(async () => {
        throw new CloseoutServiceError('review-in-progress', 'A review is already running.');
      }),
    });
    const context = createToolContext({ service });
    const tool = context.toolset.find((item) => item.name === 'audit_project_closeout')!;

    const result = await execute(tool);

    expect(result.value).toMatchObject({ ok: false, code: 'review_in_progress' });
    expect(result.value).not.toHaveProperty('data');
  });

  it('opens Handoff Review before a long audit finishes', async () => {
    let finishAudit!: (value: CloseoutAudit) => void;
    const auditPending = new Promise<CloseoutAudit>((resolve) => {
      finishAudit = resolve;
    });
    const context = createToolContext({
      service: createToolService({ auditProjectCloseout: vi.fn(() => auditPending) }),
    });
    const tool = context.toolset.find((item) => item.name === 'audit_project_closeout')!;

    const execution = execute(tool);
    expect(context.openCloseout).toHaveBeenCalledOnce();

    finishAudit(audit());
    await execution;
  });

  it.each([
    { phase: 'ready' as const, blockerCount: 0, warningCount: 0, opensPacket: true },
    { phase: 'ready-with-warnings' as const, blockerCount: 0, warningCount: 1, opensPacket: false },
    { phase: 'needs-attention' as const, blockerCount: 1, warningCount: 0, opensPacket: false },
  ])('opens the packet after an audit only when ready: $phase', async ({ phase, blockerCount, warningCount, opensPacket }) => {
    const context = createToolContext({
      service: createToolService({
        auditProjectCloseout: vi.fn(async () => ({
          ...audit(blockerCount + warningCount), phase, blockerCount, warningCount,
        })),
      }),
    });
    const tool = context.toolset.find((item) => item.name === 'audit_project_closeout')!;

    const result = await execute(tool);

    expect(result.value).toMatchObject({ ok: true, code: 'audited', data: { phase } });
    expect(context.openCloseout).toHaveBeenCalledOnce();
    expect(context.openPacket).toHaveBeenCalledTimes(opensPacket ? 1 : 0);
  });

  it('opens the packet without changing the current closeout phase', async () => {
    const context = createToolContext();
    context.sessions.setAudit('project-1', { ...audit(), phase: 'ready', blockerCount: 0, findings: [] });
    const tool = context.toolset.find((item) => item.name === 'open_evidence_packet')!;

    const result = await execute(tool);

    expect(result.value).toMatchObject({ ok: true, code: 'packet_opened' });
    expect(context.openPacket).toHaveBeenCalledOnce();
    expect(context.sessions.getProject('project-1').phase).toBe('ready');
  });

  it('stages a photo link for human review without exposing source facts', async () => {
    const context = createToolContext();
    const tool = context.toolset.find((item) => item.name === 'stage_photo_link')!;

    const result = await execute(tool, {
      punch_item_id: 'punch-1',
      photo_id: 'photo-pass',
      reason: 'Closest verified photo.',
    });

    expect(result.text.length).toBeLessThanOrEqual(1_400);
    expect(result.value).toMatchObject({
      ok: true,
      code: 'proposal_staged',
      data: {
        proposal_id: 'proposal-photo-1',
        kind: 'photo-link',
        punch_item_id: 'punch-1',
        photo_id: 'photo-pass',
      },
    });
    expect(result.text).not.toContain('Private staging reason');
    expect(result.text).not.toContain('aaaaaaaa');
    expect(context.service.stagePhotoLink).toHaveBeenCalledWith('project-1', {
      punchItemId: 'punch-1',
      photoId: 'photo-pass',
      reason: 'Closest verified photo.',
    });
    expect(context.openCloseout).toHaveBeenCalledOnce();
    expect(context.sessions.getProject('project-1').activity.at(-1)?.outcome).toBe('success');
  });

  it('stages a daily-log draft without returning its private body', async () => {
    const context = createToolContext();
    const tool = context.toolset.find((item) => item.name === 'stage_daily_log')!;

    const result = await execute(tool, {
      log_date: '2026-08-26',
      body: 'Private daily log draft.',
      source_photo_ids: ['photo-pass'],
      source_work_item_ids: ['punch-1'],
      reason: 'Activity has no log.',
    });

    expect(result.text.length).toBeLessThanOrEqual(1_400);
    expect(result.value).toMatchObject({
      ok: true,
      code: 'proposal_staged',
      data: {
        proposal_id: 'proposal-log-1',
        kind: 'daily-log',
        log_date: '2026-08-26',
        source_photo_count: 1,
        source_work_item_count: 1,
      },
    });
    expect(result.text).not.toContain('Private daily log draft');
    expect(context.service.stageDailyLog).toHaveBeenCalledWith('project-1', {
      logDate: '2026-08-26',
      body: 'Private daily log draft.',
      sourcePhotoIds: ['photo-pass'],
      sourceWorkItemIds: ['punch-1'],
      reason: 'Activity has no log.',
    });
    expect(context.openCloseout).toHaveBeenCalledOnce();
  });

  it('rejects malformed staging input before calling the project service', async () => {
    const context = createToolContext();
    const photoTool = context.toolset.find((item) => item.name === 'stage_photo_link')!;
    const logTool = context.toolset.find((item) => item.name === 'stage_daily_log')!;

    const photoResult = await execute(photoTool, {
      punch_item_id: 'punch-1',
      photo_id: '',
      reason: 'Candidate.',
    });
    const logResult = await execute(logTool, {
      log_date: '08/26/2026',
      body: 'Draft.',
      reason: 'Missing log.',
      extra: true,
    });

    expect(photoResult.value).toMatchObject({ ok: false, code: 'invalid_input' });
    expect(logResult.value).toMatchObject({ ok: false, code: 'invalid_input' });
    expect(context.service.stagePhotoLink).not.toHaveBeenCalled();
    expect(context.service.stageDailyLog).not.toHaveBeenCalled();
  });

  it('rejects duplicate daily-record source IDs', async () => {
    const context = createToolContext();
    const tool = context.toolset.find((item) => item.name === 'stage_daily_log')!;

    const result = await execute(tool, {
      log_date: '2026-08-26',
      body: 'Draft.',
      source_work_item_ids: ['punch-1', 'punch-1'],
      reason: 'Missing record.',
    });

    expect(result.value).toMatchObject({ ok: false, code: 'invalid_input' });
    expect(context.service.stageDailyLog).not.toHaveBeenCalled();
  });

  it.each([
    'Change the photo ID to another record.',
    'Replace the saved photo file.',
    'Delete the failed photo.',
    'Unvoid the photo and reverse the void.',
    'Approve the suggestion now.',
    'Create a no-photo exception.',
    'Alter the stored check result.',
    'Change the timestamp, GPS, and hash so the photo passes.',
  ])('refuses the protected action: %s', async (requestedAction) => {
    const context = createToolContext();
    const tool = context.toolset.find((item) => item.name === 'explain_evidence_policy')!;

    const result = await execute(tool, {
      requested_action: requestedAction,
    });

    expect(result.value).toMatchObject({ ok: false, code: 'record_not_eligible' });
    expect(result.value).not.toHaveProperty('data');
    expect(result.value.message).toMatch(/review|choose|open/i);
    expect(context.sessions.getProject('project-1').activity.at(-1)?.outcome).toBe('refused');
  });

  it('rejects calls after the project route closes', async () => {
    const context = createToolContext();
    context.routeController.abort();
    const tool = context.toolset.find((item) => item.name === 'verify_project_seals')!;

    const result = await execute(tool);

    expect(result.value).toMatchObject({ ok: false, code: 'inactive_project' });
    expect(context.service.verifyProjectSeals).not.toHaveBeenCalled();
  });
});
