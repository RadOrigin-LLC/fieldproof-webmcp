import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { isDemoProject } from '../../demo/seed.ts';
import { addProject } from '../../data/repo.ts';
import { useProjectSummaries } from '../../data/useLive.ts';
import type { ProjectSummary } from '../../domain/projects.ts';
import { DemoLoadButton } from '../DemoActions.tsx';
import { HANDOFF_STATUS_LABELS } from '../handoffLabels.ts';
import { IconPlus } from '../icons.tsx';
import { Sheet } from '../Sheet.tsx';

export type ProjectFormValues = {
  name: string;
  client: string;
  address: string;
  startDate: string;
};

export type ProjectFormViewProps = {
  values: ProjectFormValues;
  error: string;
  busy: boolean;
  submitLabel: string;
  onChange: (field: keyof ProjectFormValues, value: string) => void;
  onSubmit: () => void;
};

export function ProjectFormView({
  values,
  error,
  busy,
  submitLabel,
  onChange,
  onSubmit,
}: ProjectFormViewProps) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <label className="field">
        <span>Project name</span>
        <input
          value={values.name}
          onChange={(event) => onChange('name', event.target.value)}
          placeholder="Maple Street kitchen remodel"
          autoFocus
        />
      </label>
      <label className="field">
        <span>Client (optional)</span>
        <input
          value={values.client}
          onChange={(event) => onChange('client', event.target.value)}
          placeholder="The Harpers"
        />
      </label>
      <label className="field">
        <span>Job site (optional)</span>
        <input
          value={values.address}
          onChange={(event) => onChange('address', event.target.value)}
          placeholder="125 Maple Street"
        />
      </label>
      <label className="field">
        <span>Start date (optional)</span>
        <input
          type="date"
          value={values.startDate}
          onChange={(event) => onChange('startDate', event.target.value)}
        />
      </label>
      <p className="empty-sub">You can add or change these details later.</p>
      {error ? <p className="form-error">{error}</p> : null}
      <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
        {busy ? 'Saving project…' : submitLabel}
      </button>
    </form>
  );
}

export function Projects() {
  const navigate = useNavigate();
  const summaries = useProjectSummaries();
  const [adding, setAdding] = useState(false);

  return (
    <div>
      <header className="screen-head">
        <h1 className="screen-title">Projects</h1>
        <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
          <IconPlus /> New
        </button>
      </header>

      <section className="demo-entry demo-entry-row">
        <div>
          <span className="section-label">Maple Street Kitchen sample</span>
          <p>Its people, places, records, and photos are synthetic. Your projects stay unchanged.</p>
        </div>
        <DemoLoadButton
          label="Open sample"
          onLoaded={(projectId) => navigate(`/project/${projectId}`)}
        />
      </section>

      {summaries && summaries.length === 0 ? (
        <div className="empty-state">
          <p>No projects yet.</p>
          <p className="empty-sub">
            Create one project for each job site. Keep its photos, work items, and daily records
            together.
          </p>
        </div>
      ) : null}

      <div className="project-list">
        {(summaries ?? []).map((summary) => (
          <ProjectCard key={summary.project.id} summary={summary} />
        ))}
      </div>

      {adding ? (
        <NewProject
          onClose={() => setAdding(false)}
          onSaved={(projectId) => navigate(`/project/${projectId}`)}
        />
      ) : null}
    </div>
  );
}

function formatWorkday(value: string | undefined): string {
  if (!value) return 'No workdays yet';
  return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function ProjectCard({ summary }: { summary: ProjectSummary }) {
  const { project } = summary;
  const workProgress =
    summary.totalItemCount === 0
      ? 'No work items yet'
      : `${summary.completedItemCount} of ${summary.totalItemCount} work items complete`;

  return (
    <Link to={`/project/${project.id}`} className="project-card" style={{ textDecoration: 'none' }}>
      <span className="project-card-name">{project.name}</span>
      <span className="project-card-meta">
        {isDemoProject(project) ? <span className="demo-badge">Sample project</span> : null}
        {project.status === 'archived' ? <span className="demo-badge">Archived</span> : null}
        {project.client ? <span>{project.client}</span> : null}
        <span>Latest workday: {formatWorkday(summary.latestWorkday)}</span>
        <span className="num">
          {summary.activePhotoCount} {summary.activePhotoCount === 1 ? 'photo' : 'photos'}
        </span>
        <span>{workProgress}</span>
        <span>{HANDOFF_STATUS_LABELS[summary.handoffPhase]}</span>
      </span>
    </Link>
  );
}

const EMPTY_PROJECT_FORM: ProjectFormValues = {
  name: '',
  client: '',
  address: '',
  startDate: '',
};

function NewProject({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (projectId: string) => void;
}) {
  const [values, setValues] = useState<ProjectFormValues>(EMPTY_PROJECT_FORM);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
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
      onClose();
      onSaved(project.id);
    } catch {
      setError('The project was not saved. Your details are still here. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="New project" onClose={onClose}>
      <ProjectFormView
        values={values}
        error={error}
        busy={busy}
        submitLabel="Open Workday Ledger"
        onChange={(field, value) => {
          setValues((current) => ({ ...current, [field]: value }));
          setError('');
        }}
        onSubmit={() => void submit()}
      />
    </Sheet>
  );
}
