import { lazy, Suspense } from 'react';
import { PageLoadBoundary } from './components/PageLoadBoundary';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { NeedsYouProvider } from './pages/profile/NeedsYouProvider';
import { ThemeProvider } from './theme/ThemeContext';
import { LiteModeProvider } from './lite/LiteModeContext';
import { LiteMotionConfig } from './lite/LiteMotionConfig';
import { CurrentCompetitionProvider } from './competition/CurrentCompetitionContext';
import { NavExtrasProvider } from './components/NavExtrasContext';
import { AgeGroupsProvider } from './components/AgeGroupsContext';
import { TickerProvider } from './components/TickerContext';
import { ConnectionStatusProvider } from './live/ConnectionStatusContext';
import { CompetitionMetaProvider } from './components/CompetitionMetaContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AppShell } from './components/AppShell';
import { CompactPageBarProvider } from './components/CompactPageBarContext';
import { StartPage } from './pages/StartPage';
import { CompetitionPage } from './pages/CompetitionPage';
import { AfterDrawOnly, CompetitionHome } from './pages/competition/CompetitionHome';
import { ScrollToTop } from './components/ScrollToTop';
import './App.css';

const LoginPage = lazy(() => import('./pages/LoginPage').then((module) => ({ default: module.LoginPage })));
const SignUpPage = lazy(() => import('./pages/SignUpPage').then((module) => ({ default: module.SignUpPage })));
const ProfilePage = lazy(() => import('./pages/ProfilePage').then((module) => ({ default: module.ProfilePage })));
const MembersPage = lazy(() => import('./pages/MembersPage').then((module) => ({ default: module.MembersPage })));
const PayoutsPage = lazy(() => import('./pages/PayoutsPage').then((module) => ({ default: module.PayoutsPage })));
const CompetitionsPage = lazy(() => import('./pages/CompetitionsPage').then((module) => ({ default: module.CompetitionsPage })));
const ScoringTab = lazy(() => import('./pages/competition/ScoringTab').then((module) => ({ default: module.ScoringTab })));
const TvKioskPage = lazy(() => import('./pages/competition/TvKioskPage').then((module) => ({ default: module.TvKioskPage })));
const CommentaryDeskPage = lazy(() => import('./pages/competition/CommentaryDeskPage').then((module) => ({ default: module.CommentaryDeskPage })));
const SessionPage = lazy(() => import('./pages/competition/SessionPage').then((module) => ({ default: module.SessionPage })));
const TeamsTab = lazy(() => import('./pages/competition/TeamsTab').then((module) => ({ default: module.TeamsTab })));
const CompetitionTeamPage = lazy(() => import('./pages/competition/CompetitionTeamPage').then((module) => ({ default: module.CompetitionTeamPage })));
const DeclarationsTab = lazy(() => import('./pages/competition/DeclarationsTab').then((module) => ({ default: module.DeclarationsTab })));
const BroadcastPage = lazy(() => import('./pages/competition/BroadcastPage').then((module) => ({ default: module.BroadcastPage })));
const ProducePage = lazy(() => import('./pages/competition/ProducePage').then((module) => ({ default: module.ProducePage })));
const ChatTab = lazy(() => import('./pages/competition/ChatTab').then((module) => ({ default: module.ChatTab })));
const EntryPage = lazy(() => import('./pages/competition/EntryPage').then((module) => ({ default: module.EntryPage })));
const SectionEntryPage = lazy(() => import('./pages/competition/DetailsTab').then((module) => ({ default: module.SectionEntryPage })));
const DetailsTab = lazy(() => import('./pages/competition/DetailsTab').then((module) => ({ default: module.DetailsTab })));
const FollowingPage = lazy(() => import('./pages/FollowingPage').then((module) => ({ default: module.FollowingPage })));
const SponsorsPage = lazy(() => import('./pages/competition/SponsorsPage').then((module) => ({ default: module.SponsorsPage })));
const FollowingTab = lazy(() => import('./pages/competition/FollowingTab').then((module) => ({ default: module.FollowingTab })));
const MyTeamsPage = lazy(() => import('./pages/MyTeamsPage').then((module) => ({ default: module.MyTeamsPage })));
const DeclarationsIndexPage = lazy(() => import('./pages/DeclarationsIndexPage').then((module) => ({ default: module.DeclarationsIndexPage })));
const AdminPage = lazy(() => import('./pages/AdminPage').then((module) => ({ default: module.AdminPage })));
const CompetitionEditor = lazy(() => import('./pages/admin/CompetitionEditor').then((module) => ({ default: module.CompetitionEditor })));
const FormatPage = lazy(() => import('./pages/admin/FormatPage').then((module) => ({ default: module.FormatPage })));
const RulesPage = lazy(() => import('./pages/admin/RulesPage').then((module) => ({ default: module.RulesPage })));
const ArenaPage = lazy(() => import('./pages/competition/ArenaPage').then((module) => ({ default: module.ArenaPage })));
const OperationsPage = lazy(() => import('./pages/operations/OperationsPage').then((module) => ({ default: module.OperationsPage })));
const RulebooksPage = lazy(() => import('./pages/operations/RulebooksPage').then((module) => ({ default: module.RulebooksPage })));
const ShopPage = lazy(() => import('./pages/ShopPage').then((module) => ({ default: module.ShopPage })));
const EventShopPage = lazy(() => import('./pages/commerce/EventShopPage').then((module) => ({ default: module.EventShopPage })));
const SellerCataloguePage = lazy(() => import('./pages/commerce/SellerCataloguePage').then((module) => ({ default: module.SellerCataloguePage })));
const CommerceOrdersPage = lazy(() => import('./pages/commerce/CommerceOrdersPage').then((module) => ({ default: module.CommerceOrdersPage })));
const CommerceManagementPage = lazy(() => import('./pages/commerce/CommerceManagementPage').then((module) => ({ default: module.CommerceManagementPage })));
const SeasonsPage = lazy(() => import('./pages/seasons/SeasonsPage').then((module) => ({ default: module.SeasonsPage })));
const SeasonPage = lazy(() => import('./pages/seasons/SeasonPage').then((module) => ({ default: module.SeasonPage })));
const TeamProfilePage = lazy(() => import('./pages/seasons/TeamProfilePage'));
const StatsPage = lazy(() => import('./pages/stats/StatsPage').then((module) => ({ default: module.StatsPage })));
const EventToolsPage = lazy(() => import('./pages/eventTools/EventToolsPage'));
const PrintEventPage = lazy(() => import('./pages/operations/PrintEventPage'));
const ScorerPage = lazy(() => import('./pages/ScorerPage').then((module) => ({ default: module.ScorerPage })));
const UnsubscribePage = lazy(() => import('./pages/UnsubscribePage').then((module) => ({ default: module.UnsubscribePage })));
const ConfirmEmailPage = lazy(() => import('./pages/ConfirmEmailPage').then((module) => ({ default: module.ConfirmEmailPage })));
const PrivacyPage = lazy(() => import('./pages/PrivacyPage').then((module) => ({ default: module.PrivacyPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })));
const AccountPage = lazy(() => import('./pages/AccountPage').then((module) => ({ default: module.AccountPage })));
const TestEntryPaymentPage = lazy(() => import('./pages/commerce/TestEntryPaymentPage').then((module) => ({ default: module.TestEntryPaymentPage })));
const MySignupsPage = lazy(() => import('./pages/MySignupsPage').then((module) => ({ default: module.MySignupsPage })));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage').then((module) => ({ default: module.NotFoundPage })));

