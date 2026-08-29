import { useState } from 'react';
import type { CloseoutFinding, CloseoutProposal } from '../domain/closeout.ts';
import { localDateOf } from '../domain/dates.ts';
import type { Photo, PunchItem } from '../domain/types.ts';
import type { WorkdayViewModel } from '../domain/workdays.ts';
import { upsertDailyLog } from '../data/repo.ts';
import { WORKDAY_STATUS_LABELS } from './handoffLabels.ts';
import { PhotoDetail } from './PhotoDetail.tsx';
import { PunchEvidenceSheet } from './PunchEvidenceSheet.tsx';
import { Sheet } from './Sheet.tsx';
import { usePhotoUrl } from './usePhotoUrl.ts';

export type WorkdayDetailProps = {
  projectId: string;
  projectName: string;
  workday: WorkdayViewModel;
  photos: readonly Photo[];
  focusId?: string;
  onClose: () => void;
  returnFocusId?: string;
};

function formatDate(dateKey: string): string {
  return new Date(`${dateKey}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function shortPhotoId(photoId: string): string {
  return photoId.slice(0, 12);
}

function findingElementId(findingId: string): string {
  return `workday-finding-${findingId}`;
}

function PhotoThumbnail({ photo }: { photo: Photo }) {
  const url = usePhotoUrl(photo.id);
  const label = photo.caption?.trim() || `Photo ${shortPhotoId(photo.id)}`;

  return url ? (
    <img src={url} alt={label} loading="lazy" />
  ) : (
    <span className="workday-detail-photo-placeholder" aria-label={label} />
  );
}

function WorkdayPhotoCard({
  photo,
  linkCount,
  onOpen,
}: {
  photo: Photo;
  linkCount: number;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className={`workday-detail-photo${photo.voidedAt ? ' voided' : ''}`}
      data-workday-photo={photo.id}
      onClick={onOpen}
      aria-label={`Open ${photo.caption?.trim() || `photo ${shortPhotoId(photo.id)}`}`}
    >
      <PhotoThumbnail photo={photo} />
      <span className="workday-detail-photo-copy">
        <strong>{photo.caption?.trim() || 'No caption yet'}</strong>
        <span className="meta-line">
          {new Date(photo.capturedAt).toLocaleTimeString(undefined, {
            hour: 'numeric',
            minute: '2-digit',
          })}
          {' · '}
          {countLabel(linkCount, 'proof link')}
        </span>
        {photo.voidedAt ? <span className="void-stamp">Voided photo</span> : null}
      </span>
    </button>
  );
}

function ProofPhoto({ photo, onOpen }: { photo: Photo; onOpen: () => void }) {
  return (
    <button type="button" className="workday-detail-proof" onClick={onOpen}>
      <PhotoThumbnail photo={photo} />
      <span>{photo.caption?.trim() || `Photo ${shortPhotoId(photo.id)}`}</span>
      {photo.voidedAt ? <span className="void-stamp">Voided</span> : null}
    </button>
  );
}

function WorkItemSection({
  title,
  items,
  photoById,
  emptyText,
  onOpenPhoto,
  onManageProof,
}: {
  title: string;
  items: readonly PunchItem[];
  photoById: ReadonlyMap<string, Photo>;
  emptyText: string;
  onOpenPhoto: (photoId: string) => void;
  onManageProof?: (itemId: string) => void;
}) {
  return (
    <section className="workday-detail-section">
      <h3>{title}</h3>
      {items.length === 0 ? <p className="empty-sub">{emptyText}</p> : null}
      <div className="workday-detail-items">
        {items.map((item) => {
          const linkedPhotos = item.photoIds.flatMap((photoId) => {
            const photo = photoById.get(photoId);
            return photo ? [photo] : [];
          });
          const missingPhotoCount = item.photoIds.length - linkedPhotos.length;
          return (
            <article className="workday-detail-item" key={item.id} data-work-item-id={item.id}>
              <div className="workday-detail-item-head">
                <strong>{item.text}</strong>
                <span>{item.status === 'done' ? 'Completed' : 'Open'}</span>
              </div>
              {item.status === 'done' ? (
                <>
                  {linkedPhotos.length > 0 ? (
                    <div className="workday-detail-proof-list" aria-label={`Proof for ${item.text}`}>
                      {linkedPhotos.map((photo) => (
                        <ProofPhoto
                          key={photo.id}
                          photo={photo}
                          onOpen={() => onOpenPhoto(photo.id)}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="workday-detail-missing">No proof photo linked.</p>
                  )}
                  {missingPhotoCount > 0 ? (
                    <p className="workday-detail-missing">
                      {countLabel(missingPhotoCount, 'linked photo is missing', 'linked photos are missing')}.
                    </p>
                  ) : null}
                  {item.proofException ? (
                    <p className="proof-help">
                      No-photo reason: {item.proofException.reason}
                    </p>
                  ) : null}
                  {onManageProof ? (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => onManageProof(item.id)}
                    >
                      Manage proof
                    </button>
                  ) : null}
                </>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function FindingGroup({
  title,
  findings,
  focusId,
}: {
  title: string;
  findings: readonly CloseoutFinding[];
  focusId?: string;
}) {
  if (findings.length === 0) return null;
  return (
    <section className="workday-detail-section workday-detail-findings">
      <h3>{title}</h3>
      {findings.map((finding) => {
        const requested = finding.id === focusId;
        return (
          <article
            data-finding-id={finding.id}
            data-sheet-initial-focus={requested ? 'true' : undefined}
            id={findingElementId(finding.id)}
            className={`workday-detail-finding ${finding.severity}`}
            tabIndex={requested ? -1 : undefined}
            key={finding.id}
          >
            <strong>{finding.message}</strong>
            <p>{finding.suggestedAction}</p>
          </article>
        );
      })}
    </section>
  );
}

function SuggestedUpdate({
  proposal,
  photoById,
  workItemById,
  onOpenPhoto,
}: {
  proposal: CloseoutProposal;
  photoById: ReadonlyMap<string, Photo>;
  workItemById: ReadonlyMap<string, PunchItem>;
  onOpenPhoto: (photoId: string) => void;
}) {
  if (proposal.kind === 'daily-log') {
    return (
      <article className={`workday-detail-suggestion status-${proposal.status}`}>
        <strong>Draft daily record</strong>
        <span className="meta-line">{proposal.status === 'pending' ? 'Suggested update' : proposal.status}</span>
        <p>{proposal.reason}</p>
        <p className="workday-detail-draft">{proposal.body}</p>
        <p className="proof-help">Review the wording before it is saved to the job record.</p>
      </article>
    );
  }

  const photo = photoById.get(proposal.photoId);
  const item = workItemById.get(proposal.punchItemId);
  return (
    <article className={`workday-detail-suggestion status-${proposal.status}`}>
      <strong>Possible proof photo</strong>
      <span>{item?.text ?? 'Completed work item'}</span>
      <p>{proposal.reason}</p>
      {photo ? (
        <button type="button" className="btn btn-secondary" onClick={() => onOpenPhoto(photo.id)}>
          Preview {photo.caption?.trim() || `photo ${shortPhotoId(photo.id)}`}
        </button>
      ) : (
        <p className="workday-detail-missing">The suggested photo is no longer available. Check again.</p>
      )}
    </article>
  );
}

export function WorkdayDetail({
  projectId,
  projectName,
  workday,
  photos,
  focusId,
  onClose,
  returnFocusId,
}: WorkdayDetailProps) {
  const [openPhotoId, setOpenPhotoId] = useState<string>();
  const [proofItemId, setProofItemId] = useState<string>();
  const [editingDailyRecord, setEditingDailyRecord] = useState(false);
  const [dailyBody, setDailyBody] = useState(workday.dailyRecord?.body ?? '');
  const [savingDailyRecord, setSavingDailyRecord] = useState(false);
  const [dailyRecordError, setDailyRecordError] = useState('');
  const datePhotos = photos.filter(
    (photo) => photo.projectId === projectId && localDateOf(photo.capturedAt) === workday.dateKey,
  );
  const activePhotos = datePhotos.filter((photo) => !photo.voidedAt);
  const allItems = [...workday.completedItems, ...workday.openItems];
  const photoById = new Map(photos.map((photo) => [photo.id, photo]));
  const workItemById = new Map(allItems.map((item) => [item.id, item]));
  const openPhoto = openPhotoId ? photoById.get(openPhotoId) : undefined;
  const proofItem = proofItemId ? workItemById.get(proofItemId) : undefined;
  const blockers = workday.findings.filter((finding) => finding.severity === 'blocker');
  const warnings = workday.findings.filter((finding) => finding.severity === 'warning');
  const requestedFinding = workday.findings.find((finding) => finding.id === focusId);
  const initialFocusId = requestedFinding ? findingElementId(requestedFinding.id) : undefined;

  async function saveDailyRecord() {
    if (!dailyBody.trim()) return;
    setSavingDailyRecord(true);
    setDailyRecordError('');
    try {
      await upsertDailyLog(projectId, workday.dateKey, dailyBody);
      setEditingDailyRecord(false);
    } catch (error) {
      setDailyRecordError(
        error instanceof Error ? error.message : 'The daily record was not saved. Try again.',
      );
    } finally {
      setSavingDailyRecord(false);
    }
  }

  return (
    <Sheet
      title="Workday details"
      variant="wide"
      fullHeightOnMobile
      initialFocusId={initialFocusId}
      returnFocusId={returnFocusId}
      onClose={onClose}
    >
      <div className="workday-detail">
        <header className="workday-detail-head">
          <span className="section-label">{projectName}</span>
          <h2>{formatDate(workday.dateKey)}</h2>
          <span className={`workday-status status-${workday.status}`}>
            {WORKDAY_STATUS_LABELS[workday.status]}
          </span>
        </header>

        <section className="workday-detail-section">
          <div className="workday-detail-section-head">
            <h3>Photos</h3>
            <span>{countLabel(datePhotos.length, 'photo')}</span>
          </div>
          {datePhotos.length === 0 ? (
            <p className="empty-sub">No photos recorded for this workday.</p>
          ) : null}
          {datePhotos.length > 0 && activePhotos.length === 0 ? (
            <p className="workday-detail-missing">
              {datePhotos.length === 1
                ? 'No active photos remain. The voided photo stays in this workday.'
                : 'No active photos remain. The voided photos stay in this workday.'}
            </p>
          ) : null}
          <div className="workday-detail-photo-grid">
            {datePhotos.map((photo) => (
              <WorkdayPhotoCard
                key={photo.id}
                photo={photo}
                linkCount={allItems.filter((item) => item.photoIds.includes(photo.id)).length}
                onOpen={() => setOpenPhotoId(photo.id)}
              />
            ))}
          </div>
        </section>

        <WorkItemSection
          title="Completed work"
          items={workday.completedItems}
          photoById={photoById}
          emptyText="No completed work recorded for this workday."
          onOpenPhoto={setOpenPhotoId}
          onManageProof={setProofItemId}
        />

        <WorkItemSection
          title="Open work"
          items={workday.openItems}
          photoById={photoById}
          emptyText="No open work recorded for this workday."
          onOpenPhoto={setOpenPhotoId}
        />

        <section className="workday-detail-section" data-daily-record-date={workday.dateKey}>
          <div className="workday-detail-section-head">
            <h3>Daily record</h3>
            {!editingDailyRecord ? (
              <button
                type="button"
                className="btn btn-quiet"
                onClick={() => {
                  setDailyBody(workday.dailyRecord?.body ?? '');
                  setEditingDailyRecord(true);
                }}
              >
                {workday.dailyRecord ? 'Edit daily record' : 'Add daily record'}
              </button>
            ) : null}
          </div>
          {workday.dailyRecord && !editingDailyRecord ? (
            <div className="workday-detail-daily-copy">
              <p>{workday.dailyRecord.body}</p>
              {workday.dailyRecord.crew ? <p><strong>Crew:</strong> {workday.dailyRecord.crew}</p> : null}
              {workday.dailyRecord.weather ? <p><strong>Weather:</strong> {workday.dailyRecord.weather}</p> : null}
            </div>
          ) : null}
          {!workday.dailyRecord && !editingDailyRecord ? (
            <p className="workday-detail-missing">No daily record saved for this workday.</p>
          ) : null}
          {editingDailyRecord ? (
            <div className="workday-detail-daily-editor">
              <label className="field">
                <span>What happened this workday?</span>
                <textarea
                  rows={6}
                  value={dailyBody}
                  onChange={(event) => setDailyBody(event.target.value)}
                />
              </label>
              {dailyRecordError ? <p className="form-error">{dailyRecordError}</p> : null}
              <div className="workday-detail-editor-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={savingDailyRecord}
                  onClick={() => {
                    setDailyBody(workday.dailyRecord?.body ?? '');
                    setDailyRecordError('');
                    setEditingDailyRecord(false);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!dailyBody.trim() || savingDailyRecord}
                  onClick={() => void saveDailyRecord()}
                >
                  {savingDailyRecord ? 'Saving…' : 'Save daily record'}
                </button>
              </div>
            </div>
          ) : null}
        </section>

        <FindingGroup title="Needs attention" findings={blockers} focusId={focusId} />
        <FindingGroup title="Worth a look" findings={warnings} focusId={focusId} />

        {workday.suggestedUpdates.length > 0 ? (
          <section className="workday-detail-section">
            <h3>Suggested updates</h3>
            <div className="workday-detail-suggestions">
              {workday.suggestedUpdates.map((proposal) => (
                <SuggestedUpdate
                  key={proposal.id}
                  proposal={proposal}
                  photoById={photoById}
                  workItemById={workItemById}
                  onOpenPhoto={setOpenPhotoId}
                />
              ))}
            </div>
          </section>
        ) : null}
      </div>

      {openPhoto ? (
        <PhotoDetail
          photo={openPhoto}
          projectName={projectName}
          workdayDate={localDateOf(openPhoto.capturedAt)}
          linkedItems={allItems.filter((item) => item.photoIds.includes(openPhoto.id))}
          projectItems={allItems}
          onClose={() => setOpenPhotoId(undefined)}
        />
      ) : null}

      {proofItem ? (
        <PunchEvidenceSheet
          item={proofItem}
          photos={[...photos]}
          projectName={projectName}
          onClose={() => setProofItemId(undefined)}
        />
      ) : null}
    </Sheet>
  );
}
