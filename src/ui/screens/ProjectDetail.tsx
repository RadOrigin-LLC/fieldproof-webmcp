import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { closeoutSourceFingerprint, type CloseoutFinding } from '../../domain/closeout.ts';
import type { DailyLog, Photo, PunchItem } from '../../domain/types.ts';
import { buildWorkdays, workdaySourceFingerprints, type WorkdayFilter } from '../../domain/workdays.ts';
import { activityDates, localDateOf } from '../../domain/reports.ts';
import { createPunchItem, markDone, punchProgress, reopen, sortPunch } from '../../domain/punch.ts';
import {
  archiveProject,
  deleteProject,
  deletePunchItem,
  savePunchItem,
  updateProject,
  upsertDailyLog,
} from '../../data/repo.ts';
import { closeoutService, closeoutSessions } from '../../data/closeoutClient.ts';
import { useProjectCloseoutSession } from '../../data/closeoutSession.ts';
import {
  useDailyLogs,
  usePhotos,
  useProject,
  usePunch,
} from '../../data/useLive.ts';
import { isAiConfigured } from '../../ai/gemini.ts';
import { draftDailyLog } from '../../ai/logdraft.ts';
import { Sheet } from '../Sheet.tsx';
import { startsHandoffReview } from '../handoffLabels.ts';
import { parseProjectQuery, patchProjectQuery, type ProjectQueryAction } from '../projectQuery.ts';
import { PunchEvidenceSheet } from '../PunchEvidenceSheet.tsx';
import { PhotoDetail } from '../PhotoDetail.tsx';
import { ProjectNotFound } from '../ProjectNotFound.tsx';
import { WorkdayDetail } from '../WorkdayDetail.tsx';
import { usePhotoUrl } from '../usePhotoUrl.ts';
import { IconCapture, IconPlus, IconPrint } from '../icons.tsx';
import { createReadOnlyProjectTools, registerProjectTools } from '../../webmcp/projectTools.ts';
import { Closeout } from './Closeout.tsx';
import { WorkdayLedger } from './WorkdayLedger.tsx';

