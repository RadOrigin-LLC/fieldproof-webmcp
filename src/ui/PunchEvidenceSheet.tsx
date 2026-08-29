import { useEffect, useState } from 'react';
import {
  attachPhoto,
  clearProofException,
  detachPhoto,
  setProofException,
} from '../domain/punch.ts';
import type { Photo, PunchItem } from '../domain/types.ts';
import { savePunchItem } from '../data/repo.ts';
import { PhotoDetail } from './PhotoDetail.tsx';
import { Sheet } from './Sheet.tsx';
import { usePhotoUrl } from './usePhotoUrl.ts';

function PhotoProofRow({
  item,
  photo,
  onPreview,
  onChange,
}: {
  item: PunchItem;
  photo: Photo;
  onPreview: () => void;
  onChange: (item: PunchItem) => void;
}) {
  const url = usePhotoUrl(photo.id);
  const linked = item.photoIds.includes(photo.id);

  return (
    <div className="proof-photo-row">
      {url ? (
        <img src={url} alt={photo.caption ?? 'Project photo'} />
      ) : (
        <div className="proof-photo-placeholder" aria-hidden="true" />
      )}
      <div className="proof-photo-copy">
        <strong>{photo.caption?.trim() || 'Uncaptioned project photo'}</strong>
        <span className="meta-line">{new Date(photo.capturedAt).toLocaleString()}</span>
      </div>
      <div className="proof-photo-actions">
        <button
          id={`proof-preview-${item.id}-${photo.id}`}
          type="button"
          className="btn btn-quiet"
          onClick={onPreview}
        >
          Preview
        </button>
        <button
          type="button"
          className={linked ? 'btn btn-secondary' : 'btn btn-quiet'}
          onClick={() => {
            const next = linked ? detachPhoto(item, photo.id) : attachPhoto(item, photo.id);
            onChange(next);
          }}
        >
          {linked ? 'Remove' : 'Link'}
        </button>
      </div>
    </div>
  );
}

export function PunchEvidenceSheet({
  item,
  photos,
  projectName = 'This project',
  onClose,
}: {
  item: PunchItem;
  photos: Photo[];
  projectName?: string;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [currentItem, setCurrentItem] = useState(item);
  const activePhotos = photos.filter((photo) => !photo.voidedAt);
  const previewPhoto = photos.find((photo) => photo.id === previewId && !photo.voidedAt);

  useEffect(() => setCurrentItem(item), [item]);

  function saveCurrentItem(next: PunchItem) {
    setCurrentItem(next);
    void savePunchItem(next);
  }

  return (
    <Sheet title={`Photos for ${item.text}`} onClose={onClose}>
      <p className="proof-help">
        Choose the photos that show this work. You make the final call.
      </p>

      <h3 className="section-label">Job photos</h3>
      {activePhotos.length > 0 ? (
        <div className="proof-photo-list">
          {activePhotos.map((photo) => (
            <PhotoProofRow
              key={photo.id}
              item={currentItem}
              photo={photo}
              onPreview={() => setPreviewId(photo.id)}
              onChange={saveCurrentItem}
            />
          ))}
        </div>
      ) : (
        <p className="empty-sub">No current job photos are available.</p>
      )}

      <hr className="rule" />
      <h3 className="section-label">Explain why no photo is needed</h3>
      {currentItem.proofException ? (
        <div className="proof-exception">
          <p>{currentItem.proofException.reason}</p>
          <span className="meta-line">
            Recorded {new Date(currentItem.proofException.recordedAt).toLocaleString()}
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-block"
            onClick={() => saveCurrentItem(clearProofException(currentItem))}
          >
            Clear reason
          </button>
        </div>
      ) : (
        <>
          <p className="proof-help">
            Use this when the completed work does not need a photo. Your reason stays in the handoff
            packet.
          </p>
          <label className="field">
            <span>Your reason</span>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Existing finish was outside the signed work scope."
            />
          </label>
          <button
            type="button"
            className="btn btn-secondary btn-block"
            disabled={!reason.trim()}
            onClick={() => {
              saveCurrentItem(setProofException(currentItem, reason));
              setReason('');
            }}
          >
            Save reason
          </button>
        </>
      )}
      {previewPhoto ? (
        <PhotoDetail
          photo={previewPhoto}
          projectName={projectName}
          workdayDate={previewPhoto.capturedAt.slice(0, 10)}
          linkedItems={currentItem.photoIds.includes(previewPhoto.id) ? [currentItem] : []}
          projectItems={[currentItem]}
          returnFocusId={`proof-preview-${item.id}-${previewPhoto.id}`}
          onClose={() => setPreviewId(null)}
        />
      ) : null}
    </Sheet>
  );
}
