import 'fake-indexeddb/auto';
import { strToU8 } from 'fflate';
import { beforeEach, describe, expect, it } from 'vitest';
import { attachPhoto, createPunchItem, markDone } from '../domain/punch.ts';
import type { Photo, Project } from '../domain/types.ts';
import { DEMO_PROJECT_ID } from '../demo/manifest.ts';
import { loadDemoProject } from '../demo/seed.ts';
import { db } from './db.ts';
import {
  addProject,
  createDailyLogIfAbsent,
  getPhoto,
  getPhotoBytes,
  getPunchItem,
  readCloseoutSnapshot,
  savePunchItem,
  sealCapture,
  upsertDailyLog,
  voidPhoto,
} from './repo.ts';
import { createCloseoutSessionStore, type StorageLike } from './closeoutSession.ts';
import {
  CloseoutServiceError,
  createCloseoutService,
  type CloseoutRepository,
} from './closeoutService.ts';

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

async function reset() {
  await Promise.all([
    db.projects.clear(),
    db.photos.clear(),
    db.photoBlobs.clear(),
    db.punchItems.clear(),
    db.dailyLogs.clear(),
    db.meta.clear(),
  ]);
}

function service() {
  const sessions = createCloseoutSessionStore(new MemoryStorage());
  return {
    sessions,
    closeout: createCloseoutService({
      repository: {
        readCloseoutSnapshot,
        getPhotoBytes,
        getPunchItem,
        getPhoto,
        savePunchItem,
        createDailyLogIfAbsent,
      },
      sessions,
      now: () => '2026-08-26T16:00:00.000Z',
    }),
  };
}

const JPEG = strToU8('\xff\xd8\xff closeout jpeg');

function demoImageLoader() {
  return async (assetPath: string) => {
    const number = Number(assetPath.match(/p(\d{2})\.jpg$/)?.[1] ?? 0);
    return new Uint8Array([0xff, 0xd8, number, number ^ 0xff, 0xff, 0xd9]);
  };
}

describe('closeout seal verification', () => {
  beforeEach(reset);

  it('verifies pass, fail, unreadable, and excluded photos', async () => {
    const project = await addProject('Seal states');
    const passed = await sealCapture({ projectId: project.id, bytes: JPEG, width: 20, height: 20 });
    const failed = await sealCapture({ projectId: project.id, bytes: JPEG, width: 20, height: 20 });
    const unreadable = await sealCapture({ projectId: project.id, bytes: JPEG, width: 20, height: 20 });
    const excluded = await sealCapture({ projectId: project.id, bytes: JPEG, width: 20, height: 20 });
    await db.photoBlobs.put({
      id: failed.id,
      bytes: new Blob([strToU8('changed bytes')], { type: 'image/jpeg' }),
    });
    await db.photoBlobs.delete(unreadable.id);
    await voidPhoto(excluded.id, 'Duplicate capture');
    const { closeout, sessions } = service();

    const result = await closeout.verifyProjectSeals(project.id);

    expect(result.summary).toEqual({ pass: 1, fail: 1, unreadable: 1, excluded: 1 });
    expect(result.results).toEqual(
      expect.arrayContaining([
        { photoId: passed.id, status: 'pass' },
        { photoId: failed.id, status: 'fail' },
        { photoId: unreadable.id, status: 'unreadable' },
        { photoId: excluded.id, status: 'excluded' },
      ]),
    );
    expect(sessions.getProject(project.id).verification).toEqual(result);
  });
});

