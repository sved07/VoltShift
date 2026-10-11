import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './layouts/AppShell';
import { AnalyticsPage } from './routes/AnalyticsPage';
import { AuditPage } from './routes/AuditPage';
import { OverviewPage } from './routes/OverviewPage';

// Mapbox GL (~1.7 MB) is only needed on /sites — load it with the route.
const SitesPage = lazy(() => import('./routes/SitesPage').then((m) => ({ default: m.SitesPage })));

/** Route table. Rendered inside a router (BrowserRouter in main.tsx, MemoryRouter in tests). */
export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<OverviewPage />} />
        <Route
          path="sites"
          element={
            <Suspense fallback={<div className="glass mx-auto h-[60vh] max-w-7xl" aria-busy="true" />}>
              <SitesPage />
            </Suspense>
          }
        />
        <Route path="audit" element={<AuditPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