function useReviewSheet(): boolean {
  const [matches, setMatches] = useState(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(max-width: 1099px)').matches,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(max-width: 1099px)');
    const update = () => setMatches(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return matches;
}

export function ProjectDetail() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const query = parseProjectQuery(searchParams);
  const project = useProject(projectId);
  const photos = usePhotos(projectId);
  const punch = usePunch(projectId);
  const logs = useDailyLogs(projectId);
  const session = useProjectCloseoutSession(projectId ?? '', closeoutSessions);
  const reviewSheet = useReviewSheet();
  const [filter, setFilter] = useState<WorkdayFilter>('all');
  const [editOpen, setEditOpen] = useState(false);
  const [fingerprintResult, setFingerprintResult] = useState<{
    photos: Photo[];
    punch: PunchItem[];
    logs: DailyLog[];
    values: Record<string, string>;
  }>();
  const navigationRef = useRef<{
    openReview: () => void;
    openPacket: () => void;
  }>({
    openReview: () => undefined,
    openPacket: () => undefined,
  });

  const setQuery = (action: ProjectQueryAction, replace = false) => {
    setSearchParams(patchProjectQuery(searchParams, action), { replace });
  };

  navigationRef.current = {
    openReview: () => setQuery({ kind: 'open-review' }),
    openPacket: () => {
      if (project?.id) navigate(`/packet/${project.id}`);
    },
  };

  useEffect(() => {
    if (!photos || !punch || !logs) return;
    let current = true;
    void workdaySourceFingerprints({ photos, punchItems: punch, dailyLogs: logs }).then(
      (values) => {
        if (current) setFingerprintResult({ photos, punch, logs, values });
      },
      () => {
        if (!current) return;
        setFingerprintResult({ photos, punch, logs, values: {} });
        if (session.audit && projectId) closeoutSessions.setPhase(projectId, 'check-again');
      },
    );
    return () => {
      current = false;
    };
  }, [logs, photos, projectId, punch, session.audit]);

  useEffect(() => {
    if (
      !project ||
      !photos ||
      !punch ||
      !logs ||
      !session.audit ||
      session.phase === 'checking' ||
      session.phase === 'check-again'
    ) {
      return;
    }
    let current = true;
    void closeoutSourceFingerprint({ project, photos, punchItems: punch, dailyLogs: logs }).then(
      (value) => {
        if (current && value !== session.audit?.sourceFingerprint) {
          closeoutSessions.setPhase(project.id, 'check-again');
        }
      },
    );
    return () => {
      current = false;
    };
  }, [logs, photos, project, punch, session.audit, session.phase]);

  useEffect(() => {
    if (!project?.id) return;
    const routeController = new AbortController();
    const tools = createReadOnlyProjectTools({
      projectId: project.id,
      projectName: project.name,
      service: closeoutService,
      sessions: closeoutSessions,
      routeSignal: routeController.signal,
      openCloseout: () => navigationRef.current.openReview(),
      openPacket: () => navigationRef.current.openPacket(),
    });
    const registration = registerProjectTools({
      modelContext: typeof document === 'undefined' ? undefined : document.modelContext,
      tools,
    });
    void registration.ready.catch(() => undefined);

    return () => {
      routeController.abort();
      closeoutService.cancelProjectReview(project.id);
      registration.dispose();
    };
  }, [project?.id, project?.name]);

  const recordsReady = photos !== undefined && punch !== undefined && logs !== undefined;
  const fingerprintsReady = Boolean(
    fingerprintResult &&
      fingerprintResult.photos === photos &&
      fingerprintResult.punch === punch &&
      fingerprintResult.logs === logs,
  );
  const ledgerLoading = !recordsReady || Boolean(session.audit && !fingerprintsReady);
  const workdays = useMemo(() => {
    if (!photos || !punch || !logs) return [];
    return buildWorkdays({
      photos,
      punchItems: punch,
      dailyLogs: logs,
      phase: session.phase,
      audit: session.audit,
      proposals: session.proposals,
      currentFingerprints: fingerprintsReady ? (fingerprintResult?.values ?? {}) : {},
    });
  }, [fingerprintResult, fingerprintsReady, logs, photos, punch, session]);
  const selectedWorkday = query.day
    ? workdays.find((workday) => workday.dateKey === query.day)
    : undefined;

  if (project === undefined) return null;
  if (project === null) return <ProjectNotFound />;

  const closeReview = () => setQuery({ kind: 'close-review' }, true);
  const reviewContent = (
    <Closeout
      project={project}
      photos={photos ?? []}
      punchItems={punch ?? []}
      onOpenFinding={(finding: CloseoutFinding) => {
        if (finding.workdayDate) {
          setQuery({ kind: 'open-day', day: finding.workdayDate, focus: finding.id });
        } else if (finding.entityType === 'punch' || finding.code === 'empty-project') {
          setQuery({ kind: 'open-view', view: 'work-items' });
        } else if (finding.entityType === 'photo') {
          setQuery({ kind: 'open-view', view: 'photos' });
        } else if (finding.entityType === 'daily-log') {
          setQuery({ kind: 'open-view', view: 'daily-records' });
        }
      }}
      onOpenPacket={() => navigate(`/packet/${project.id}`)}
    />
  );

  return (
    <div className={`project-page-layout${query.review ? ' review-open' : ''}`}>
      <main className="project-page-main">
        {query.view === 'ledger' ? (
          <WorkdayLedger
            project={project}
            workdays={workdays}
            photos={photos ?? []}
            phase={session.phase}
            checkedAt={session.audit?.checkedAt}
            filter={filter}
            loading={ledgerLoading}
            onFilterChange={setFilter}
            onOpenWorkday={(day) => setQuery({ kind: 'open-day', day })}
            onOpenReview={() => {
              setQuery({ kind: 'open-review' });
              if (startsHandoffReview(session.phase)) {
                void closeoutService.runCloseoutCheck(project.id).catch(() => undefined);
              }
            }}
            onOpenPacket={() => navigate(`/packet/${project.id}`)}
            onOpenView={(view) => setQuery({ kind: 'open-view', view })}
            onEditProject={() => setEditOpen(true)}
            onTakePhoto={() => navigate(`/capture/${project.id}`)}
          />
        ) : (
          <section className="project-secondary-view">
            <header className="screen-head">
              <div>
                <span className="section-label">{project.name}</span>
                <h1 className="screen-title">
                  {query.view === 'photos'
                    ? 'Photos'
                    : query.view === 'work-items'
                      ? 'Work items'
                      : query.view === 'daily-records'
                        ? 'Daily records'
                        : 'Reports'}
                </h1>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setQuery({ kind: 'close-view' }, true)}
              >
                Back to Workday Ledger
              </button>
            </header>
            {query.view === 'photos' ? (
              <PhotoGrid
                photos={photos ?? []}
                projectId={project.id}
                projectName={project.name}
                items={punch ?? []}
              />
            ) : null}
            {query.view === 'work-items' ? (
              <PunchList
                projectId={project.id}
                projectName={project.name}
                items={punch ?? []}
                photos={photos ?? []}
              />
            ) : null}
            {query.view === 'daily-records' ? <DailyLogPanel projectId={project.id} photos={photos ?? []} /> : null}
            {query.view === 'reports' ? <ReportsPanel projectId={project.id} photos={photos ?? []} logs={logs ?? []} /> : null}
          </section>
        )}
      </main>

      {query.review && reviewSheet ? (
        <Sheet
          title="Handoff Review"
          fullHeightOnMobile
          returnFocusId="handoff-review-toggle"
          onClose={closeReview}
        >
          {reviewContent}
        </Sheet>
      ) : null}

      {query.review && !reviewSheet ? (
        <aside className="handoff-review-rail" aria-label="Handoff Review">
          <button
            type="button"
            className="btn btn-quiet handoff-review-close"
            aria-label="Close Handoff Review"
            onClick={closeReview}
          >
            Close
          </button>
          {reviewContent}
        </aside>
      ) : null}

      {query.day && selectedWorkday ? (
        <WorkdayDetail
          projectId={project.id}
          projectName={project.name}
          workday={selectedWorkday}
          photos={photos ?? []}
          focusId={query.focus}
          returnFocusId={`workday-${query.day}-open`}
          onClose={() => setQuery({ kind: 'close-day' }, true)}
        />
      ) : null}

      {editOpen && (
        <EditProject
          id={project.id}
          name={project.name}
          client={project.client}
          address={project.address}
          startDate={project.startDate}
          onClose={() => setEditOpen(false)}
          onGone={() => navigate('/')}
        />
      )}
    </div>
  );
}