describe('closeout audit service', () => {
  beforeEach(reset);

  it('verifies and audits one project snapshot for a manual check', async () => {
    const project = await addProject('Ready job');
    const proof = await sealCapture({
      projectId: project.id,
      bytes: JPEG,
      width: 20,
      height: 20,
      lat: 45.2,
      lon: -122.7,
      caption: 'Finished cabinet face.',
    });
    const done = markDone(createPunchItem(project.id, 'Install cabinet face'));
    await savePunchItem(attachPhoto(done, proof.id));
    await upsertDailyLog(project.id, proof.capturedAt.slice(0, 10), 'Installed cabinet face.');
    const { closeout, sessions } = service();

    const result = await closeout.runCloseoutCheck(project.id);

    expect(result.phase).toBe('ready');
    expect(sessions.getProject(project.id).phase).toBe('ready');
    expect(sessions.getProject(project.id).audit).toEqual(result);
    expect(sessions.getProject(project.id).reviewProgress).toMatchObject({
      state: 'complete',
      photoCheck: 'complete',
      workItems: 'complete',
      dailyRecords: 'complete',
    });
  });

  it('returns the exact first Maple Street review with dated findings and counts', async () => {
    await loadDemoProject({ loadAsset: demoImageLoader() });
    const { closeout, sessions } = service();

    const result = await closeout.runCloseoutCheck(DEMO_PROJECT_ID);

    expect(result.phase).toBe('needs-attention');
    expect(result.blockerCount).toBe(2);
    expect(result.warningCount).toBe(1);
    expect(result.counts).toEqual({ workdays: 3, photos: 18, punchItems: 10, dailyLogs: 2 });
    expect(result.candidates.msk25w08?.[0]?.photoId).toBe('msk25p13');
    expect(result.candidates.msk25w10?.[0]?.photoId).toBe('msk25p17');
    expect(result.dailyLogContexts).toEqual([
      expect.objectContaining({
        logDate: '2025-05-15',
        workItems: expect.arrayContaining([
          expect.objectContaining({ id: 'msk25w08' }),
          expect.objectContaining({ id: 'msk25w09' }),
          expect.objectContaining({ id: 'msk25w10' }),
        ]),
        photos: expect.arrayContaining([
          expect.objectContaining({ id: 'msk25p13' }),
          expect.objectContaining({ id: 'msk25p17' }),
        ]),
      }),
    ]);
    expect(result.findings.map((finding) => finding.workdayDate)).toEqual([
      '2025-05-15',
      '2025-05-15',
      '2025-05-15',
    ]);
    expect(sessions.getProject(DEMO_PROJECT_ID).reviewProgress?.state).toBe('complete');
  });

  it('requires a current verification before an audit', async () => {
    const project = await addProject('Changing job');
    const { closeout } = service();

    await expect(closeout.auditProjectCloseout(project.id)).rejects.toMatchObject({
      code: 'verification-required',
    });

    await closeout.verifyProjectSeals(project.id);
    await sealCapture({ projectId: project.id, bytes: JPEG, width: 20, height: 20 });

    await expect(closeout.auditProjectCloseout(project.id)).rejects.toBeInstanceOf(
      CloseoutServiceError,
    );
    await expect(closeout.auditProjectCloseout(project.id)).rejects.toMatchObject({
      code: 'verification-required',
    });
  });
});

