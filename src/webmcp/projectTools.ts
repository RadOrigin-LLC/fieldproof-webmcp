import { CloseoutServiceError, type CloseoutService } from '../data/closeoutService.ts';
import type { CloseoutSessionStore } from '../data/closeoutSession.ts';
import { localDateOf } from '../domain/dates.ts';
import { uuidv7 } from '../domain/ids.ts';

export type ModelContextRegistry = Pick<WebMCP.ModelContext, 'registerTool'>;
export type ToolDefinition = WebMCP.ModelContextTool;

export type ProjectToolService = Pick<
  CloseoutService,
  'verifyProjectSeals' | 'auditProjectCloseout' | 'stagePhotoLink' | 'stageDailyLog'
>;

type ReadOnlyProjectToolOptions = {
  projectId: string;
  projectName: string;
  service: ProjectToolService;
  sessions: CloseoutSessionStore;
  routeSignal: AbortSignal;
  openCloseout: () => void;
  openPacket: () => void;
  now?: () => string;
};

type ToolEnvelope = {
  ok: boolean;
  code: string;
  project_id: string;
  message: string;
  data?: Record<string, unknown>;
  truncated?: boolean;
};

const OUTPUT_LIMIT = 1_400;

type AuditToolSource = Awaited<ReturnType<ProjectToolService['auditProjectCloseout']>> & {
  dailyLogContexts?: Array<{
    logDate: string;
    workItems: Array<{ id: string; text: string }>;
    photos: Array<{ id: string; caption?: string }>;
  }>;
};

type AuditToolFinding = {
  code: string;
  severity: string;
  workday?: string;
  entity_type: string;
  entity_id?: string;
};

type AuditToolCandidate = {
  punch_item_id: string;
  workday: string;
  photo_id: string;
  captured_on: string;
  caption?: string;
  seal_status: string;
};

type AuditToolDailyContext = {
  log_date: string;
  work_items: Array<{ id: string; text: string }>;
  photos: Array<{ id: string; caption?: string }>;
};

type AuditToolData = {
  project_name: string;
  phase: AuditToolSource['phase'];
  blocker_count: number;
  warning_count: number;
  counts: {
    workdays: number;
    photos: number;
    punch_items: number;
    daily_logs: number;
  };
  findings: AuditToolFinding[];
  candidates: AuditToolCandidate[];
  daily_log_contexts: AuditToolDailyContext[];
};

const EMPTY_INPUT_SCHEMA = {
  type: 'object',
  properties: {},
  additionalProperties: false,
} as const;

function toolResult(envelope: ToolEnvelope) {
  let text = JSON.stringify(envelope);
  if (text.length > OUTPUT_LIMIT) {
    text = JSON.stringify({
      ok: envelope.ok,
      code: envelope.code,
      project_id: envelope.project_id,
      message: 'The result was shortened. Open Handoff for the full list.',
      truncated: true,
    });
  }
  return { content: [{ type: 'text', text }] };
}

