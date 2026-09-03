import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { Settings } from '../../domain/types.ts';
import { exportFileName } from '../../domain/export.ts';
import {
  exportAllZip,
  importFromZip,
  saveSettings,
} from '../../data/repo.ts';
import { useAllProjects, useSettings } from '../../data/useLive.ts';
import { getGeminiKey, setGeminiKey } from '../../ai/gemini.ts';
import { DemoLoadButton, DemoResetButton } from '../DemoActions.tsx';

export function More() {
  const navigate = useNavigate();
  const settings = useSettings();
  const [notice, setNotice] = useState('');

  if (!settings) return null;

  return (
    <div>
      <h1 className="screen-title">More</h1>

      <section className="settings-group" aria-label="Appearance">
        <h2 className="section-title">Appearance</h2>
        <div className="segmented">
          {(['system', 'light', 'dark'] as Settings['theme'][]).map((t) => (
            <button
              key={t}
              type="button"
              className={`segment${settings.theme === t ? ' active' : ''}`}
              onClick={() => void saveSettings({ theme: t })}
            >
              {t[0]!.toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </section>

      <ArchivedProjects />

      <section className="settings-group" aria-label="Handoff demo">
        <h2 className="section-title">Handoff demo</h2>
        <p className="settings-note">
          The Maple Street project contains sample photos and records. It leaves your other projects
          unchanged.
        </p>
        <div className="settings-actions">
          <DemoLoadButton
            label="Open demo project"
            className="btn btn-secondary"
            onLoaded={(projectId) => navigate(`/project/${projectId}`)}
          />
          <DemoResetButton
            onReset={(reset) => setNotice(reset ? 'Demo project reset.' : 'No valid demo project was found.')}
          />
        </div>
      </section>

      <section className="settings-group" aria-label="Your data">
        <h2 className="section-title">Your data</h2>
        <p className="settings-note">
          Everything lives on this device. The backup includes project details, logs, punch lists,
          and every saved photo. Photo checks still work after a restore.
        </p>
        <ExportImport onNotice={setNotice} />
        <StoragePanel />
      </section>

      <AiSection />

      <section className="settings-group" aria-label="About">
        <h2 className="section-title">About</h2>
        <p className="settings-note">
          FieldProof keeps job-site photos and records on your device. It needs no account or cloud
          sync, and it never contacts your clients. Its reports document the job. They do not certify
          the work.
        </p>
      </section>

      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
    </div>
  );
}

function ArchivedProjects() {
  const all = useAllProjects();
  const archived = (all ?? []).filter((p) => p.status === 'archived');
  if (archived.length === 0) return null;
  return (
    <section className="settings-group" aria-label="Archived projects">
      <h2 className="section-title">Archived projects</h2>
      {archived.map((p) => (
        <div key={p.id} className="settings-row">
          <span>{p.name}</span>
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => {
              void import('../../data/repo.ts').then((m) => m.updateProject(p.id, { status: 'active' }));
            }}
          >
            Restore
          </button>
        </div>
      ))}
    </section>
  );
}

function ExportImport({ onNotice }: { onNotice: (s: string) => void }) {
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function doExport() {
    setBusy(true);
    try {
      const zip = await exportAllZip();
      const blob = new Blob([new Uint8Array(zip.bytes).buffer as ArrayBuffer], {
        type: 'application/zip',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = exportFileName(new Date());
      a.click();
      URL.revokeObjectURL(url);
      onNotice('Your backup is ready in Downloads.');
    } finally {
      setBusy(false);
    }
  }

  async function doImport(file: File) {
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await importFromZip(bytes);
      onNotice(result.mode === 'restore' ? 'Backup restored.' : 'Backup merged.');
    } catch (e) {
      onNotice(e instanceof Error ? e.message : 'That file is not a FieldProof backup.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="settings-actions">
      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void doExport()}>
        Export everything
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".zip,application/zip"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void doImport(f);
        }}
      />
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => fileRef.current?.click()}>
        Import a backup
      </button>
    </div>
  );
}

function StoragePanel() {
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [usage, setUsage] = useState('');

  useEffect(() => {
    void navigator.storage?.persisted?.().then(setPersisted);
    void navigator.storage?.estimate?.().then((e) => {
      if (e.usage !== undefined) setUsage(`${(e.usage / 1024 / 1024).toFixed(1)} MB used`);
    });
  }, []);

  return (
    <div className="storage-panel">
      <span className="meta-line">
        {persisted === true
          ? '✓ Your browser is set to keep FieldProof data.'
          : persisted === false
            ? 'Your browser may clear this data when storage runs low.'
            : 'Checking storage…'}
        {usage && ` · ${usage}`}
      </span>
      {persisted === false && (
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            void navigator.storage?.persist?.().then(setPersisted);
          }}
        >
          Ask the browser to keep it
        </button>
      )}
    </div>
  );
}

function AiSection() {
  const [saved, setSaved] = useState(false);
  const [key, setKey] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    void getGeminiKey().then((k) => setSaved(k !== null));
  }, []);

  return (
    <section className="settings-group" aria-label="Writing help">
      <h2 className="section-title">Writing help</h2>
      <p className="settings-note">
        Optional: use Google Gemini to suggest photo captions and turn rough notes into daily records.
        Add your own Gemini API key below to enable the draft buttons. The browser agent and handoff
        demo work without this key.
      </p>
      <p className="settings-note">
        When you request a caption, the selected photo is sent to Google. For a daily record, your
        notes and that day's photo captions are sent instead. Nothing is sent until you request a
        draft. Review and edit it before saving.
      </p>
      {saved ? (
        <div className="settings-row">
          <span>✓ Key saved on this device</span>
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => {
              void setGeminiKey(null).then(() => setSaved(false));
            }}
          >
            Remove
          </button>
        </div>
      ) : (
        <div className="settings-actions">
          <input
            className="key-input"
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Gemini API key"
            aria-label="Gemini API key"
          />
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!key.trim()}
            onClick={() => {
              void setGeminiKey(key.trim()).then(() => {
                setSaved(true);
                setKey('');
                setNotice('Key saved on this device. Caption and log draft buttons are ready.');
              });
            }}
          >
            Save
          </button>
        </div>
      )}
      {notice && <p className="settings-note">{notice}</p>}
    </section>
  );
}
