import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CLOSEOUT_SESSION_KEY,
  createCloseoutSessionStore,
  getCloseoutSessionStore,
  type StorageLike,
  useProjectCloseoutSession,
} from './closeoutSession.ts';
import type {
  AgentActivity,
  CloseoutAudit,
  CloseoutProposal,
  SealVerification,
} from '../domain/closeout.ts';

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

function photoProposal(id: string, projectId = 'project-a'): CloseoutProposal {
  return {
    kind: 'photo-link',
    id,
    projectId,
    createdAt: '2026-08-26T16:00:00.000Z',
    status: 'pending',
    selected: false,
    dismissed: false,
    reason: 'Closeout candidate',
    punchItemId: 'punch-1',
    punchItemLabel: 'Install cabinet face',
    workdayDate: '2026-08-26',
    photoId: 'photo-1',
    expectedPunchUpdatedAt: '2026-08-26T15:00:00.000Z',
    expectedPhotoIdentity: 'photo-identity',
    sourceFingerprint: 'scoped-source',
  };
}

function activity(id: string, projectId = 'project-a'): AgentActivity {
  return {
    id,
    projectId,
    action: 'audit_project_closeout',
    outcome: 'success',
    occurredAt: '2026-08-26T16:00:00.000Z',
    detail: 'Audit complete.',
  };
}

