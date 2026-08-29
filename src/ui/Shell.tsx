import { NavLink, Outlet, useLocation } from 'react-router';
import { IconCapture, IconMore, IconProjects } from './icons.tsx';

export function Shell() {
  const loc = useLocation();
  // Carry the current project into capture when we're inside one.
  const projectMatch = /^\/project\/([^/]+)/.exec(loc.pathname);
  const captureTo = projectMatch ? `/capture/${projectMatch[1]}` : '/capture';

  return (
    <div className="shell">
      <main className={`shell-main${projectMatch ? ' shell-main-project' : ''}`}>
        <Outlet />
      </main>
      <nav className="tabbar" aria-label="Main">
        <NavLink to="/" end className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>
          <IconProjects />
          <span>Projects</span>
        </NavLink>
        <NavLink
          to={captureTo}
          className={({ isActive }) => `tab tab-capture${isActive ? ' active' : ''}`}
        >
          <IconCapture />
          <span>Capture</span>
        </NavLink>
        <NavLink to="/more" className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>
          <IconMore />
          <span>More</span>
        </NavLink>
      </nav>
    </div>
  );
}
