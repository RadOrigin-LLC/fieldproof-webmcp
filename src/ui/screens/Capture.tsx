import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { Photo, Project } from '../../domain/types.ts';
import { captureLocation, processImage } from '../../domain/image.ts';
import { getPhotoBytes, sealCapture, updatePhotoMeta } from '../../data/repo.ts';
import { useProjects, usePunch } from '../../data/useLive.ts';
import { isAiConfigured } from '../../ai/gemini.ts';
import { draftCaption } from '../../ai/caption.ts';
import { PhotoDetail } from '../PhotoDetail.tsx';

const LOW_STORAGE_BYTES = 50 * 1024 * 1024;

export function captureFailureMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : '';
  if (/quota|storage|disk full/i.test(`${name} ${message}`)) {
    return 'The photo was not saved because this device is out of storage. Free some space, then try again.';
  }
  return 'The photo was not saved. Try again, or import a photo from this device.';
}

export function storageNotice(estimate: Pick<StorageEstimate, 'quota' | 'usage'>): string {
  if (estimate.quota === undefined || estimate.usage === undefined) return '';
  const remaining = Math.max(0, estimate.quota - estimate.usage);
  if (remaining <= LOW_STORAGE_BYTES || estimate.usage / estimate.quota >= 0.9) {
    return 'This device is low on storage. Free some space before taking more photos.';
  }
  return '';
}

export type CaptureViewProps = {
  projects: readonly Project[];
  projectId: string;
  sealing: boolean;
  sealed: Photo | null;
  sealedUrl: string;
  caption: string;
  error: string;
  captionError: string;
  retryAvailable: boolean;
  online: boolean;
  storageWarning: string;
  aiReady: boolean;
  drafting: boolean;
  onProjectChange: (projectId: string) => void;
  onTakePhoto: () => void;
  onImportPhoto: () => void;
  onRetry: () => void;
  onCaptionChange: (caption: string) => void;
  onSuggestCaption: () => void;
  onDone: () => void;
  onNextPhoto: () => void;
  onOpenSavedPhoto: () => void;
  onStartProject: () => void;
};