/* ---------- photos ---------- */

function PhotoGrid({
  photos,
  projectId,
  projectName,
  items,
}: {
  photos: Photo[];
  projectId: string;
  projectName: string;
  items: PunchItem[];
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = photos.find((photo) => photo.id === openId);

  if (photos.length === 0) {
    return (
      <div className="empty-state">
        <p>No job photos yet.</p>
        <Link to={`/capture/${projectId}`} className="btn btn-capture">
          <IconCapture /> Take the first photo
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="photo-grid">
        {photos.map((p) => (
          <PhotoCard key={p.id} photo={p} onOpen={() => setOpenId(p.id)} />
        ))}
      </div>
      {open ? (
        <PhotoDetail
          photo={open}
          projectName={projectName}
          workdayDate={open.capturedAt.slice(0, 10)}
          linkedItems={items.filter((item) => item.photoIds.includes(open.id))}
          projectItems={items}
          returnFocusId={`photo-${open.id}-open`}
          onClose={() => setOpenId(null)}
        />
      ) : null}
    </>
  );
}

function PhotoCard({ photo, onOpen }: { photo: Photo; onOpen: () => void }) {
  const url = usePhotoUrl(photo.id);
  return (
    <button
      id={`photo-${photo.id}-open`}
      type="button"
      className={`photo-card${photo.voidedAt ? ' voided' : ''}`}
      onClick={onOpen}
    >
      {url ? <img src={url} alt={photo.caption ?? 'Sealed photo'} /> : <div className="photo-ph" />}
      <div className="photo-card-meta">
        {photo.voidedAt && <span className="void-stamp">VOIDED</span>}
        <span className="meta-line">{new Date(photo.capturedAt).toLocaleString()}</span>
        {photo.caption && <span className="photo-caption">{photo.caption}</span>}
      </div>
    </button>
  );
}

/* ---------- punch list ---------- */

function PunchList({
  projectId,
  projectName,
  items,
  photos,
}: {
  projectId: string;
  projectName: string;
  items: PunchItem[];
  photos: Photo[];
}) {
  const [title, setTitle] = useState('');
  const [evidenceItemId, setEvidenceItemId] = useState<string | null>(null);
  const sorted = sortPunch(items);
  const prog = punchProgress(items);
  const evidenceItem = items.find((item) => item.id === evidenceItemId);

  async function add() {
    if (!title.trim()) return;
    await savePunchItem(createPunchItem(projectId, title));
    setTitle('');
  }

  return (
    <div>
      {items.length > 0 && (
        <p className="punch-progress num">
          {prog.done} of {prog.total} closed
        </p>
      )}
      <div className="punch-add">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void add();
          }}
          placeholder="Touch up paint in hallway"
          aria-label="New punch item"
        />
        <button type="button" className="btn btn-primary" onClick={() => void add()} aria-label="Add">
          <IconPlus />
        </button>
      </div>

      {sorted.map((item) => (
        <div key={item.id} className={`punch-row${item.status === 'done' ? ' done' : ''}`}>
          <button
            type="button"
            className="punch-check"
            aria-label={item.status === 'done' ? 'Reopen' : 'Mark done'}
            onClick={() => {
              void savePunchItem(item.status === 'done' ? reopen(item) : markDone(item));
            }}
          >
            ✓
          </button>
          <div style={{ flex: 1 }}>
            <p className="punch-title">{item.text}</p>
            {item.status === 'done' && item.doneAt && (
              <p className="punch-note num">Closed {new Date(item.doneAt).toLocaleDateString()}</p>
            )}
            {item.proofException && (
              <p className="punch-note">No-photo reason: {item.proofException.reason}</p>
            )}
          </div>
          {item.status === 'done' && (
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => setEvidenceItemId(item.id)}
            >
              Proof {item.photoIds.length}
            </button>
          )}
          <button
            type="button"
            className="btn btn-quiet"
            aria-label="Delete item"
            onClick={() => void deletePunchItem(item.id)}
          >
            ✕
          </button>
        </div>
      ))}
      {items.length === 0 && <p className="empty-sub">Add work that must be done before handoff.</p>}
      {evidenceItem && (
        <PunchEvidenceSheet
          item={evidenceItem}
          photos={photos}
          projectName={projectName}
          onClose={() => setEvidenceItemId(null)}
        />
      )}
    </div>
  );
}