describe('closeout session store', () => {
  it('provides one shared browser store', () => {
    expect(getCloseoutSessionStore()).toBe(getCloseoutSessionStore());
  });

  it('resets invalid stored JSON without throwing', () => {
    const storage = new MemoryStorage();
    storage.setItem(CLOSEOUT_SESSION_KEY, '{broken');

    const store = createCloseoutSessionStore(storage);

    expect(store.getProject('project-a')).toEqual({
      phase: 'not-checked',
      proposals: [],
      activity: [],
    });
    expect(store.getProject('missing')).toBe(store.getProject('missing'));
  });

  it('persists proposals by project through a reload', () => {
    const storage = new MemoryStorage();
    const first = createCloseoutSessionStore(storage);
    first.addProposal('project-a', photoProposal('proposal-1'));
    first.addActivity('project-a', activity('activity-1'));

    const reloaded = createCloseoutSessionStore(storage);

    expect(reloaded.getProject('project-a').proposals.map((item) => item.id)).toEqual([
      'proposal-1',
    ]);
    expect(reloaded.getProject('project-a').proposals[0]).toMatchObject({
      selected: false,
      dismissed: false,
      punchItemLabel: 'Install cabinet face',
      workdayDate: '2026-08-26',
      expectedPhotoIdentity: 'photo-identity',
      sourceFingerprint: 'scoped-source',
    });
    expect(reloaded.getProject('project-a').activity.map((item) => item.id)).toEqual([
      'activity-1',
    ]);
    expect(reloaded.getProject('project-b').proposals).toEqual([]);
  });

  it('migrates an old dismissed proposal to a visible rejected decision', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      CLOSEOUT_SESSION_KEY,
      JSON.stringify({
        version: 1,
        projects: {
          'project-a': {
            phase: 'needs-attention',
            proposals: [
              {
                kind: 'photo-link',
                id: 'legacy-proposal',
                projectId: 'project-a',
                createdAt: '2026-08-26T16:00:00.000Z',
                status: 'dismissed',
                selected: true,
                reason: 'Old skipped suggestion',
                punchItemId: 'punch-1',
                photoId: 'photo-1',
                expectedPunchUpdatedAt: '2026-08-26T15:00:00.000Z',
                expectedPhotoSha256: 'a'.repeat(64),
              },
            ],
            activity: [],
          },
        },
      }),
    );

    const proposal = createCloseoutSessionStore(storage).getProject('project-a').proposals[0];

    expect(proposal).toMatchObject({
      status: 'rejected',
      selected: false,
      dismissed: false,
      sourceFingerprint: '',
    });
    expect(storage.getItem(CLOSEOUT_SESSION_KEY)).not.toContain('expectedPhotoSha256');
  });

  it('stores the current phase, verification, and audit', () => {
    const store = createCloseoutSessionStore(new MemoryStorage());
    const sealCheck: SealVerification = {
      projectId: 'project-a',
      checkedAt: '2026-08-26T16:00:00.000Z',
      photoFingerprint: 'photo-fingerprint',
      results: [],
      summary: { pass: 0, fail: 0, unreadable: 0, excluded: 0 },
    };
    const closeoutAudit: CloseoutAudit = {
      projectId: 'project-a',
      checkedAt: '2026-08-26T16:00:01.000Z',
      sourceFingerprint: 'source-fingerprint',
      photoFingerprint: 'photo-fingerprint',
      phase: 'ready',
      blockerCount: 0,
      warningCount: 0,
      findings: [],
      candidates: {},
      counts: { workdays: 0, photos: 0, punchItems: 1, dailyLogs: 0 },
      workdayFingerprints: {},
    };

    store.setPhase('project-a', 'checking');
    store.setVerification('project-a', sealCheck);
    store.setAudit('project-a', closeoutAudit);

    expect(store.getProject('project-a')).toEqual({
      phase: 'ready',
      verification: sealCheck,
      audit: closeoutAudit,
      proposals: [],
      activity: [],
    });
  });

  it('retains review steps and cancels a running review after reload', () => {
    const storage = new MemoryStorage();
    const first = createCloseoutSessionStore(storage);

    first.setPhase('project-a', 'checking');
    first.setReviewProgress('project-a', {
      runId: 'review-1',
      state: 'running',
      startedAt: '2026-08-26T16:00:00.000Z',
      photoCheck: 'complete',
      workItems: 'active',
      dailyRecords: 'pending',
    });

    const reloaded = createCloseoutSessionStore(storage);
    const session = reloaded.getProject('project-a');

    expect(session.phase).toBe('check-failed');
    expect(session.reviewProgress).toMatchObject({
      runId: 'review-1',
      state: 'cancelled',
      photoCheck: 'complete',
      workItems: 'active',
      dailyRecords: 'pending',
    });
  });

  it('keeps a completed photo step while an agent review awaits the audit', () => {
    const storage = new MemoryStorage();
    const first = createCloseoutSessionStore(storage);

    first.setReviewProgress('project-a', {
      runId: 'review-2',
      state: 'awaiting-audit',
      startedAt: '2026-08-26T16:00:00.000Z',
      photoCheck: 'complete',
      workItems: 'pending',
      dailyRecords: 'pending',
    });

    expect(createCloseoutSessionStore(storage).getProject('project-a').reviewProgress).toEqual({
      runId: 'review-2',
      state: 'awaiting-audit',
      startedAt: '2026-08-26T16:00:00.000Z',
      photoCheck: 'complete',
      workItems: 'pending',
      dailyRecords: 'pending',
    });
  });

  it('notifies same-document subscribers', () => {
    const store = createCloseoutSessionStore(new MemoryStorage());
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.addProposal('project-a', photoProposal('proposal-1'));
    unsubscribe();
    store.addProposal('project-a', photoProposal('proposal-2'));

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('caps each project at 20 proposals and 30 activity rows', () => {
    const store = createCloseoutSessionStore(new MemoryStorage());

    for (let index = 0; index < 25; index++) {
      store.addProposal('project-a', photoProposal(`proposal-${index}`));
    }
    for (let index = 0; index < 35; index++) {
      store.addActivity('project-a', activity(`activity-${index}`));
    }

    const session = store.getProject('project-a');
    expect(session.proposals).toHaveLength(20);
    expect(session.proposals[0]?.id).toBe('proposal-5');
    expect(session.activity).toHaveLength(30);
    expect(session.activity[0]?.id).toBe('activity-5');
  });

  it('clears one project without changing another', () => {
    const store = createCloseoutSessionStore(new MemoryStorage());
    store.addProposal('project-a', photoProposal('proposal-a'));
    store.addProposal('project-b', photoProposal('proposal-b', 'project-b'));

    store.clearProject('project-a');

    expect(store.getProject('project-a').proposals).toEqual([]);
    expect(store.getProject('project-b').proposals.map((item) => item.id)).toEqual([
      'proposal-b',
    ]);
  });

  it('rejects a proposal that names another project', () => {
    const store = createCloseoutSessionStore(new MemoryStorage());

    expect(() => store.addProposal('project-a', photoProposal('proposal-1', 'project-b'))).toThrow();
  });

  it('provides a React external-store snapshot', () => {
    const store = createCloseoutSessionStore(new MemoryStorage());

    function Reader() {
      const session = useProjectCloseoutSession('project-a', store);
      return createElement('span', null, session.phase);
    }

    expect(renderToStaticMarkup(createElement(Reader))).toBe('<span>not-checked</span>');
  });
});