export function CaptureView({
  projects,
  projectId,
  sealing,
  sealed,
  sealedUrl,
  caption,
  error,
  captionError,
  retryAvailable,
  online,
  storageWarning,
  aiReady,
  drafting,
  onProjectChange,
  onTakePhoto,
  onImportPhoto,
  onRetry,
  onCaptionChange,
  onSuggestCaption,
  onDone,
  onNextPhoto,
  onOpenSavedPhoto,
  onStartProject,
}: CaptureViewProps) {
  if (projects.length === 0) {
    return (
      <div className="empty-state">
        <p>No active projects yet.</p>
        <button type="button" className="btn btn-primary" onClick={onStartProject}>
          Create project
        </button>
      </div>
    );
  }

  const project = projects.find((item) => item.id === projectId);
  const savedProject = sealed
    ? projects.find((item) => item.id === sealed.projectId) ?? project
    : project;
  const selectionLocked = sealing || sealed !== null;

  return (
    <div className="capture-stage">
      <h1 className="screen-title">Capture</h1>
      <label className="field">
        <span>Project</span>
        <select
          value={projectId}
          disabled={selectionLocked}
          onChange={(event) => onProjectChange(event.target.value)}
        >
          {projects.map((item) => (
            <option key={item.id} value={item.id}>{item.name}</option>
          ))}
        </select>
      </label>

      {!sealed ? (
        <>
          {project ? (
            <p className="capture-project-note">Saving to <strong>{project.name}</strong></p>
          ) : (
            <p className="form-error">Choose a project before taking a photo.</p>
          )}
          {!online ? <p className="capture-notice">Offline. Photos can still be saved on this device.</p> : null}
          {storageWarning ? <p className="form-error">{storageWarning}</p> : null}
          <div className="capture-actions">
            <button type="button" className="btn btn-capture" disabled={!project || sealing} onClick={onTakePhoto}>
              {sealing ? 'Saving photo…' : 'Take photo'}
            </button>
            <button type="button" className="btn btn-secondary" disabled={!project || sealing} onClick={onImportPhoto}>
              Import photo
            </button>
          </div>
          <p className="capture-hint">If camera access is blocked, import a photo from this device.</p>
          {error ? <p className="form-error">{error}</p> : null}
          {error && retryAvailable ? (
            <button type="button" className="btn btn-secondary" disabled={sealing} onClick={onRetry}>Try again</button>
          ) : null}
        </>
      ) : (
        <section className="capture-saved-card" aria-label="Saved photo">
          {sealedUrl ? (
            <img src={sealedUrl} alt={caption.trim() || 'Saved job photo'} />
          ) : (
            <div className="capture-saved-preview" role="img" aria-label="Saved job photo" />
          )}
          <div className="capture-saved-meta">
            <strong>Your photo, date, and photo ID were saved.</strong>
            {savedProject ? <span className="meta-line">Saved to {savedProject.name}</span> : null}
            <span className="meta-line">
              {sealed.lat === undefined
                ? 'No location was available. Your photo was still saved.'
                : 'Location was saved with the photo.'}
            </span>
          </div>
          <button id="open-saved-photo" type="button" className="btn btn-secondary" onClick={onOpenSavedPhoto}>
            Open saved photo
          </button>
          <label className="field">
            <span>Caption (optional)</span>
            <input
              value={caption}
              onChange={(event) => onCaptionChange(event.target.value)}
              placeholder="North wall, before drywall"
              autoFocus
            />
          </label>
          {aiReady ? (
            <div className="scan-row">
              <button type="button" className="btn btn-quiet" disabled={drafting} onClick={onSuggestCaption}>
                {drafting ? 'Drafting…' : 'Draft a caption'}
              </button>
              <p className="ai-note">AI suggests the caption. The saved photo stays unchanged.</p>
            </div>
          ) : null}
          {captionError ? <p className="form-error">{captionError}</p> : null}
          <div className="capture-saved-actions">
            <button type="button" className="btn btn-primary" onClick={onDone}>Done</button>
            <button type="button" className="btn btn-secondary" onClick={onNextPhoto}>Next photo</button>
          </div>
        </section>
      )}
    </div>
  );
}

