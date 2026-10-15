import { lazy, Suspense } from 'react';
import { PageLoadBoundary } from './components/PageLoadBoundary';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { ThemeProvider } from './theme/ThemeContext';
import { CurrentCompetitionProvider } from './competition/CurrentCompetitionContext';
import { NavExtrasProvider } from './components/NavExtrasContext';
import { AgeGroupsProvider } from './components/AgeGroupsContext';
import { TickerProvider } from './components/TickerContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AppShell } from './components/AppShell';
import { StartPage } from './pages/StartPage';
import { CompetitionPage } from './pages/CompetitionPage';
import { SessionsTab } from './pages/competition/SessionsTab';
import './App.css';

const LoginPage = lazy(() => import('./pages/LoginPage').then((module) => ({ default: module.LoginPage })));
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((module) => ({ default: module.DashboardPage })));
const CompetitionsPage = lazy(() => import('./pages/CompetitionsPage').then((module) => ({ default: module.CompetitionsPage })));
const ScoringTab = lazy(() => import('./pages/competition/ScoringTab').then((module) => ({ default: module.ScoringTab })));
const SessionPage = lazy(() => import('./pages/competition/SessionPage').then((module) => ({ default: module.SessionPage })));
const TeamsTab = lazy(() => import('./pages/competition/TeamsTab').then((module) => ({ default: module.TeamsTab })));
const DeclarationsTab = lazy(() => import('./pages/competition/DeclarationsTab').then((module) => ({ default: module.DeclarationsTab })));
const ChatTab = lazy(() => import('./pages/competition/ChatTab').then((module) => ({ default: module.ChatTab })));
const DetailsTab = lazy(() => import('./pages/competition/DetailsTab').then((module) => ({ default: module.DetailsTab })));
const MyTeamsPage = lazy(() => import('./pages/MyTeamsPage').then((module) => ({ default: module.MyTeamsPage })));
const DeclarationsIndexPage = lazy(() => import('./pages/DeclarationsIndexPage').then((module) => ({ default: module.DeclarationsIndexPage })));
const ChatIndexPage = lazy(() => import('./pages/ChatIndexPage').then((module) => ({ default: module.ChatIndexPage })));
const AdminPage = lazy(() => import('./pages/AdminPage').then((module) => ({ default: module.AdminPage })));
const CompetitionEditor = lazy(() => import('./pages/admin/CompetitionEditor').then((module) => ({ default: module.CompetitionEditor })));
const FormatPage = lazy(() => import('./pages/admin/FormatPage').then((module) => ({ default: module.FormatPage })));
const RulesPage = lazy(() => import('./pages/admin/RulesPage').then((module) => ({ default: module.RulesPage })));
const ArenaPage = lazy(() => import('./pages/competition/ArenaPage').then((module) => ({ default: module.ArenaPage })));
const MySignupsPage = lazy(() => import('./pages/MySignupsPage').then((module) => ({ default: module.MySignupsPage })));

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <CurrentCompetitionProvider>
        <NavExtrasProvider>
        <AgeGroupsProvider>
        <TickerProvider>
        <BrowserRouter>
          <PageLoadBoundary page="app">
          <Suspense fallback={<p role="status" className="p-4 text-sm">Opening page…</p>}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<AppShell />}>
              <Route index element={<StartPage />} />
              <Route path="dashboard" element={<DashboardPage />} />
              <Route path="competitions" element={<CompetitionsPage />} />
              <Route path="competitions/past" element={<CompetitionsPage past />} />
              <Route path="competitions/:id" element={<CompetitionPage />}>
                <Route index element={<SessionsTab />} />
                <Route path="scoring" element={<ScoringTab />} />
                <Route path="toplists" element={<ScoringTab key="toplists" toplistOnly />} />
                <Route path="session/:sessionId" element={<SessionPage />} />
                <Route path="arena" element={<ArenaPage />} />
                <Route path="standings" element={<Navigate to="../scoring" replace />} />
                <Route path="teams" element={<TeamsTab />} />
                <Route path="declarations" element={<DeclarationsTab />} />
                <Route path="chat" element={<ChatTab />} />
                <Route path="details" element={<DetailsTab />} />
                <Route path="live" element={<Navigate to="../chat" replace />} />
              </Route>
              <Route path="teams" element={
                <ProtectedRoute><MyTeamsPage /></ProtectedRoute>
              } />
              <Route path="declarations" element={<DeclarationsIndexPage />} />
              <Route path="chat" element={<ChatIndexPage />} />
              <Route path="shop" element={<Navigate to="/" replace />} />
              <Route path="admin" element={
                <ProtectedRoute roles={['Admin']}><AdminPage /></ProtectedRoute>
              } />
              <Route path="admin/competitions/new" element={
                <ProtectedRoute roles={['Admin', 'Trainer']}><CompetitionEditor /></ProtectedRoute>
              } />
              <Route path="admin/competitions/:id" element={
                <ProtectedRoute roles={['Admin', 'Trainer']}><CompetitionEditor /></ProtectedRoute>
              } />
              <Route path="admin/competitions/:id/format" element={
                <ProtectedRoute roles={['Admin', 'Trainer']}><FormatPage /></ProtectedRoute>
              } />
              <Route path="admin/rules" element={
                <ProtectedRoute roles={['Admin']}><RulesPage /></ProtectedRoute>
              } />
              <Route path="me/signups" element={
                <ProtectedRoute><MySignupsPage /></ProtectedRoute>
              } />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
          </PageLoadBoundary>
        </BrowserRouter>
        </TickerProvider>
        </AgeGroupsProvider>
        </NavExtrasProvider>
        </CurrentCompetitionProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