function auditToolResult(
  projectId: string,
  projectName: string,
  result: AuditToolSource,
) {
  let truncated = false;
  const bounded = (value: string, limit: number) => {
    if (value.length > limit) truncated = true;
    return value.slice(0, limit);
  };
  const findingPriority = (code: string) => {
    if (code === 'missing-punch-proof') return 0;
    if (code === 'missing-daily-log') return 1;
    return 2;
  };
  const orderedFindings = result.findings
    .map((finding, index) => ({ finding, index }))
    .sort(
      (left, right) =>
        findingPriority(left.finding.code) - findingPriority(right.finding.code) ||
        left.index - right.index,
    )
    .map(({ finding }) => finding);
  const selectedFindings = orderedFindings.slice(0, 4);
  if (selectedFindings.length < orderedFindings.length) truncated = true;
  const findings: AuditToolFinding[] = selectedFindings.map((finding) => ({
    code: finding.code,
    severity: finding.severity,
    ...(finding.workdayDate ? { workday: finding.workdayDate } : {}),
    entity_type: finding.entityType,
    ...(finding.entityId ? { entity_id: finding.entityId } : {}),
  }));

  const repairTargets = selectedFindings
    .filter(
      (finding) =>
        finding.code === 'missing-punch-proof' &&
        Boolean(finding.entityId),
    )
    .slice(0, 2)
    .map((finding) => ({
      punchItemId: finding.entityId as string,
      workday: finding.workdayDate ?? '',
    }));
  const primaryCandidates: AuditToolCandidate[] = [];
  const extraCandidates: AuditToolCandidate[] = [];
  for (const target of repairTargets) {
    const rows = result.candidates[target.punchItemId] ?? [];
    rows.forEach((candidate, index) => {
      const mapped: AuditToolCandidate = {
        punch_item_id: target.punchItemId,
        workday: target.workday || localDateOf(candidate.capturedAt),
        photo_id: candidate.photoId,
        captured_on: localDateOf(candidate.capturedAt),
        ...(candidate.caption ? { caption: bounded(candidate.caption, 56) } : {}),
        seal_status: candidate.sealStatus,
      };
      if (index === 0) primaryCandidates.push(mapped);
      else extraCandidates.push(mapped);
    });
  }
  const candidates = [...primaryCandidates, ...extraCandidates].slice(0, 4);
  const candidateTotal = Object.values(result.candidates).reduce(
    (total, rows) => total + rows.length,
    0,
  );
  if (candidates.length < candidateTotal) truncated = true;

  const sourceContexts = result.dailyLogContexts ?? [];
  const dailyFinding = selectedFindings.find(
    (finding) => finding.code === 'missing-daily-log',
  );
  const wantedDate = dailyFinding?.workdayDate ?? dailyFinding?.entityId;
  const sourceContext = wantedDate
    ? sourceContexts.find((context) => context.logDate === wantedDate)
    : sourceContexts[0];
  if (sourceContexts.length > (sourceContext ? 1 : 0)) truncated = true;
  const dailyLogContexts: AuditToolDailyContext[] = sourceContext
    ? [
        {
          log_date: sourceContext.logDate,
          work_items: sourceContext.workItems.slice(0, 3).map((item) => ({
            id: item.id,
            text: bounded(item.text, 56),
          })),
          photos: sourceContext.photos.slice(0, 3).map((photo) => ({
            id: photo.id,
            ...(photo.caption ? { caption: bounded(photo.caption, 56) } : {}),
          })),
        },
      ]
    : [];
  if (
    sourceContext &&
    (sourceContext.workItems.length > 3 || sourceContext.photos.length > 3)
  ) {
    truncated = true;
  }

  const data: AuditToolData = {
    project_name: bounded(projectName, 48),
    phase: result.phase,
    blocker_count: result.blockerCount,
    warning_count: result.warningCount,
    counts: {
      workdays: result.counts.workdays,
      photos: result.counts.photos,
      punch_items: result.counts.punchItems,
      daily_logs: result.counts.dailyLogs,
    },
    findings,
    candidates,
    daily_log_contexts: dailyLogContexts,
  };
  const message = 'Review finished. Full details stay in Handoff Review.';
  const serialize = () =>
    JSON.stringify({
      ok: true,
      code: 'audited',
      project_id: projectId,
      message,
      data,
      truncated,
    });

  while (serialize().length > OUTPUT_LIMIT && data.candidates.length > primaryCandidates.length) {
    data.candidates.pop();
    truncated = true;
  }
  if (serialize().length > OUTPUT_LIMIT) {
    data.daily_log_contexts = data.daily_log_contexts.map((context) => ({
      ...context,
      work_items: context.work_items.map((item) => ({
        ...item,
        text: bounded(item.text, 32),
      })),
      photos: context.photos.map((photo) => ({
        ...photo,
        ...(photo.caption ? { caption: bounded(photo.caption, 32) } : {}),
      })),
    }));
  }
  if (serialize().length > OUTPUT_LIMIT) {
    data.daily_log_contexts = data.daily_log_contexts.map((context) => ({
      ...context,
      photos: context.photos.map((photo) => ({ id: photo.id })),
    }));
    truncated = true;
  }
  if (serialize().length > OUTPUT_LIMIT) {
    data.candidates = data.candidates.map((candidate) => ({
      punch_item_id: candidate.punch_item_id,
      workday: candidate.workday,
      photo_id: candidate.photo_id,
      captured_on: candidate.captured_on,
      seal_status: candidate.seal_status,
    }));
    truncated = true;
  }
  if (serialize().length > OUTPUT_LIMIT) {
    const repairIds = new Set(data.candidates.map((candidate) => candidate.punch_item_id));
    const contextDates = new Set(
      data.daily_log_contexts.map((context) => context.log_date),
    );
    data.findings = data.findings.filter(
      (finding) =>
        (finding.code === 'missing-punch-proof' &&
          Boolean(finding.entity_id && repairIds.has(finding.entity_id))) ||
        (finding.code === 'missing-daily-log' &&
          Boolean(finding.workday && contextDates.has(finding.workday))),
    );
    truncated = true;
  }
  if (serialize().length > OUTPUT_LIMIT) {
    const text = JSON.stringify({
      ok: true,
      code: 'audited',
      project_id: projectId,
      message: 'Review finished. Open Handoff Review for the full result.',
      truncated: true,
    });
    return { content: [{ type: 'text', text }] };
  }
  return { content: [{ type: 'text', text: serialize() }] };
}

