import { useState } from 'react';
import { useNavigate } from 'react-router';
import { addProject, saveSettings } from '../../data/repo.ts';
import { DemoLoadButton } from '../DemoActions.tsx';
import { ProjectFormView, type ProjectFormValues } from './Projects.tsx';

const EMPTY_PROJECT: ProjectFormValues = {
  name: '',
  client: '',
  address: '',
  startDate: '',
};

export function Onboarding() {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [values, setValues] = useState<ProjectFormValues>(EMPTY_PROJECT);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function finish() {
    if (!values.name.trim()) {
      setError('The project needs a name.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const project = await addProject(values.name, values.client || undefined, {
        address: values.address || undefined,
        startDate: values.startDate || undefined,
      });
      await saveSettings({ onboardedAt: new Date().toISOString() });
      navigate(`/project/${project.id}`);
    } catch {
      setError('The project was not saved. Your details are still here. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="onboarding">
      {!creating ? (
        <div className="onboarding-step">
          <span className="onboarding-brand">FieldProof</span>
          <h1 className="onboarding-title">Keep a clear job record.</h1>
          <p className="onboarding-sub">
            Save job photos and keep their original record protected. Each photo stays with the
            project where you took it.
          </p>
          <p className="onboarding-sub">
            Keep photos, work items, and daily records together. When the job is ready, open a
            Handoff Packet for your client.
          </p>
          <button
            type="button"
            className="btn btn-primary btn-block"
            onClick={() => setCreating(true)}
          >
            Create project
          </button>
          <div className="demo-entry">
            <span className="section-label">Maple Street Kitchen sample</span>
            <p>Its people, places, records, and photos are synthetic.</p>
            <DemoLoadButton
              label="Open sample"
              className="btn btn-secondary btn-block"
              onLoaded={async (projectId) => {
                await saveSettings({ onboardedAt: new Date().toISOString() });
                navigate(`/project/${projectId}`);
              }}
            />
          </div>
        </div>
      ) : (
        <div className="onboarding-step">
          <h1 className="onboarding-title">What is the job?</h1>
          <ProjectFormView
            values={values}
            error={error}
            busy={busy}
            submitLabel="Open Workday Ledger"
            onChange={(field, value) => {
              setValues((current) => ({ ...current, [field]: value }));
              setError('');
            }}
            onSubmit={() => void finish()}
          />
        </div>
      )}
    </div>
  );
}
