import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  closeoutSourceFingerprint,
  effectiveCloseoutPhase,
  type CloseoutFinding,
  type CloseoutPhase,
  type SealStatus,
} from '../../domain/closeout.ts';
import {
  buildDayReport,
  buildHandoffPacket,
  localDateOf,
  type DayReport as DayReportModel,
  type HandoffPacket,
} from '../../domain/reports.ts';
import type { Photo } from '../../domain/types.ts';
import { closeoutSessions } from '../../data/closeoutClient.ts';
import { useProjectCloseoutSession } from '../../data/closeoutSession.ts';
import { getPhotoBytes } from '../../data/repo.ts';
import { useProjectRecord, useSettings } from '../../data/useLive.ts';
import { ProjectNotFound } from '../ProjectNotFound.tsx';
import { HANDOFF_STATUS_LABELS } from '../handoffLabels.ts';
import { SealOctagon } from '../icons.tsx';

const PACKET_BANNERS: Partial<Record<CloseoutPhase, string>> = {
  'not-checked': 'Handoff review has not been run for this project.',
  checking: 'Handoff review is still running. This packet may change.',
  'needs-attention': 'Handoff review found items that need attention before handoff.',
  'ready-with-warnings': 'This project is ready with notes. Review the notes before handoff.',
  'check-again': 'The job record changed after the prior review. Check again before handoff.',
  'check-failed': 'The latest review did not finish. No job record was changed by the review.',
};

const KEEP_WITH_NEXT = { breakAfter: 'avoid' } as const;

type EvaluatedReviewPhase = {
  record: object;
  auditSourceFingerprint: string;
  sessionPhase: CloseoutPhase;
  phase: CloseoutPhase;
};

function isCompletedPhase(phase: CloseoutPhase): boolean {
  return ['needs-attention', 'ready-with-warnings', 'ready'].includes(phase);
}

function shortPhotoId(id: string): string {
  return id.length > 11 ? id.slice(0, 11) : id;
}

