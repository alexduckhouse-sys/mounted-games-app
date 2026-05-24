import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { ThemeProvider } from './theme/ThemeContext';
import { CurrentCompetitionProvider } from './competition/CurrentCompetitionContext';
import { NavExtrasProvider } from './components/NavExtrasContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AppShell } from './components/AppShell';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { CompetitionsPage } from './pages/CompetitionsPage';
import { CompetitionPage } from './pages/CompetitionPage';
import { SessionsTab } from './pages/competition/SessionsTab';
import { ScoringTab } from './pages/competition/ScoringTab';
import { SessionPage } from './pages/competition/SessionPage';
import { TeamsTab } from './pages/competition/TeamsTab';
import { DeclarationsTab } from './pages/competition/DeclarationsTab';
import { ChatTab } from './pages/competition/ChatTab';
import { DetailsTab } from './pages/competition/DetailsTab';
import { MyTeamsPage } from './pages/MyTeamsPage';
import { DeclarationsIndexPage } from './pages/DeclarationsIndexPage';
import { ChatIndexPage } from './pages/ChatIndexPage';
import { AdminPage } from './pages/AdminPage';
import { CompetitionEditor } from './pages/admin/CompetitionEditor';
import { RulesPage } from './pages/admin/RulesPage';
import { ArenaPage } from './pages/competition/ArenaPage';
import './App.css';

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <CurrentCompetitionProvider>
        <NavExtrasProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<AppShell />}>
              <Route index element={<DashboardPage />} />
              <Route path="competitions" element={<CompetitionsPage />} />
              <Route path="competitions/:id" element={<CompetitionPage />}>
                <Route index element={<SessionsTab />} />
                <Route path="scoring" element={<ScoringTab />} />
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
                <ProtectedRoute roles={['Trainer', 'Admin']}><MyTeamsPage /></ProtectedRoute>
              } />
              <Route path="declarations" element={<DeclarationsIndexPage />} />
              <Route path="chat" element={<ChatIndexPage />} />
              <Route path="admin" element={
                <ProtectedRoute roles={['Admin']}><AdminPage /></ProtectedRoute>
              } />
              <Route path="admin/competitions/new" element={
                <ProtectedRoute roles={['Admin']}><CompetitionEditor /></ProtectedRoute>
              } />
              <Route path="admin/competitions/:id" element={
                <ProtectedRoute roles={['Admin']}><CompetitionEditor /></ProtectedRoute>
              } />
              <Route path="admin/rules" element={
                <ProtectedRoute roles={['Admin']}><RulesPage /></ProtectedRoute>
              } />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
        </NavExtrasProvider>
        </CurrentCompetitionProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