/* ---------- daily log ---------- */

function DailyLogPanel({ projectId, photos }: { projectId: string; photos: Photo[] }) {
  const logs = useDailyLogs(projectId);
  const today = localDateOf(new Date().toISOString());
  const todayLog = (logs ?? []).find((l) => l.logDate === today);
  const [body, setBody] = useState<string | null>(null);
  const [aiReady, setAiReady] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState('');
  const value = body ?? todayLog?.body ?? '';

  useEffect(() => {
    void isAiConfigured().then(setAiReady);
  }, []);

  async function polish() {
    if (!value.trim()) return;
    setDrafting(true);
    setDraftError('');
    try {
      const captions = photos
        .filter((p) => !p.voidedAt && localDateOf(p.capturedAt) === today && p.caption)
        .map((p) => p.caption as string);
      setBody(await draftDailyLog(value, captions));
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : 'Draft failed.');
    } finally {
      setDrafting(false);
    }
  }

  return (
    <div>
      <div className="log-card" style={{ marginBottom: 16 }}>
        <span className="log-date num">{today} · today</span>
        <textarea
          className="log-editor"
          value={value}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Crew of 3. Framed the north wall, passed rough-in inspection…"
          rows={4}
        />
        {aiReady && value.trim() && (
          <div className="scan-row">
            <button
              type="button"
              className="btn btn-quiet"
              disabled={drafting}
              onClick={() => void polish()}
            >
              {drafting ? 'Drafting…' : 'Polish into a log entry'}
            </button>
            <p className="ai-note">AI rewrites your notes. Read the draft before you save it.</p>
            {draftError && <p className="form-error">{draftError}</p>}
          </div>
        )}
        <button
          type="button"
          className="btn btn-primary"
          disabled={body === null || body === (todayLog?.body ?? '')}
          onClick={() => {
            void upsertDailyLog(projectId, today, value).then(() => setBody(null));
          }}
        >
          Save today's log
        </button>
      </div>

      {(logs ?? [])
        .filter((l) => l.logDate !== today)
        .map((l) => (
          <div key={l.id} className="log-card" style={{ marginBottom: 10 }}>
            <span className="log-date num">{l.logDate}</span>
            <p className="log-body">{l.body}</p>
          </div>
        ))}
    </div>
  );
}

