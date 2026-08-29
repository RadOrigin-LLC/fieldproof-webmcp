import { useEffect, useState } from 'react';
import { savePunchItem, updatePhotoMeta, verifyPhoto, voidPhoto } from '../data/repo.ts';
import { attachPhoto, detachPhoto } from '../domain/punch.ts';
import type { Photo, PunchItem } from '../domain/types.ts';
import { Sheet } from './Sheet.tsx';
import { usePhotoUrl } from './usePhotoUrl.ts';

export type PhotoDetailProps = {
  photo: Photo;
  projectName: string;
  workdayDate: string;
  linkedItems: readonly PunchItem[];
  projectItems?: readonly PunchItem[];
  onClose: () => void;
  returnFocusId?: string;
};

type CheckState = 'idle' | 'checking' | 'pass' | 'fail' | 'missing';

function formatDate(dateKey: string): string {
  return new Date(`${dateKey}T12:00:00`).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatCaptureTime(value: string): string {
  const date = new Date(value);
  return `${date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })} at ${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

function shortPhotoId(id: string): string {
  return id.length > 11 ? id.slice(0, 11) : id;
}

function parseTags(value: string): string[] | undefined {
  const tags = [...new Set(value.split(',').map((tag) => tag.trim()).filter(Boolean))];
  return tags.length > 0 ? tags : undefined;
}

export function PhotoDetail({
  photo,
  projectName,
  workdayDate,
  linkedItems,
  projectItems,
  onClose,
  returnFocusId,
}: PhotoDetailProps) {
  const photoUrl = usePhotoUrl(photo.id);
  const [caption, setCaption] = useState(photo.caption ?? '');
  const [tags, setTags] = useState((photo.tags ?? []).join(', '));
  const [notesState, setNotesState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [checkState, setCheckState] = useState<CheckState>('idle');
  const [voiding, setVoiding] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [voidError, setVoidError] = useState('');
  const availableItems = (projectItems ?? linkedItems).filter(
    (item) => item.projectId === photo.projectId,
  );
  const [currentItems, setCurrentItems] = useState<PunchItem[]>(() => [...availableItems]);
  const [linkingItemId, setLinkingItemId] = useState('');
  const [linkStatus, setLinkStatus] = useState('');
  const dateLabel = formatDate(workdayDate);
  const shortId = shortPhotoId(photo.id);
  const previewLabel = photo.caption?.trim() || `Photo from ${dateLabel}, ID ${shortId}`;

  useEffect(() => {
    setCurrentItems(
      [...(projectItems ?? linkedItems)].filter((item) => item.projectId === photo.projectId),
    );
  }, [linkedItems, photo.projectId, projectItems]);

  async function saveNotes() {
    setNotesState('saving');
    try {
      await updatePhotoMeta(photo.id, {
        caption: caption.trim() || undefined,
        tags: parseTags(tags),
      });
      setNotesState('saved');
    } catch {
      setNotesState('failed');
    }
  }

  async function checkSavedPhoto() {
    setCheckState('checking');
    try {
      const result = await verifyPhoto(photo.id);
      setCheckState(result ? (result.ok ? 'pass' : 'fail') : 'missing');
    } catch {
      setCheckState('missing');
    }
  }

  async function changeWorkItemLink(item: PunchItem, linked: boolean) {
    if (photo.voidedAt && !linked) return;
    setLinkingItemId(item.id);
    setLinkStatus('');
    const next = linked ? detachPhoto(item, photo.id) : attachPhoto(item, photo.id);
    try {
      await savePunchItem(next);
      setCurrentItems((items) =>
        items.map((current) => (current.id === item.id ? next : current)),
      );
      setLinkStatus(linked ? 'Work item link removed.' : 'Photo linked to the work item.');
    } catch {
      setLinkStatus('The work item link was not changed. Try again.');
    } finally {
      setLinkingItemId('');
    }
  }

  async function confirmVoid() {
    if (!voidReason.trim()) return;
    setVoidError('');
    try {
      await voidPhoto(photo.id, voidReason);
      onClose();
    } catch {
      setVoidError('The photo was not voided. Try again.');
    }
  }

  return (
    <Sheet
      title={photo.voidedAt ? 'Voided photo' : 'Photo'}
      returnFocusId={returnFocusId}
      onClose={onClose}
    >
      {photoUrl ? (
        <img src={photoUrl} alt={previewLabel} className="photo-full" />
      ) : (
        <div className="photo-full photo-ph" role="img" aria-label={previewLabel} />
      )}

      <div className="sealed-meta" style={{ margin: '12px 0' }}>
        <strong>{projectName}</strong>
        <span className="meta-line">{dateLabel}</span>
        <span className="meta-line">Photo ID {shortId}</span>
        <span className={photo.voidedAt ? 'verify-fail' : 'verify-ok'}>
          {photo.voidedAt ? 'Voided photo' : 'Original record protected'}
        </span>
      </div>

      <section aria-labelledby="photo-linked-work">
        <h3 id="photo-linked-work" className="section-label">
          Linked work
        </h3>
        {currentItems.some((item) => item.photoIds.includes(photo.id)) ? (
          <ul>
            {currentItems
              .filter((item) => item.photoIds.includes(photo.id))
              .map((item) => (
                <li key={item.id}>
                  <span>{item.text}</span>
                  <button
                    type="button"
                    className="btn btn-quiet"
                    aria-label={`Remove link from ${item.text}`}
                    disabled={Boolean(linkingItemId)}
                    onClick={() => void changeWorkItemLink(item, true)}
                  >
                    {linkingItemId === item.id ? 'Saving…' : 'Remove link'}
                  </button>
                </li>
              ))}
          </ul>
        ) : (
          <p className="empty-sub">No work items use this photo.</p>
        )}
        {!photo.voidedAt && currentItems.some((item) => !item.photoIds.includes(photo.id)) ? (
          <div>
            <h4 className="section-label">Other work items</h4>
            <ul>
              {currentItems
                .filter((item) => !item.photoIds.includes(photo.id))
                .map((item) => (
                  <li key={item.id}>
                    <span>{item.text}</span>
                    <button
                      type="button"
                      className="btn btn-quiet"
                      aria-label={`Link photo to ${item.text}`}
                      disabled={Boolean(linkingItemId)}
                      onClick={() => void changeWorkItemLink(item, false)}
                    >
                      {linkingItemId === item.id ? 'Saving…' : 'Link photo'}
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        ) : null}
        <p className="meta-line" aria-live="polite">
          {linkStatus}
        </p>
      </section>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void saveNotes();
        }}
      >
        <label className="field">
          <span>Caption</span>
          <textarea
            name="caption"
            value={caption}
            onChange={(event) => {
              setCaption(event.target.value);
              setNotesState('idle');
            }}
          />
        </label>
        <label className="field">
          <span>Tags</span>
          <input
            name="tags"
            value={tags}
            onChange={(event) => {
              setTags(event.target.value);
              setNotesState('idle');
            }}
            placeholder="cabinet, finish"
          />
        </label>
        <button type="submit" className="btn btn-primary btn-block" disabled={notesState === 'saving'}>
          {notesState === 'saving' ? 'Saving photo notes…' : 'Save photo notes'}
        </button>
        {notesState === 'saved' ? <p className="verify-ok">Photo notes saved.</p> : null}
        {notesState === 'failed' ? (
          <p className="form-error">Photo notes were not saved. Try again.</p>
        ) : null}
      </form>

      <div className="verify-row">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={checkState === 'checking'}
          onClick={() => void checkSavedPhoto()}
        >
          {checkState === 'checking' ? 'Checking saved photo…' : 'Check saved photo'}
        </button>
        {checkState === 'pass' ? <span className="verify-ok">Saved photo matches.</span> : null}
        {checkState === 'fail' ? (
          <span className="verify-fail">Saved photo does not match the original record.</span>
        ) : null}
        {checkState === 'missing' ? (
          <span className="verify-fail">Saved photo could not be read.</span>
        ) : null}
      </div>

      <details>
        <summary>Photo details</summary>
        <div className="sealed-meta" style={{ margin: '12px 0' }}>
          <span className="meta-line">Captured {formatCaptureTime(photo.capturedAt)}</span>
          <span className="meta-line">
            {photo.lat !== undefined && photo.lon !== undefined
              ? `Location ${photo.lat.toFixed(5)}, ${photo.lon.toFixed(5)}${
                  photo.accuracy !== undefined ? ` · ${photo.accuracy} m accuracy` : ''
                }`
              : 'No location saved at capture'}
          </span>
          <span className="meta-line">
            {photo.width} × {photo.height} · {(photo.size / 1024).toFixed(0)} KB
          </span>
          <span className="meta-line">Full file fingerprint {photo.sha256}</span>
          {photo.voidedAt ? (
            <span className="meta-line void-stamp">
              Voided {formatCaptureTime(photo.voidedAt)} · {photo.voidReason || 'No reason saved'}
            </span>
          ) : null}
        </div>
      </details>

      {!photo.voidedAt && !voiding ? (
        <button type="button" className="btn btn-danger btn-block" onClick={() => setVoiding(true)}>
          Void this photo
        </button>
      ) : null}
      {!photo.voidedAt && voiding ? (
        <div>
          <label className="field">
            <span>Why should this photo be voided?</span>
            <textarea
              name="voidReason"
              value={voidReason}
              onChange={(event) => setVoidReason(event.target.value)}
              autoFocus
            />
          </label>
          <button
            type="button"
            className="btn btn-danger btn-block"
            disabled={!voidReason.trim()}
            onClick={() => void confirmVoid()}
          >
            Void photo and keep its record
          </button>
          {voidError ? <p className="form-error">{voidError}</p> : null}
        </div>
      ) : null}
    </Sheet>
  );
}