function hasNoInput(input: Record<string, unknown>): boolean {
  return Object.keys(input).length === 0;
}

function normalizedSourceIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > 12) return undefined;
  if (
    value.some(
      (id) =>
        typeof id !== 'string' ||
        id.trim().length < 1 ||
        id.length > 128,
    )
  ) {
    return undefined;
  }
  const normalized = value.map((id) => (id as string).trim());
  return new Set(normalized).size === normalized.length ? normalized : undefined;
}

function combineSignals(
  callSignal: AbortSignal | undefined,
  routeSignal: AbortSignal,
): AbortSignal {
  return callSignal ? AbortSignal.any([callSignal, routeSignal]) : routeSignal;
}

function errorEnvelope(projectId: string, error: unknown): ToolEnvelope {
  if (error instanceof CloseoutServiceError) {
    const messages: Record<CloseoutServiceError['code'], string> = {
      'project-not-found': 'The active project is no longer available.',
      'verification-required': 'Check the current project photos before this action.',
      'review-in-progress': 'A handoff review is already running for this project.',
      'invalid-input': 'The request is missing a required field or has an invalid value.',
      'record-not-found': 'FieldProof could not find one of the requested job records.',
      'record-not-eligible': 'This job record cannot be used for that action.',
    };
    return {
      ok: false,
      code: error.code.replaceAll('-', '_'),
      project_id: projectId,
      message: messages[error.code],
    };
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return {
      ok: false,
      code: 'cancelled',
      project_id: projectId,
      message: 'The request was canceled.',
    };
  }
  return {
    ok: false,
    code: 'tool_failed',
    project_id: projectId,
    message: 'FieldProof could not finish the request.',
  };
}