/* ---------- reports ---------- */

function ReportsPanel({
  projectId,
  photos,
  logs,
}: {
  projectId: string;
  photos: Photo[];
  logs: DailyLog[];
}) {
  const dates = useMemo(() => activityDates(photos, logs), [photos, logs]);

  return (
    <div>
      <div className="report-links">
        <Link to={`/packet/${projectId}`} className="btn btn-primary btn-block">
          <IconPrint /> Handoff packet · Full job record
        </Link>
      </div>
      <h2 className="section-title">Daily reports</h2>
      {dates.length === 0 && <p className="empty-sub">Days with job photos or a log will appear here.</p>}
      {dates.map((d) => (
        <Link key={d} to={`/report/${projectId}/${d}`} className="report-day-link num">
          {d}
        </Link>
      ))}
    </div>
  );
}

/* ---------- edit / archive ---------- */

function EditProject({
  id,
  name: initialName,
  client: initialClient,
  address: initialAddress,
  startDate: initialStartDate,
  onClose,
  onGone,
}: {
  id: string;
  name: string;
  client?: string;
  address?: string;
  startDate?: string;
  onClose: () => void;
  onGone: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [client, setClient] = useState(initialClient ?? '');
  const [address, setAddress] = useState(initialAddress ?? '');
  const [startDate, setStartDate] = useState(initialStartDate ?? '');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function saveProject() {
    setSaving(true);
    setSaveError('');
    try {
      await updateProject(id, {
        name: name.trim() || initialName,
        client: client.trim() || undefined,
        address: address.trim() || undefined,
        startDate: startDate || undefined,
      });
      onClose();
    } catch {
      setSaveError('The project was not saved. Your details are still here. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet title="Edit project" onClose={onClose}>
      <label className="field">
        <span>Project name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span>Client (optional)</span>
        <input value={client} onChange={(e) => setClient(e.target.value)} />
      </label>
      <label className="field">
        <span>Site (optional)</span>
        <input value={address} onChange={(e) => setAddress(e.target.value)} />
      </label>
      <label className="field">
        <span>Start date (optional)</span>
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
      </label>
      {saveError ? <p className="form-error" role="alert">{saveError}</p> : null}
      <button
        type="button"
        className="btn btn-primary btn-block"
        disabled={saving}
        onClick={() => void saveProject()}
      >
        {saving ? 'Saving project…' : 'Save project'}
      </button>
      <hr className="rule" />
      <button
        type="button"
        className="btn btn-secondary btn-block"
        onClick={() => {
          void archiveProject(id).then(onGone);
        }}
      >
        Archive project and keep its records
      </button>
      {!confirmDelete ? (
        <button type="button" className="btn btn-danger btn-block" onClick={() => setConfirmDelete(true)}>
          Delete project…
        </button>
      ) : (
        <button
          type="button"
          className="btn btn-danger btn-block"
          onClick={() => {
            void deleteProject(id).then(onGone);
          }}
        >
          Delete the full project. This cannot be undone.
        </button>
      )}
    </Sheet>
  );
}