describe('closeout cancellation', () => {
  it('rejects a second review while the first one is active', async () => {
    const controller = new AbortController();
    const project: Project = {
      id: 'project-overlap',
      name: 'Overlap job',
      status: 'active',
      createdAt: '2026-08-26T15:00:00.000Z',
      updatedAt: '2026-08-26T15:00:00.000Z',
    };
    const photo: Photo = {
      id: 'photo-overlap',
      projectId: project.id,
      capturedAt: '2026-08-26T15:00:00.000Z',
      sha256: 'a'.repeat(64),
      width: 20,
      height: 20,
      size: JPEG.byteLength,
    };
    let releaseRead: ((blob: Blob) => void) | undefined;
    let markReadStarted: (() => void) | undefined;
    const readStarted = new Promise<void>((resolve) => {
      markReadStarted = resolve;
    });
    const repository: CloseoutRepository = {
      readCloseoutSnapshot: async () => ({ project, photos: [photo], punchItems: [], dailyLogs: [] }),
      getPhotoBytes: async () => {
        markReadStarted?.();
        return new Promise<Blob>((resolve) => {
          releaseRead = resolve;
        });
      },
      getPunchItem: async () => undefined,
      getPhoto: async () => undefined,
      savePunchItem: async () => undefined,
      createDailyLogIfAbsent: async () => null,
    };
    const sessions = createCloseoutSessionStore(new MemoryStorage());
    const closeout = createCloseoutService({ repository, sessions });

    const first = closeout.runCloseoutCheck(project.id, controller.signal);
    await readStarted;

    await expect(closeout.runCloseoutCheck(project.id)).rejects.toMatchObject({
      code: 'review-in-progress',
    });

    controller.abort();
    releaseRead?.(new Blob([JPEG], { type: 'image/jpeg' }));
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    expect(sessions.getProject(project.id).phase).toBe('check-failed');
    expect(sessions.getProject(project.id).audit).toBeUndefined();
    expect(sessions.getProject(project.id).reviewProgress).toMatchObject({
      state: 'cancelled',
      photoCheck: 'active',
      workItems: 'pending',
      dailyRecords: 'pending',
    });
  });

  it('cancels between photo reads and records a failed check', async () => {
    const controller = new AbortController();
    const project: Project = {
      id: 'project-cancel',
      name: 'Cancel job',
      status: 'active',
      createdAt: '2026-08-26T15:00:00.000Z',
      updatedAt: '2026-08-26T15:00:00.000Z',
    };
    const photos: Photo[] = ['photo-1', 'photo-2'].map((id) => ({
      id,
      projectId: project.id,
      capturedAt: '2026-08-26T15:00:00.000Z',
      sha256: 'a'.repeat(64),
      width: 20,
      height: 20,
      size: JPEG.byteLength,
    }));
    let reads = 0;
    const repository: CloseoutRepository = {
      readCloseoutSnapshot: async () => ({ project, photos, punchItems: [], dailyLogs: [] }),
      getPhotoBytes: async () => {
        reads++;
        controller.abort();
        return new Blob([JPEG], { type: 'image/jpeg' });
      },
      getPunchItem: async () => undefined,
      getPhoto: async () => undefined,
      savePunchItem: async () => undefined,
      createDailyLogIfAbsent: async () => null,
    };
    const sessions = createCloseoutSessionStore(new MemoryStorage());
    const closeout = createCloseoutService({ repository, sessions });

    await expect(closeout.verifyProjectSeals(project.id, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(reads).toBe(1);
    expect(sessions.getProject(project.id).phase).toBe('check-failed');
    expect(sessions.getProject(project.id).reviewProgress?.state).toBe('cancelled');
  });
});

describe('closeout proposals', () => {
  beforeEach(reset);

  function selectProposal(
    sessions: ReturnType<typeof service>['sessions'],
    projectId: string,
    proposalId: string,
  ) {
    sessions.updateProposal(projectId, proposalId, (proposal) => ({
      ...proposal,
      selected: true,
    }));
  }

  async function repairableProject() {
    const project = await addProject('Repairable job');
    const proof = await sealCapture({
      projectId: project.id,
      bytes: JPEG,
      width: 20,
      height: 20,
      lat: 45.2,
      lon: -122.7,
      caption: 'Finished cabinet face.',
    });
    const workday = proof.capturedAt.slice(0, 10);
    const done = markDone(
      createPunchItem(project.id, 'Install cabinet face', `${workday}T14:00:00.000Z`),
      `${workday}T15:00:00.000Z`,
    );
    await savePunchItem(done);
    const instance = service();
    await instance.closeout.verifyProjectSeals(project.id);
    return { ...instance, project, proof, done };
  }

  it('saves the three Maple Street updates only after review and clears the next check', async () => {
    await loadDemoProject({ loadAsset: demoImageLoader() });
    const { closeout, sessions } = service();
    const editedDailyRecord =
      'Installed cabinet fronts and hardware, adjusted the doors and drawers, and completed the final cleanup and walk-through.';

    const firstReview = await closeout.runCloseoutCheck(DEMO_PROJECT_ID);
    expect(firstReview).toMatchObject({ phase: 'needs-attention', blockerCount: 2, warningCount: 1 });

    const frontsPhoto = await closeout.stagePhotoLink(DEMO_PROJECT_ID, {
      punchItemId: 'msk25w08',
      photoId: 'msk25p13',
      reason: 'The photo was taken just before this work item was marked done.',
    });
    const cleanupPhoto = await closeout.stagePhotoLink(DEMO_PROJECT_ID, {
      punchItemId: 'msk25w10',
      photoId: 'msk25p17',
      reason: 'The photo shows the cleaned work area before the final walk-through.',
    });
    const dailyRecord = await closeout.stageDailyLog(DEMO_PROJECT_ID, {
      logDate: '2025-05-15',
      body: 'Draft daily record.',
      sourcePhotoIds: ['msk25p13', 'msk25p14', 'msk25p17'],
      sourceWorkItemIds: ['msk25w08', 'msk25w09', 'msk25w10'],
      reason: 'The workday has completed work and photos but no daily record.',
    });

    expect(sessions.getProject(DEMO_PROJECT_ID).proposals).toEqual([
      expect.objectContaining({ id: frontsPhoto.id, selected: false, status: 'pending' }),
      expect.objectContaining({ id: cleanupPhoto.id, selected: false, status: 'pending' }),
      expect.objectContaining({ id: dailyRecord.id, selected: false, status: 'pending' }),
    ]);
    expect((await db.punchItems.get('msk25w08'))?.photoIds).toEqual([]);
    expect((await db.punchItems.get('msk25w10'))?.photoIds).toEqual([]);
    expect(
      await db.dailyLogs.where({ projectId: DEMO_PROJECT_ID, logDate: '2025-05-15' }).first(),
    ).toBeUndefined();

    closeout.updateDailyLogDraft(DEMO_PROJECT_ID, dailyRecord.id, editedDailyRecord);
    closeout.setProposalSelected(DEMO_PROJECT_ID, frontsPhoto.id, true);
    closeout.setProposalSelected(DEMO_PROJECT_ID, cleanupPhoto.id, true);
    closeout.setProposalSelected(DEMO_PROJECT_ID, dailyRecord.id, true);

    const results = await closeout.applySelectedProposals(DEMO_PROJECT_ID);

    expect(results).toEqual([
      expect.objectContaining({ proposalId: frontsPhoto.id, status: 'applied' }),
      expect.objectContaining({ proposalId: cleanupPhoto.id, status: 'applied' }),
      expect.objectContaining({ proposalId: dailyRecord.id, status: 'applied' }),
    ]);
    expect((await db.punchItems.get('msk25w08'))?.photoIds).toEqual(['msk25p13']);
    expect((await db.punchItems.get('msk25w10'))?.photoIds).toEqual(['msk25p17']);
    expect(
      await db.dailyLogs.where({ projectId: DEMO_PROJECT_ID, logDate: '2025-05-15' }).first(),
    ).toMatchObject({ body: editedDailyRecord });
    expect(sessions.getProject(DEMO_PROJECT_ID).phase).toBe('check-again');

    const freshReview = await closeout.runCloseoutCheck(DEMO_PROJECT_ID);

    expect(freshReview).toMatchObject({
      phase: 'ready',
      blockerCount: 0,
      warningCount: 0,
      findings: [],
    });
  });

  it('stages photo and log proposals without changing job records', async () => {
    const { closeout, sessions, project, proof, done } = await repairableProject();

    const photoLink = await closeout.stagePhotoLink(project.id, {
      punchItemId: done.id,
      photoId: proof.id,
      reason: 'Closest verified photo to completion time.',
    });
    const dailyLog = await closeout.stageDailyLog(project.id, {
      logDate: proof.capturedAt.slice(0, 10),
      body: 'Installed and photographed the cabinet face.',
      sourcePhotoIds: [proof.id],
      sourceWorkItemIds: [done.id],
      reason: 'Photos exist for this date without a log.',
    });

    expect(photoLink).toMatchObject({
      kind: 'photo-link',
      selected: false,
      dismissed: false,
      punchItemLabel: 'Install cabinet face',
      workdayDate: proof.capturedAt.slice(0, 10),
    });
    expect(photoLink.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(dailyLog).toMatchObject({
      kind: 'daily-log',
      selected: false,
      dismissed: false,
      sourcePhotoIds: [proof.id],
      sourceWorkItemIds: [done.id],
    });
    expect(dailyLog.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect((await db.punchItems.get(done.id))?.photoIds).toEqual([]);
    expect(await db.dailyLogs.where({ projectId: project.id }).count()).toBe(0);
    expect(sessions.getProject(project.id).proposals).toHaveLength(2);
    await expect(closeout.applySelectedProposals(project.id)).resolves.toEqual([]);
  });

  it('replaces a photo candidate without changing the work item', async () => {
    const { closeout, sessions, project, proof, done } = await repairableProject();
    const alternate = await sealCapture({
      projectId: project.id,
      bytes: strToU8('\xff\xd8\xff alternate jpeg'),
      width: 20,
      height: 20,
      lat: 45.2,
      lon: -122.7,
      caption: 'Alternate finished cabinet view.',
    });
    await closeout.verifyProjectSeals(project.id);
    const proposal = await closeout.stagePhotoLink(project.id, {
      punchItemId: done.id,
      photoId: proof.id,
      reason: 'Possible proof photo.',
    });

    const replaced = await closeout.replacePhotoCandidate(project.id, proposal.id, alternate.id);

    expect(replaced).toMatchObject({
      photoId: alternate.id,
      selected: false,
      status: 'pending',
    });
    expect(replaced.sourceFingerprint).not.toBe(proposal.sourceFingerprint);
    expect((await db.punchItems.get(done.id))?.photoIds).toEqual([]);

    selectProposal(sessions, project.id, proposal.id);
    await closeout.applySelectedProposals(project.id);
    expect((await db.punchItems.get(done.id))?.photoIds).toEqual([alternate.id]);
  });

  it('edits a daily-record draft, then saves the edited text only after selection', async () => {
    const { closeout, sessions, project, proof, done } = await repairableProject();
    const proposal = await closeout.stageDailyLog(project.id, {
      logDate: proof.capturedAt.slice(0, 10),
      body: 'First draft.',
      sourcePhotoIds: [proof.id],
      sourceWorkItemIds: [done.id],
      reason: 'Missing daily record.',
    });

    const edited = closeout.updateDailyLogDraft(
      project.id,
      proposal.id,
      'Installed and photographed the cabinet face. The foreperson reviewed this wording.',
    );

    expect(edited).toMatchObject({
      body: 'Installed and photographed the cabinet face. The foreperson reviewed this wording.',
      selected: false,
    });
    expect(await db.dailyLogs.where({ projectId: project.id }).count()).toBe(0);

    selectProposal(sessions, project.id, proposal.id);
    await closeout.applySelectedProposals(project.id);
    expect((await db.dailyLogs.where({ projectId: project.id }).first())?.body).toBe(
      'Installed and photographed the cabinet face. The foreperson reviewed this wording.',
    );
  });

  it('rejects a pending suggestion and dismisses only settled cards', async () => {
    const { closeout, project, proof, done } = await repairableProject();
    const proposal = await closeout.stagePhotoLink(project.id, {
      punchItemId: done.id,
      photoId: proof.id,
      reason: 'Possible proof photo.',
    });

    expect(() => closeout.dismissProposal(project.id, proposal.id)).toThrow(
      'Only settled suggestions can be dismissed.',
    );

    const rejected = closeout.rejectProposal(project.id, proposal.id);
    const dismissed = closeout.dismissProposal(project.id, proposal.id);

    expect(rejected).toMatchObject({ status: 'rejected', selected: false, dismissed: false });
    expect(dismissed).toMatchObject({ status: 'rejected', dismissed: true });
    expect((await db.punchItems.get(done.id))?.photoIds).toEqual([]);
  });

  it('checks cited daily-record sources against the requested workday', async () => {
    const { closeout, project, proof } = await repairableProject();
    const otherDay = markDone(
      createPunchItem(project.id, 'Earlier work', '2026-08-25T14:00:00.000Z'),
      '2026-08-25T15:00:00.000Z',
    );
    await savePunchItem(otherDay);

    await expect(
      closeout.stageDailyLog(project.id, {
        logDate: proof.capturedAt.slice(0, 10),
        body: 'Draft.',
        sourceWorkItemIds: [otherDay.id],
        reason: 'Missing daily record.',
      }),
    ).rejects.toMatchObject({ code: 'record-not-eligible' });
  });

  it('marks only the suggestion whose scoped source changed as stale', async () => {
    const { closeout, sessions, project, proof, done } = await repairableProject();
    const photoLink = await closeout.stagePhotoLink(project.id, {
      punchItemId: done.id,
      photoId: proof.id,
      reason: 'Possible proof photo.',
    });
    const dailyLog = await closeout.stageDailyLog(project.id, {
      logDate: proof.capturedAt.slice(0, 10),
      body: 'Daily record draft.',
      sourcePhotoIds: [proof.id],
      reason: 'Missing daily record.',
    });
    await savePunchItem({
      ...done,
      text: 'Install and align cabinet face',
      updatedAt: '2026-08-26T17:00:00.000Z',
    });
    selectProposal(sessions, project.id, photoLink.id);
    selectProposal(sessions, project.id, dailyLog.id);

    const results = await closeout.applySelectedProposals(project.id);

    expect(results).toEqual([
      expect.objectContaining({ proposalId: photoLink.id, status: 'stale' }),
      expect.objectContaining({ proposalId: dailyLog.id, status: 'applied' }),
    ]);
  });

  it('marks a photo-link proposal stale after the punch changes', async () => {
    const { closeout, sessions, project, proof, done } = await repairableProject();
    const proposal = await closeout.stagePhotoLink(project.id, {
      punchItemId: done.id,
      photoId: proof.id,
      reason: 'Verified closeout candidate.',
    });
    await savePunchItem({
      ...done,
      text: 'Install and adjust cabinet face',
      updatedAt: '2026-08-26T17:00:00.000Z',
    });
    selectProposal(sessions, project.id, proposal.id);

    const results = await closeout.applySelectedProposals(project.id);

    expect(results).toEqual([
      expect.objectContaining({ proposalId: proposal.id, status: 'stale' }),
    ]);
    expect((await db.punchItems.get(done.id))?.photoIds).toEqual([]);
    expect(sessions.getProject(project.id).proposals[0]).toMatchObject({
      status: 'stale',
      selected: false,
    });
  });

  it('applies current proposals independently and never replaces an existing log', async () => {
    const { closeout, sessions, project, proof, done } = await repairableProject();
    const photoLink = await closeout.stagePhotoLink(project.id, {
      punchItemId: done.id,
      photoId: proof.id,
      reason: 'Verified closeout candidate.',
    });
    const dailyLog = await closeout.stageDailyLog(project.id, {
      logDate: proof.capturedAt.slice(0, 10),
      body: 'Agent draft that must not replace later human text.',
      sourcePhotoIds: [proof.id],
      reason: 'Missing daily log.',
    });
    await upsertDailyLog(project.id, proof.capturedAt.slice(0, 10), 'Human log entered later.');
    selectProposal(sessions, project.id, photoLink.id);
    selectProposal(sessions, project.id, dailyLog.id);

    const results = await closeout.applySelectedProposals(project.id);

    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ proposalId: photoLink.id, status: 'applied' }),
        expect.objectContaining({ proposalId: dailyLog.id, status: 'stale' }),
      ]),
    );
    expect((await db.punchItems.get(done.id))?.photoIds).toEqual([proof.id]);
    expect((await db.dailyLogs.where({ projectId: project.id }).first())?.body).toBe(
      'Human log entered later.',
    );
    expect(sessions.getProject(project.id).phase).toBe('check-again');
  });

  it('rejects a daily-log proposal when that date already has a log', async () => {
    const { closeout, project, proof } = await repairableProject();
    await upsertDailyLog(project.id, proof.capturedAt.slice(0, 10), 'Human log.');

    await expect(
      closeout.stageDailyLog(project.id, {
        logDate: proof.capturedAt.slice(0, 10),
        body: 'Agent draft.',
        sourcePhotoIds: [proof.id],
        reason: 'Missing daily log.',
      }),
    ).rejects.toMatchObject({ code: 'record-not-eligible' });
  });
});