export function createReadOnlyProjectTools({
  projectId,
  projectName,
  service,
  sessions,
  routeSignal,
  openCloseout,
  openPacket,
  now = () => new Date().toISOString(),
}: ReadOnlyProjectToolOptions): ToolDefinition[] {
  const recordActivity = (
    action: string,
    outcome: 'started' | 'success' | 'refused' | 'cancelled' | 'error',
    detail: string,
  ) => {
    sessions.addActivity(projectId, {
      id: uuidv7(),
      projectId,
      action,
      outcome,
      occurredAt: now(),
      detail,
    });
  };

  const inactiveResult = () =>
    toolResult({
      ok: false,
      code: 'inactive_project',
      project_id: projectId,
      message: 'This project page is no longer active.',
    });

  const invalidInput = (action: string) => {
    recordActivity(action, 'error', 'The request had missing or invalid fields.');
    return toolResult({
      ok: false,
      code: 'invalid_input',
      project_id: projectId,
      message: 'The request is missing a required field or has an invalid value.',
    });
  };

  const finishError = (action: string, error: unknown) => {
    if (routeSignal.aborted) return inactiveResult();
    const envelope = errorEnvelope(projectId, error);
    recordActivity(action, envelope.code === 'cancelled' ? 'cancelled' : 'error', envelope.message);
    return toolResult(envelope);
  };

  const verify: ToolDefinition = {
    name: 'verify_project_seals',
    title: 'Check project photos',
    description:
      'Check whether each saved photo still matches the file captured for this project. Opens the Handoff tab and leaves the job record unchanged.',
    inputSchema: EMPTY_INPUT_SCHEMA,
    annotations: { readOnlyHint: true },
    execute: async (input, options) => {
      if (routeSignal.aborted) return inactiveResult();
      if (!hasNoInput(input)) return invalidInput('verify_project_seals');
      openCloseout();
      recordActivity('verify_project_seals', 'started', 'Checking the saved photos.');
      try {
        const verification = await service.verifyProjectSeals(
          projectId,
          combineSignals(options?.signal, routeSignal),
        );
        if (routeSignal.aborted) return inactiveResult();
        recordActivity('verify_project_seals', 'success', 'Photo check finished.');
        return toolResult({
          ok: true,
          code: 'verified',
          project_id: projectId,
          message: 'The photo check is complete. Open Handoff for the full result.',
          data: {
            summary: verification.summary,
            failed_photo_ids: verification.results
              .filter((item) => item.status === 'fail' || item.status === 'unreadable')
              .slice(0, 3)
              .map((item) => item.photoId),
          },
          truncated: verification.results.filter(
            (item) => item.status === 'fail' || item.status === 'unreadable',
          ).length > 3,
        });
      } catch (error) {
        return finishError('verify_project_seals', error);
      }
    },
  };

  const audit: ToolDefinition = {
    name: 'audit_project_closeout',
    title: 'Check handoff readiness',
    description:
      'Check the open project for unfinished work, missing proof, and blank daily logs. Run the photo check first. Full notes stay on the page.',
    inputSchema: EMPTY_INPUT_SCHEMA,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (input, options) => {
      if (routeSignal.aborted) return inactiveResult();
      if (!hasNoInput(input)) return invalidInput('audit_project_closeout');
      openCloseout();
      recordActivity('audit_project_closeout', 'started', 'Checking the handoff details.');
      try {
        const result = await service.auditProjectCloseout(
          projectId,
          combineSignals(options?.signal, routeSignal),
        );
        if (routeSignal.aborted) return inactiveResult();
        recordActivity('audit_project_closeout', 'success', 'Handoff check finished.');
        return auditToolResult(projectId, projectName, result);
      } catch (error) {
        return finishError('audit_project_closeout', error);
      }
    },
  };

  const stagePhotoLink: ToolDefinition = {
    name: 'stage_photo_link',
    title: 'Suggest a proof photo',
    description:
      'Prepare a link between one completed punch item and one checked project photo. The user reviews the suggestion before FieldProof saves it.',
    inputSchema: {
      type: 'object',
      properties: {
        punch_item_id: {
          type: 'string',
          minLength: 1,
          maxLength: 128,
          description: 'Completed punch item ID in the open project.',
        },
        photo_id: {
          type: 'string',
          minLength: 1,
          maxLength: 128,
          description: 'Project photo ID that passed the latest file check.',
        },
        reason: {
          type: 'string',
          minLength: 1,
          maxLength: 240,
          description: 'Why this photo may support the punch item.',
        },
      },
      required: ['punch_item_id', 'photo_id', 'reason'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute: async (input) => {
      if (routeSignal.aborted) return inactiveResult();
      const punchItemId = input.punch_item_id;
      const photoId = input.photo_id;
      const reason = input.reason;
      if (
        Object.keys(input).length !== 3 ||
        typeof punchItemId !== 'string' ||
        punchItemId.trim().length < 1 ||
        punchItemId.length > 128 ||
        typeof photoId !== 'string' ||
        photoId.trim().length < 1 ||
        photoId.length > 128 ||
        typeof reason !== 'string' ||
        reason.trim().length < 1 ||
        reason.length > 240
      ) {
        return invalidInput('stage_photo_link');
      }
      recordActivity('stage_photo_link', 'started', 'Preparing a proof-photo suggestion.');
      try {
        const proposal = await service.stagePhotoLink(projectId, {
          punchItemId: punchItemId.trim(),
          photoId: photoId.trim(),
          reason: reason.trim(),
        });
        if (routeSignal.aborted) return inactiveResult();
        openCloseout();
        recordActivity('stage_photo_link', 'success', 'Suggested a proof photo.');
        return toolResult({
          ok: true,
          code: 'proposal_staged',
          project_id: projectId,
          message: 'The proof-photo suggestion is ready for review in Handoff.',
          data: {
            proposal_id: proposal.id,
            kind: proposal.kind,
            punch_item_id: proposal.punchItemId,
            photo_id: proposal.photoId,
            status: proposal.status,
          },
        });
      } catch (error) {
        return finishError('stage_photo_link', error);
      }
    },
  };

  const stageDailyLog: ToolDefinition = {
    name: 'stage_daily_log',
    title: 'Draft a missing daily log',
    description:
      'Draft a daily log for a day with recorded work and no saved log. The user reviews the draft before FieldProof saves it.',
    inputSchema: {
      type: 'object',
      properties: {
        log_date: {
          type: 'string',
          pattern: '^\\d{4}-\\d{2}-\\d{2}$',
          description: 'Project activity date in YYYY-MM-DD form.',
        },
        body: {
          type: 'string',
          minLength: 1,
          maxLength: 4000,
          description: 'Daily log draft for user review.',
        },
        source_photo_ids: {
          type: 'array',
          maxItems: 12,
          uniqueItems: true,
          items: { type: 'string', minLength: 1, maxLength: 128 },
          description: 'Optional active photo IDs that support the draft.',
        },
        source_work_item_ids: {
          type: 'array',
          maxItems: 12,
          uniqueItems: true,
          items: { type: 'string', minLength: 1, maxLength: 128 },
          description: 'Optional completed work-item IDs from the same workday.',
        },
        reason: {
          type: 'string',
          minLength: 1,
          maxLength: 240,
          description: 'Why this date needs a daily log draft.',
        },
      },
      required: ['log_date', 'body', 'reason'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute: async (input) => {
      if (routeSignal.aborted) return inactiveResult();
      const allowedKeys = new Set([
        'log_date',
        'body',
        'source_photo_ids',
        'source_work_item_ids',
        'reason',
      ]);
      const logDate = input.log_date;
      const body = input.body;
      const reason = input.reason;
      const sourcePhotoIds = normalizedSourceIds(input.source_photo_ids ?? []);
      const sourceWorkItemIds = normalizedSourceIds(input.source_work_item_ids ?? []);
      if (
        Object.keys(input).some((key) => !allowedKeys.has(key)) ||
        typeof logDate !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(logDate) ||
        typeof body !== 'string' ||
        body.trim().length < 1 ||
        body.length > 4_000 ||
        typeof reason !== 'string' ||
        reason.trim().length < 1 ||
        reason.length > 240 ||
        !sourcePhotoIds ||
        !sourceWorkItemIds
      ) {
        return invalidInput('stage_daily_log');
      }
      recordActivity('stage_daily_log', 'started', 'Drafting a missing daily log.');
      try {
        const proposal = await service.stageDailyLog(projectId, {
          logDate,
          body: body.trim(),
          sourcePhotoIds,
          sourceWorkItemIds,
          reason: reason.trim(),
        });
        if (routeSignal.aborted) return inactiveResult();
        openCloseout();
        recordActivity('stage_daily_log', 'success', 'Drafted a missing daily log.');
        return toolResult({
          ok: true,
          code: 'proposal_staged',
          project_id: projectId,
          message: 'The daily log draft is ready for review in Handoff.',
          data: {
            proposal_id: proposal.id,
            kind: proposal.kind,
            log_date: proposal.logDate,
            source_photo_count: proposal.sourcePhotoIds.length,
            source_work_item_count: proposal.sourceWorkItemIds.length,
            status: proposal.status,
          },
        });
      } catch (error) {
        return finishError('stage_daily_log', error);
      }
    },
  };

  const openEvidencePacket: ToolDefinition = {
    name: 'open_evidence_packet',
    title: 'Open handoff packet',
    description:
      'Open the handoff packet for the active project. This changes only the page on screen and leaves the job record unchanged.',
    inputSchema: EMPTY_INPUT_SCHEMA,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: (input) => {
      if (routeSignal.aborted) return inactiveResult();
      if (!hasNoInput(input)) return invalidInput('open_evidence_packet');
      recordActivity('open_evidence_packet', 'started', 'Opening the handoff packet.');
      const session = sessions.getProject(projectId);
      openPacket();
      recordActivity('open_evidence_packet', 'success', 'Handoff packet opened.');
      return toolResult({
        ok: true,
        code: 'packet_opened',
        project_id: projectId,
        message: 'The handoff packet is open.',
        data: {
          closeout_phase: session.phase,
          blocker_count: session.audit?.blockerCount ?? null,
          warning_count: session.audit?.warningCount ?? null,
        },
      });
    },
  };

  const isProtectedRecordRequest = (request: string) => {
    const protectedAction =
      /\b(change|alter|edit|replace|forge|fake|remove|delete|void|unvoid|restore|reverse|bypass|override|approve|apply|save|select|mark|reseal|create)\b/i;
    const protectedFact =
      /\b(timestamp|capture\s+(?:time|date)|gps|coordinates?|location|hash|fingerprint|seal|photo\s+(?:id|identifier|bytes?|file)|original\s+(?:photo|file|bytes?)|stored\s+(?:check|photo\s+check)|file\s+replacement)\b/i;
    const photoRecordAction =
      /\b(delete|void|unvoid|restore|reverse|replace|reseal)\b.{0,80}\b(photo|image|file|void(?:ed)?\s+record)\b/i;
    const directApproval =
      /\b(approve|apply|save|select)\b.{0,80}\b(suggested\s+update|suggestion|proposal|no-photo\s+exception)\b/i;
    const noPhotoException =
      /\b(create|add|approve|record)\b.{0,80}\bno-photo\s+exception\b/i;
    return (
      (protectedAction.test(request) && protectedFact.test(request)) ||
      photoRecordAction.test(request) ||
      directApproval.test(request) ||
      noPhotoException.test(request)
    );
  };

  const explainPolicy: ToolDefinition = {
    name: 'explain_evidence_policy',
    title: 'Explain the job-record rules',
    description:
      'Explain whether FieldProof can complete a requested job-record action. FieldProof declines requests to change capture facts, photo files, or a user’s approval.',
    inputSchema: {
      type: 'object',
      properties: {
        requested_action: {
          type: 'string',
          minLength: 1,
          maxLength: 300,
          description: 'The evidence action to check.',
        },
      },
      required: ['requested_action'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: (input) => {
      if (routeSignal.aborted) return inactiveResult();
      const requestedAction = input.requested_action;
      if (
        Object.keys(input).length !== 1 ||
        typeof requestedAction !== 'string' ||
        requestedAction.trim().length < 1 ||
        requestedAction.length > 300
      ) {
        return invalidInput('explain_evidence_policy');
      }
      recordActivity('explain_evidence_policy', 'started', 'Checking the job-record rules.');
      if (isProtectedRecordRequest(requestedAction)) {
        recordActivity('explain_evidence_policy', 'refused', 'Declined a request to change protected job facts.');
        return toolResult({
          ok: false,
          code: 'record_not_eligible',
          project_id: projectId,
          message:
            'The protected record stays unchanged. Choose another photo or ask the contractor to make the allowed change.',
        });
      }
      recordActivity('explain_evidence_policy', 'success', 'Job-record rule check finished.');
      return toolResult({
        ok: true,
        code: 'policy_explained',
        project_id: projectId,
        message:
          'FieldProof can discuss this request or prepare an update. The user must approve each job-record change.',
        data: {
          protected_facts: ['photo file', 'file fingerprint', 'capture time', 'location', 'approval'],
          review_required: true,
        },
      });
    },
  };

  return [verify, audit, stagePhotoLink, stageDailyLog, openEvidencePacket, explainPolicy];
}

export type ProjectToolRegistration = {
  available: boolean;
  ready: Promise<void>;
  dispose: () => void;
};

type RegisterProjectToolsOptions = {
  modelContext: ModelContextRegistry | undefined;
  tools: readonly ToolDefinition[];
};

export function registerProjectTools({
  modelContext,
  tools,
}: RegisterProjectToolsOptions): ProjectToolRegistration {
  const controller = new AbortController();

  if (!modelContext) {
    return {
      available: false,
      ready: Promise.resolve(),
      dispose: () => controller.abort(),
    };
  }

  const ready = Promise.all(
    tools.map((tool) => modelContext.registerTool(tool, { signal: controller.signal })),
  ).then(() => undefined);

  return {
    available: true,
    ready,
    dispose: () => controller.abort(),
  };
}