export default function App() {
  return (
    <LiteModeProvider>
    <LiteMotionConfig>
    <ThemeProvider>
      <AuthProvider>
        <NeedsYouProvider>
        <CurrentCompetitionProvider>
        <NavExtrasProvider>
        <AgeGroupsProvider>
        <TickerProvider>
        <ConnectionStatusProvider>
        <CompetitionMetaProvider>
        <CompactPageBarProvider>
        <BrowserRouter>
          <ScrollToTop />
          <PageLoadBoundary page="app">
          <Suspense fallback={<p role="status" className="p-4 text-sm">Opening page…</p>}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignUpPage />} />
            <Route path="/score" element={<ScorerPage />} />
            <Route path="/event-tools/:competitionId/print/:view" element={<PrintEventPage />} />
            <Route element={<AppShell />}>
              <Route index element={<StartPage />} />
              <Route path="dashboard" element={<Navigate to="/me" replace />} />
              <Route path="events" element={<CompetitionsPage />} />
              <Route path="competitions" element={<CompetitionsPage />} />
              <Route path="competitions/past" element={<CompetitionsPage past />} />
              <Route path="competitions/:id" element={<CompetitionPage />}>
                <Route index element={<CompetitionHome />} />
                <Route path="enter" element={<EntryPage />} />
                <Route path="enter/:sectionId" element={<SectionEntryPage />} />
                <Route path="scoring" element={<AfterDrawOnly><ScoringTab /></AfterDrawOnly>} />
                <Route path="toplists" element={<AfterDrawOnly><ScoringTab key="toplists" toplistOnly /></AfterDrawOnly>} />
                <Route path="tv" element={<TvKioskPage />} />
                <Route path="commentary" element={<CommentaryDeskPage />} />
                <Route path="session/:sessionId" element={<AfterDrawOnly><SessionPage /></AfterDrawOnly>} />
                <Route path="arena" element={<ArenaPage />} />
                <Route path="standings" element={<Navigate to="../scoring" replace />} />
                <Route path="teams" element={<TeamsTab />} />
                <Route path="teams/:teamId" element={<CompetitionTeamPage />} />
                <Route path="following" element={<FollowingTab />} />
                <Route path="shop" element={<EventShopPage />} />
                <Route path="shop/manage" element={<ProtectedRoute roles={['Admin', 'Trainer']}><CommerceManagementPage /></ProtectedRoute>} />
                <Route path="rulebooks" element={<RulebooksPage />} />
                <Route path="operations" element={<ProtectedRoute roles={['Admin', 'Trainer']}><OperationsPage /></ProtectedRoute>} />
                <Route path="declarations" element={<DeclarationsTab />} />
                <Route path="broadcast" element={<ProtectedRoute roles={['Admin', 'Trainer']}><BroadcastPage /></ProtectedRoute>} />
                <Route path="produce" element={<ProtectedRoute roles={['Admin', 'Trainer']}><ProducePage /></ProtectedRoute>} />
                <Route path="chat" element={<AfterDrawOnly><ChatTab /></AfterDrawOnly>} />
                <Route path="details" element={<DetailsTab />} />
                <Route path="sponsors" element={<SponsorsPage />} />
                <Route path="live" element={<Navigate to="../chat" replace />} />
              </Route>
              <Route path="teams" element={
                <ProtectedRoute><MyTeamsPage /></ProtectedRoute>
              } />
              <Route path="following" element={<FollowingPage />} />
              <Route path="seasons" element={<SeasonsPage />} />
              <Route path="seasons/:seasonId" element={<SeasonPage />} />
              <Route path="team-profiles" element={<TeamProfilePage />} />
              <Route path="team-profiles/:profileId" element={<TeamProfilePage />} />
              <Route path="stats" element={<StatsPage />} />
              <Route path="stats/:kind" element={<StatsPage />} />
              <Route path="event-tools/:competitionId" element={<ProtectedRoute roles={['Admin', 'Trainer']}><EventToolsPage /></ProtectedRoute>} />
              <Route path="declarations" element={<DeclarationsIndexPage />} />
              <Route path="chat" element={<Navigate to="/events" replace />} />
              <Route path="shop" element={<ShopPage />} />
              <Route path="me" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
              <Route path="me/members" element={<ProtectedRoute roles={['Manager', 'Admin']}><MembersPage /></ProtectedRoute>} />
              <Route path="me/payouts" element={<ProtectedRoute roles={['Manager', 'Admin']}><PayoutsPage /></ProtectedRoute>} />
              <Route path="me/catalogue" element={<ProtectedRoute><SellerCataloguePage /></ProtectedRoute>} />
              <Route path="me/orders" element={<ProtectedRoute><CommerceOrdersPage /></ProtectedRoute>} />
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
              <Route path="privacy" element={<PrivacyPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="unsubscribe" element={<UnsubscribePage />} />
              <Route path="confirm-email" element={<ConfirmEmailPage />} />
              <Route path="me/account"element={<ProtectedRoute><AccountPage /></ProtectedRoute>} />
              <Route path="me/signups" element={
                <ProtectedRoute><MySignupsPage /></ProtectedRoute>
              } />
              <Route path="me/signups/:signupId/test-payment" element={
                <ProtectedRoute><TestEntryPaymentPage /></ProtectedRoute>
              } />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
          </Suspense>
          </PageLoadBoundary>
        </BrowserRouter>
        </CompactPageBarProvider>
        </CompetitionMetaProvider>
        </ConnectionStatusProvider>
        </TickerProvider>
        </AgeGroupsProvider>
        </NavExtrasProvider>
        </CurrentCompetitionProvider>
        </NeedsYouProvider>
      </AuthProvider>
    </ThemeProvider>
    </LiteMotionConfig>
    </LiteModeProvider>
  );
}