function formatDateKey(dateKey: string): string {
  return new Date(`${dateKey}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function photoCheckLabel(status: SealStatus | undefined): string {
  switch (status) {
    case 'pass':
      return 'Photo check passed';
    case 'fail':
      return 'Photo check failed';
    case 'unreadable':
      return 'Photo could not be checked';
    case 'excluded':
      return 'Photo excluded from the check';
    default:
      return 'Photo check not run';
  }
}

function findingLabel(finding: CloseoutFinding): string {
  return finding.severity === 'blocker' ? 'Needs attention' : 'Worth a look';
}

function ReportPhoto({ photo, checked }: { photo: Photo; checked?: SealStatus }) {
  const [url, setUrl] = useState('');

  useEffect(() => {
    let objectUrl = '';
    void getPhotoBytes(photo.id).then((bytes) => {
      if (!bytes) return;
      objectUrl = URL.createObjectURL(bytes);
      setUrl(objectUrl);
    });
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photo.id]);

  const shortId = shortPhotoId(photo.id);
  return (
    <figure className="report-photo">
      {url && <img src={url} alt={photo.caption?.trim() || `Job photo ${shortId}`} />}
      <figcaption>
        <span className="report-caption">{photo.caption?.trim() || 'No caption recorded'}</span>
        <span className="meta-line">
          {formatDateKey(localDateOf(photo.capturedAt))} · Photo ID {shortId}
        </span>
        {checked === 'pass' && <span className="meta-line">Photo check passed</span>}
      </figcaption>
    </figure>
  );
}

function ReportActions({ projectId }: { projectId: string }) {
  return (
    <div className="report-actions no-print">
      <Link to={`/project/${projectId}`} className="btn btn-secondary">
        ← Back
      </Link>
      <button type="button" className="btn btn-primary" onClick={() => window.print()}>
        Print / Save PDF
      </button>
    </div>
  );
}

export function DayReportView({ report }: { report: DayReportModel }) {
  return (
    <>
      <header className="report-head">
        <p className="report-company">{report.project.name}</p>
        <h1 className="report-title">Daily Work Report</h1>
        <p className="report-sub">
          <span className="num">{report.date}</span>
          {report.project.client && ` · ${report.project.client}`}
        </p>
      </header>

      <section className="report-section">
        <h2 style={KEEP_WITH_NEXT}>Daily record</h2>
        {report.log ? (
          <>
            <p className="report-log">{report.log.body}</p>
            {(report.log.crew || report.log.weather) && (
              <p className="meta-line">
                {report.log.crew && `Crew: ${report.log.crew}`}
                {report.log.crew && report.log.weather && ' · '}
                {report.log.weather && `Weather: ${report.log.weather}`}
              </p>
            )}
          </>
        ) : (
          <p className="report-log">No daily record was saved for this workday.</p>
        )}
      </section>

      <section className="report-section">
        <h2 style={KEEP_WITH_NEXT}>Completed work</h2>
        {report.punchDone.length > 0 ? (
          <ul className="report-list">
            {report.punchDone.map((item) => (
              <li key={item.id}>{item.text}</li>
            ))}
          </ul>
        ) : (
          <p className="report-log">No completed work was recorded for this workday.</p>
        )}
      </section>

      {report.punchOpened.length > 0 && (
        <section className="report-section">
          <h2 style={KEEP_WITH_NEXT}>Open work</h2>
          <ul className="report-list">
            {report.punchOpened.map((item) => (
              <li key={item.id}>{item.text}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="report-section">
        <h2 style={KEEP_WITH_NEXT}>
          Photos <span className="num">({report.photos.length})</span>
        </h2>
        {report.photos.length > 0 ? (
          <div className="report-photos">
            {report.photos.map((photo) => (
              <ReportPhoto key={photo.id} photo={photo} />
            ))}
          </div>
        ) : (
          <p className="report-log">No photos were recorded for this workday.</p>
        )}
      </section>

      <footer className="report-foot">
        <span className="seal">
          <SealOctagon /> FieldProof
        </span>
        <span>This report contains the saved record for one workday.</span>
      </footer>
    </>
  );
}

function ReviewSummary({ review }: { review: HandoffPacket['review'] }) {
  const banner = PACKET_BANNERS[review.phase];
  const hasPriorResult =
    !review.current &&
    Boolean(review.lastCompletedAt || review.blockerCount > 0 || review.warningCount > 0);
  const hasCompletedResult = review.current || hasPriorResult;

  return (
    <section className={`report-section report-closeout phase-${review.phase}`}>
      <h2 style={KEEP_WITH_NEXT}>Handoff status</h2>
      <strong>{HANDOFF_STATUS_LABELS[review.phase]}</strong>
      {banner && <p className="report-log">{banner}</p>}
      {hasCompletedResult && (
        <div className="meta-line">
          <strong>{hasPriorResult ? 'Prior result' : 'Current result'}</strong>
          <span>
            {' · '}
            {countLabel(review.blockerCount, 'item needs attention', 'items need attention')}
            {' · '}
            {countLabel(review.warningCount, 'item worth a look', 'items worth a look')}
          </span>
          {review.lastCompletedAt && <span> · Reviewed {formatDateTime(review.lastCompletedAt)}</span>}
        </div>
      )}
    </section>
  );
}

function ReviewFindings({
  findings,
  prior,
}: {
  findings: CloseoutFinding[];
  prior: boolean;
}) {
  if (findings.length === 0) return null;
  return (
    <section className="report-section">
      <h3 style={KEEP_WITH_NEXT}>{prior ? 'Prior review items' : 'Items to review'}</h3>
      <ul className="report-list">
        {findings.map((finding) => (
          <li key={finding.id}>
            <strong>{findingLabel(finding)}:</strong> {finding.message}
          </li>
        ))}
      </ul>
    </section>
  );
}

function PacketWorkdayView({
  workday,
  photoChecks,
  priorFindings,
}: {
  workday: HandoffPacket['workdays'][number];
  photoChecks: ReadonlyMap<string, SealStatus | undefined>;
  priorFindings: boolean;
}) {
  return (
    <section className="report-section" data-workday={workday.dateKey}>
      <h2 style={KEEP_WITH_NEXT}>{formatDateKey(workday.dateKey)}</h2>

      <section>
        <h3 style={KEEP_WITH_NEXT}>Daily record</h3>
        {workday.dailyRecord ? (
          <>
            <p className="report-log">{workday.dailyRecord.body}</p>
            {(workday.dailyRecord.crew || workday.dailyRecord.weather) && (
              <p className="meta-line">
                {workday.dailyRecord.crew && `Crew: ${workday.dailyRecord.crew}`}
                {workday.dailyRecord.crew && workday.dailyRecord.weather && ' · '}
                {workday.dailyRecord.weather && `Weather: ${workday.dailyRecord.weather}`}
              </p>
            )}
          </>
        ) : (
          <p className="report-log">No daily record was saved for this workday.</p>
        )}
      </section>

      <section>
        <h3 style={KEEP_WITH_NEXT}>Completed work</h3>
        {workday.workItems.length > 0 ? (
          <ul className="report-list report-punch-proof">
            {workday.workItems.map(({ item, validProofPhotos, unusablePhotoIds }) => (
              <li key={item.id}>
                <strong>{item.text}</strong>
                {item.doneAt && (
                  <span className="meta-line">Completed {formatDateKey(localDateOf(item.doneAt))}</span>
                )}

                {validProofPhotos.length > 0 && (
                  <div className="report-proof-group">
                    <h4 style={KEEP_WITH_NEXT}>Linked proof</h4>
                    <div className="report-photos">
                      {validProofPhotos.map((photo) => (
                        <ReportPhoto
                          key={photo.id}
                          photo={photo}
                          checked={photoChecks.get(photo.id)}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {unusablePhotoIds.map((photoId) => (
                  <span className="report-proof-missing" key={photoId}>
                    Linked photo {shortPhotoId(photoId)} is not usable proof for this item.
                  </span>
                ))}

                {item.proofException && (
                  <span className="report-proof-exception">
                    Reason no photo was needed: {item.proofException.reason} · Recorded{' '}
                    {formatDateKey(localDateOf(item.proofException.recordedAt))}
                  </span>
                )}

                {validProofPhotos.length === 0 &&
                  unusablePhotoIds.length === 0 &&
                  !item.proofException && (
                    <span className="report-proof-missing">
                      No linked proof or recorded exception.
                    </span>
                  )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="report-log">No completed work was recorded for this workday.</p>
        )}
      </section>

      {workday.supportingPhotos.length > 0 && (
        <section>
          <h3 style={KEEP_WITH_NEXT}>Supporting photos</h3>
          <div className="report-photos">
            {workday.supportingPhotos.slice(0, 3).map((photo) => (
              <ReportPhoto
                key={photo.id}
                photo={photo}
                checked={photoChecks.get(photo.id)}
              />
            ))}
          </div>
        </section>
      )}

      <ReviewFindings findings={workday.findings} prior={priorFindings} />
    </section>
  );
}

function TechnicalAppendix({ appendix }: { appendix: HandoffPacket['appendix'] }) {
  return (
    <section className="report-section report-appendix">
      <h2 style={KEEP_WITH_NEXT}>Technical appendix</h2>
      <p className="report-log">
        This section lists the stored capture facts for every photo in this packet record.
      </p>
      <table className="hash-table">
        <thead>
          <tr>
            <th>Photo</th>
            <th>Stored capture facts</th>
          </tr>
        </thead>
        <tbody>
          {appendix.map(({ photo, checkStatus }) => (
            <tr key={photo.id} style={{ breakInside: 'avoid' }}>
              <td>
                <strong>{shortPhotoId(photo.id)}</strong>
                {photo.caption?.trim() && <div>{photo.caption}</div>}
              </td>
              <td>
                <div>Photo ID: {photo.id}</div>
                <div>Captured: {photo.capturedAt}</div>
                <div>
                  Dimensions: {photo.width} × {photo.height}
                </div>
                <div>Stored size: {photo.size.toLocaleString('en-US')} bytes</div>
                <div>
                  Location:{' '}
                  {photo.lat !== undefined && photo.lon !== undefined
                    ? `${photo.lat}, ${photo.lon}${
                        photo.accuracy !== undefined ? ` · accuracy ${photo.accuracy} m` : ''
                      }`
                    : 'Not saved'}
                </div>
                <div>Full SHA-256: {photo.sha256}</div>
                <div>Check state: {photoCheckLabel(checkStatus)}</div>
                <div>
                  Void record:{' '}
                  {photo.voidedAt
                    ? `Voided ${photo.voidedAt}. Reason: ${photo.voidReason || 'No reason recorded.'}`
                    : 'Active'}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function HandoffPacketView({
  packet,
  company,
  letterheadLine,
  generatedOn,
}: {
  packet: HandoffPacket;
  company?: string;
  letterheadLine?: string;
  generatedOn?: string;
}) {
  const orderedWorkdays = [...packet.workdays].sort((a, b) =>
    a.dateKey.localeCompare(b.dateKey),
  );
  const photoChecks = new Map(
    packet.appendix.map(({ photo, checkStatus }) => [photo.id, checkStatus] as const),
  );
  const activePhotoCount = packet.appendix.filter(({ photo }) => !photo.voidedAt).length;
  const completedWorkCount = packet.workdays.reduce(
    (count, workday) => count + workday.workItems.length,
    0,
  );
  const priorFindings = !packet.review.current;

  return (
    <>
      <header className="report-head">
        {company && <p className="report-company">{company}</p>}
        {letterheadLine && <p className="report-sub">{letterheadLine}</p>}
        <h1 className="report-title">Handoff Packet</h1>
        <p className="report-sub">
          {packet.project.name}
          {packet.project.client && ` · ${packet.project.client}`}
          {packet.project.address && ` · ${packet.project.address}`}
        </p>
        <p className="meta-line">
          {countLabel(orderedWorkdays.length, 'workday')} · {countLabel(activePhotoCount, 'photo')} ·{' '}
          {countLabel(completedWorkCount, 'completed item')}
          {generatedOn && ` · Generated ${formatDateTime(generatedOn)}`}
        </p>
      </header>

      <ReviewSummary review={packet.review} />
      <ReviewFindings findings={packet.projectFindings} prior={priorFindings} />

      {orderedWorkdays.length > 0 ? (
        orderedWorkdays.map((workday) => (
          <PacketWorkdayView
            key={workday.dateKey}
            workday={workday}
            photoChecks={photoChecks}
            priorFindings={priorFindings}
          />
        ))
      ) : (
        <section className="report-section">
          <h2 style={KEEP_WITH_NEXT}>Workdays</h2>
          <p className="report-log">No saved workdays are available for this packet.</p>
        </section>
      )}

      <TechnicalAppendix appendix={packet.appendix} />

      <footer className="report-foot">
        <span className="seal">
          <SealOctagon /> FieldProof
        </span>
        <span>This packet documents saved job records. It does not certify the work.</span>
      </footer>
    </>
  );
}

export function DayReport() {
  const { projectId, date } = useParams();
  const record = useProjectRecord(projectId);

  if (record === undefined) return null;
  if (record === null || !date) return <ProjectNotFound />;
  const report = buildDayReport(record.project, date, record.photos, record.logs, record.punch);

  return (
    <div className="report">
      <ReportActions projectId={record.project.id} />
      <DayReportView report={report} />
    </div>
  );
}

export function EvidencePacket() {
  const { projectId } = useParams();
  const record = useProjectRecord(projectId);
  const settings = useSettings();
  const closeout = useProjectCloseoutSession(projectId ?? '', closeoutSessions);
  const [generatedOn] = useState(() => new Date().toISOString());
  const [evaluatedReview, setEvaluatedReview] = useState<EvaluatedReviewPhase>();
  const audit = closeout.audit;
  const completedPhase = isCompletedPhase(closeout.phase);

  useEffect(() => {
    let active = true;
    if (!record || !audit || !completedPhase) {
      setEvaluatedReview(undefined);
      return () => {
        active = false;
      };
    }

    void closeoutSourceFingerprint({
      project: record.project,
      photos: record.photos,
      punchItems: record.punch,
      dailyLogs: record.logs,
    }).then(
      (fingerprint) => {
        if (!active) return;
        setEvaluatedReview({
          record,
          auditSourceFingerprint: audit.sourceFingerprint,
          sessionPhase: closeout.phase,
          phase: effectiveCloseoutPhase(audit, fingerprint),
        });
      },
      () => {
        if (!active) return;
        setEvaluatedReview({
          record,
          auditSourceFingerprint: audit.sourceFingerprint,
          sessionPhase: closeout.phase,
          phase: 'check-again',
        });
      },
    );

    return () => {
      active = false;
    };
  }, [audit, closeout.phase, completedPhase, record]);

  if (record === undefined) return null;
  if (record === null) return <ProjectNotFound />;
  const evaluatedPhase =
    audit &&
    evaluatedReview?.record === record &&
    evaluatedReview.auditSourceFingerprint === audit.sourceFingerprint &&
    evaluatedReview.sessionPhase === closeout.phase
      ? evaluatedReview.phase
      : undefined;
  const displayedPhase = completedPhase ? (evaluatedPhase ?? 'check-again') : closeout.phase;
  const packet = buildHandoffPacket({
    project: record.project,
    photos: record.photos,
    dailyLogs: record.logs,
    punchItems: record.punch,
    review: {
      phase: displayedPhase,
      current: Boolean(audit && evaluatedPhase && displayedPhase === audit.phase),
      lastCompletedAt: audit?.checkedAt,
      blockerCount: audit?.blockerCount ?? 0,
      warningCount: audit?.warningCount ?? 0,
      findings: audit?.findings ?? [],
      sealResults: closeout.verification?.results ?? [],
    },
  });

  return (
    <div className="report">
      <ReportActions projectId={record.project.id} />
      <HandoffPacketView
        packet={packet}
        company={settings?.company}
        letterheadLine={settings?.letterheadLine}
        generatedOn={generatedOn}
      />
    </div>
  );
}
