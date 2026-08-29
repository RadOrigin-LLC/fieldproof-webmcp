import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { useSettings } from './data/useLive.ts';
import { Shell } from './ui/Shell.tsx';
import { Onboarding } from './ui/screens/Onboarding.tsx';
import { Projects } from './ui/screens/Projects.tsx';
import { ProjectDetail } from './ui/screens/ProjectDetail.tsx';
import { Capture } from './ui/screens/Capture.tsx';
import { More } from './ui/screens/More.tsx';
import { DayReport, EvidencePacket } from './ui/screens/Reports.tsx';

export function App() {
  const settings = useSettings();

  useEffect(() => {
    const theme = settings?.theme ?? 'system';
    const root = document.documentElement;
    if (theme === 'system') {
      const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.dataset.theme = dark ? 'dark' : 'light';
    } else {
      root.dataset.theme = theme;
    }
  }, [settings?.theme]);

  if (settings === undefined) return null; // Dexie still opening
  if (!settings.onboardedAt) return <Onboarding />;

  return (
    <Routes>
      {/* Print views live outside the shell — no chrome on paper. */}
      <Route path="report/:projectId/:date" element={<DayReport />} />
      <Route path="packet/:projectId" element={<EvidencePacket />} />
      <Route element={<Shell />}>
        <Route index element={<Projects />} />
        <Route path="project/:projectId" element={<ProjectDetail />} />
        <Route path="capture/:projectId?" element={<Capture />} />
        <Route path="more" element={<More />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
