import { useState } from 'react';
import { loadDemoProject, resetDemoProject } from '../demo/seed.ts';

export function DemoLoadButton({
  onLoaded,
  label = 'Try the handoff demo',
  className = 'btn btn-secondary',
}: {
  onLoaded: (projectId: string) => void | Promise<void>;
  label?: string;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  return (
    <>
      <button
        type="button"
        className={className}
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError('');
          void loadDemoProject()
            .then((result) => onLoaded(result.projectId))
            .catch((caught) => {
              setError(caught instanceof Error ? caught.message : 'The demo could not be loaded.');
            })
            .finally(() => setBusy(false));
        }}
      >
        {busy ? 'Loading demo…' : label}
      </button>
      {error && <p className="form-error">{error}</p>}
    </>
  );
}

export function DemoResetButton({ onReset }: { onReset: (reset: boolean) => void }) {
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      className="btn btn-quiet"
      disabled={busy}
      onClick={() => {
        if (!window.confirm('Reset the sample Maple Street project? Your other projects will stay unchanged.')) return;
        setBusy(true);
        void resetDemoProject()
          .then(onReset)
          .finally(() => setBusy(false));
      }}
    >
      {busy ? 'Resetting demo…' : 'Reset demo project'}
    </button>
  );
}
