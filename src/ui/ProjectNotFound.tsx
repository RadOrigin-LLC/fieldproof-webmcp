import { Link } from 'react-router';

export function ProjectNotFound() {
  return (
    <section className="project-not-found">
      <h1>Project not found</h1>
      <p>This project may have been removed, or this link may be out of date.</p>
      <Link to="/" className="btn btn-secondary">
        Back to projects
      </Link>
    </section>
  );
}