export function Capture() {
  const { projectId: routeProjectId } = useParams();
  const navigate = useNavigate();
  const projects = useProjects();
  const [projectId, setProjectId] = useState(routeProjectId ?? '');
  const [sealing, setSealing] = useState(false);
  const [sealed, setSealed] = useState<Photo | null>(null);
  const [sealedUrl, setSealedUrl] = useState('');
  const [caption, setCaption] = useState('');
  const [error, setError] = useState('');
  const [captionError, setCaptionError] = useState('');
  const [retry, setRetry] = useState<{ file: File; projectId: string } | null>(null);
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false);
  const [storageWarning, setStorageWarning] = useState('');
  const [aiReady, setAiReady] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [photoDetailOpen, setPhotoDetailOpen] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const linkedItems = usePunch(sealed?.projectId ?? projectId);

  useEffect(() => { void isAiConfigured().then(setAiReady); }, []);

  useEffect(() => {
    if (!projects || projects.length === 0) return;
    if (!projects.some((project) => project.id === projectId)) setProjectId(projects[0]!.id);
  }, [projects, projectId]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  useEffect(() => {
    void navigator.storage?.estimate?.().then((estimate) => setStorageWarning(storageNotice(estimate)));
  }, []);

  useEffect(() => () => {
    if (sealedUrl) URL.revokeObjectURL(sealedUrl);
  }, [sealedUrl]);

  async function suggestCaption() {
    if (!sealed) return;
    setDrafting(true);
    setCaptionError('');
    try {
      const blob = await getPhotoBytes(sealed.id);
      if (!blob) throw new Error('Photo bytes not found.');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      setCaption(await draftCaption({ mimeType: 'image/jpeg', bytes }));
    } catch {
      setCaptionError('A caption could not be drafted. You can type one instead.');
    } finally {
      setDrafting(false);
    }
  }

  async function saveFile(file: File, targetProjectId: string) {
    const target = projects?.find((project) => project.id === targetProjectId);
    if (!target) {
      setError('Choose an active project before taking a photo.');
      return;
    }
    setError('');
    setCaptionError('');
    setSealing(true);
    setSealed(null);
    setCaption('');
    setRetry({ file, projectId: targetProjectId });

    let processed: Awaited<ReturnType<typeof processImage>>;
    let photo: Photo;
    try {
      const [image, location] = await Promise.all([processImage(file), captureLocation()]);
      processed = image;
      const bytes = new Uint8Array(await processed.blob.arrayBuffer());
      photo = await sealCapture({
        projectId: targetProjectId,
        bytes,
        width: processed.width,
        height: processed.height,
        lat: location?.lat,
        lon: location?.lon,
        accuracy: location?.accuracy,
      });
    } catch (caught) {
      setError(captureFailureMessage(caught));
      setSealing(false);
      return;
    }

    setSealed(photo);
    setRetry(null);
    setSealing(false);
    try {
      setSealedUrl(URL.createObjectURL(processed.blob));
    } catch {
      setSealedUrl('');
    }
    try {
      navigator.vibrate?.(30);
    } catch {
      // The photo is already saved. Optional device feedback cannot change that result.
    }
    void navigator.storage?.estimate?.().then((estimate) => setStorageWarning(storageNotice(estimate)));
  }

  async function saveCaption(): Promise<boolean> {
    if (!sealed) return false;
    setCaptionError('');
    try {
      if (caption.trim()) await updatePhotoMeta(sealed.id, { caption: caption.trim() });
      setPhotoDetailOpen(false);
      setSealed(null);
      setSealedUrl('');
      setCaption('');
      return true;
    } catch {
      setCaptionError('The caption was not saved. Your text is still here. Try again.');
      return false;
    }
  }

  const projectName = projects?.find((project) => project.id === sealed?.projectId)?.name ?? 'Project';

  return (
    <>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void saveFile(file, projectId);
          event.target.value = '';
        }}
      />
      <input
        ref={importRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void saveFile(file, projectId);
          event.target.value = '';
        }}
      />
      <CaptureView
        projects={projects ?? []}
        projectId={projectId}
        sealing={sealing}
        sealed={sealed}
        sealedUrl={sealedUrl}
        caption={caption}
        error={error}
        captionError={captionError}
        retryAvailable={retry !== null}
        online={online}
        storageWarning={storageWarning}
        aiReady={aiReady}
        drafting={drafting}
        onProjectChange={(nextProjectId) => {
          setProjectId(nextProjectId);
          setError('');
        }}
        onTakePhoto={() => cameraRef.current?.click()}
        onImportPhoto={() => importRef.current?.click()}
        onRetry={() => { if (retry) void saveFile(retry.file, retry.projectId); }}
        onCaptionChange={(value) => {
          setCaption(value);
          setCaptionError('');
        }}
        onSuggestCaption={() => void suggestCaption()}
        onDone={() => void saveCaption()}
        onNextPhoto={() => {
          void saveCaption().then((saved) => { if (saved) cameraRef.current?.click(); });
        }}
        onOpenSavedPhoto={() => setPhotoDetailOpen(true)}
        onStartProject={() => navigate('/')}
      />
      {sealed && photoDetailOpen ? (
        <PhotoDetail
          photo={sealed}
          projectName={projectName}
          workdayDate={sealed.capturedAt.slice(0, 10)}
          linkedItems={(linkedItems ?? []).filter((item) => item.photoIds.includes(sealed.id))}
          returnFocusId="open-saved-photo"
          onClose={() => setPhotoDetailOpen(false)}
        />
      ) : null}
    </>
  );
}
