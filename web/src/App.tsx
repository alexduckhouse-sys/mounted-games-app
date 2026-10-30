import { LegacyEventRedirect } from './components/LegacyEventRedirect';
import { lazy, Suspense, useEffect } from 'react';
import { PageLoadBoundary } from './components/PageLoadBoundary';
import { NativeLiveActivityCoordinator } from './native/NativeLiveActivityCoordinator';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { LanguageProvider } from './i18n/LanguageContext';
import { AuthProvider } from './auth/AuthContext';
import { NeedsYouProvider } from './pages/profile/NeedsYouProvider';
import { ThemeProvider } from './theme/ThemeContext';
import { LiteModeProvider } from './lite/LiteModeContext';
import { LiteMotionConfig } from './lite/LiteMotionConfig';
import { CurrentCompetitionProvider } from './competition/CurrentCompetitionContext';
import { NavExtrasProvider } from './components/NavExtrasContext';
import { AgeGroupsProvider } from './components/AgeGroupsContext';
import { TickerProvider } from './components/TickerContext';
import { WeatherLineProvider } from './components/WeatherLineContext';
import { ConnectionStatusProvider } from './live/ConnectionStatusContext';
import { CompetitionMetaProvider } from './components/CompetitionMetaContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AppShell } from './components/AppShell';
import { CompactPageBarProvider } from './components/CompactPageBarContext';
import { StartPage } from './pages/StartPage';
import { CompetitionPage } from './pages/CompetitionPage';
import { AfterDrawOnly, CompetitionHome, TimetableRoute } from './pages/competition/CompetitionHome';
import { ScrollToTop } from './components/ScrollToTop';
import { useT } from './i18n/LanguageContext';
import { isLiteModeActive } from './lite/liteMode';

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
const TeamStatsPage = lazy(() => import('./pages/competition/TeamStatsPage').then((module) => ({ default: module.TeamStatsPage })));
const CompetitionTeamPage = lazy(() => import('./pages/competition/CompetitionTeamPage').then((module) => ({ default: module.CompetitionTeamPage })));
const DeclarationsTab = lazy(() => import('./pages/competition/DeclarationsTab').then((module) => ({ default: module.DeclarationsTab })));
const BroadcastPage = lazy(() => import('./pages/competition/BroadcastPage').then((module) => ({ default: module.BroadcastPage })));
const PrizeGivingPage = lazy(() => import('./pages/competition/PrizeGivingPage').then((module) => ({ default: module.PrizeGivingPage })));
const StreamControlsPage = lazy(() => import('./pages/competition/StreamControlsPage').then((module) => ({ default: module.StreamControlsPage })));
const ProducePage = lazy(() => import('./pages/competition/ProducePage').then((module) => ({ default: module.ProducePage })));
const ChatTab = lazy(() => import('./pages/competition/ChatTab').then((module) => ({ default: module.ChatTab })));
const MessageThreadPage = lazy(() => import('./pages/competition/MessageThreadPage').then((module) => ({ default: module.MessageThreadPage })));
const AnnouncementsPage = lazy(() => import('./pages/competition/AnnouncementsPage').then((module) => ({ default: module.AnnouncementsPage })));
const ContactOrganisersPage = lazy(() => import('./pages/competition/ContactOrganisersPage').then((module) => ({ default: module.ContactOrganisersPage })));
const EntryPage = lazy(() => import('./pages/competition/EntryPage').then((module) => ({ default: module.EntryPage })));
const DetailsTab = lazy(() => import('./pages/competition/DetailsTab').then((module) => ({ default: module.DetailsTab })));
const FollowingPage = lazy(() => import('./pages/FollowingPage').then((module) => ({ default: module.FollowingPage })));
const SponsorsPage = lazy(() => import('./pages/competition/SponsorsPage').then((module) => ({ default: module.SponsorsPage })));
const FollowingTab = lazy(() => import('./pages/competition/FollowingTab').then((module) => ({ default: module.FollowingTab })));
const MyTeamsPage = lazy(() => import('./pages/MyTeamsPage').then((module) => ({ default: module.MyTeamsPage })));
const DeclarationsIndexPage = lazy(() => import('./pages/DeclarationsIndexPage').then((module) => ({ default: module.DeclarationsIndexPage })));
const SiteAdminDashboard = lazy(() => import('./pages/admin/SiteAdminDashboard').then((module) => ({ default: module.SiteAdminDashboard })));
const AdminCompetitionsPage = lazy(() => import('./pages/admin/AdminCompetitionsPage').then((module) => ({ default: module.AdminCompetitionsPage })));
const TrainerRequestsPage = lazy(() => import('./pages/admin/TrainerRequestsPage').then((module) => ({ default: module.TrainerRequestsPage })));
const UsersPage = lazy(() => import('./pages/admin/UsersPage').then((module) => ({ default: module.UsersPage })));
const EmailPage = lazy(() => import('./pages/admin/EmailPage').then((module) => ({ default: module.EmailPage })));
const BlockedAccountsPage = lazy(() => import('./pages/admin/BlockedAccountsPage').then((module) => ({ default: module.BlockedAccountsPage })));
const InvitePage = lazy(() => import('./pages/InvitePage').then((module) => ({ default: module.InvitePage })));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage').then((module) => ({ default: module.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage').then((module) => ({ default: module.ResetPasswordPage })));
const CompetitionEditor = lazy(() => import('./pages/admin/CompetitionEditor').then((module) => ({ default: module.CompetitionEditor })));
const RulesLibraryPage = lazy(() => import('./pages/admin/RulesLibraryPage').then((module) => ({ default: module.RulesLibraryPage })));
const ArenaCrewPage = lazy(() => import('./pages/competition/ArenaCrewPage').then((module) => ({ default: module.ArenaCrewPage })));
const VolunteerRotaPage = lazy(() => import('./pages/competition/VolunteerRotaPage').then((module) => ({ default: module.VolunteerRotaPage })));
const ArenaPage = lazy(() => import('./pages/competition/ArenaPage').then((module) => ({ default: module.ArenaPage })));
const WeatherPage = lazy(() => import('./pages/competition/WeatherPage').then((module) => ({ default: module.WeatherPage })));
const OperationsPage = lazy(() => import('./pages/operations/OperationsPage').then((module) => ({ default: module.OperationsPage })));
const EventDetailsPage = lazy(() => import('./pages/operations/EventDetailsPage').then((module) => ({ default: module.EventDetailsPage })));
const SectionsPage = lazy(() => import('./pages/operations/SectionsPage').then((module) => ({ default: module.SectionsPage })));
const TimetablePage = lazy(() => import('./pages/operations/TimetablePage').then((module) => ({ default: module.TimetablePage })));
const EquipmentPage = lazy(() => import('./pages/operations/EquipmentPage').then((module) => ({ default: module.EquipmentPage })));
const SponsorsSharingPage = lazy(() => import('./pages/operations/SponsorsSharingPage').then((module) => ({ default: module.SponsorsSharingPage })));
const EntriesPage = lazy(() => import('./pages/operations/EntriesPage').then((module) => ({ default: module.EntriesPage })));
const RulebooksPage = lazy(() => import('./pages/operations/RulebooksPage').then((module) => ({ default: module.RulebooksPage })));
const ShopPage = lazy(() => import('./pages/ShopPage').then((module) => ({ default: module.ShopPage })));
const EventShopPage = lazy(() => import('./pages/commerce/EventShopPage').then((module) => ({ default: module.EventShopPage })));
const SellerCataloguePage = lazy(() => import('./pages/commerce/SellerCataloguePage').then((module) => ({ default: module.SellerCataloguePage })));
const CommerceOrdersPage = lazy(() => import('./pages/commerce/CommerceOrdersPage').then((module) => ({ default: module.CommerceOrdersPage })));
const CommerceManagementPage = lazy(() => import('./pages/commerce/CommerceManagementPage').then((module) => ({ default: module.CommerceManagementPage })));
const SeasonsPage = lazy(() => import('./pages/seasons/SeasonsPage').then((module) => ({ default: module.SeasonsPage })));
const SeasonPage = lazy(() => import('./pages/seasons/SeasonPage').then((module) => ({ default: module.SeasonPage })));
const TeamProfilePage = lazy(() => import('./pages/seasons/TeamProfilePage'));
const TeamProfileStatsPage = lazy(() => import('./pages/seasons/TeamProfileStatsPage'));
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

function OpeningPage() {
  const t = useT();
  return <p role="status" className="p-4 text-sm">{t('shell.header.openingPage')}</p>;
}

/**
 * The pages people tap between at an event. Their code is fetched once the app is idle, so a tab opens straight away
 * instead of holding the old page while it downloads. Lite mode and Data Saver skip it to save data.
 */
function warmPublicPages() {
  if (isLiteModeActive()) return;
  void Promise.allSettled([
    import('./pages/CompetitionsPage'),
    import('./pages/FollowingPage'),
    import('./pages/ProfilePage'),
    import('./pages/competition/ScoringTab'),
    import('./pages/competition/SessionPage'),
    import('./pages/competition/TeamsTab'),
    import('./pages/competition/CompetitionTeamPage'),
    import('./pages/competition/DetailsTab'),
    import('./pages/competition/FollowingTab'),
    import('./pages/competition/ChatTab'),
  ]);
}

export default function App() {
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((run: () => void) => window.setTimeout(run, 1500));
    const cancel = window.cancelIdleCallback ?? window.clearTimeout;
    const handle = idle(warmPublicPages);
    return () => cancel(handle);
  }, []);
  return (
    <LanguageProvider>
    <LiteModeProvider>
    <LiteMotionConfig>
    <ThemeProvider>
      <AuthProvider>
        <NativeLiveActivityCoordinator />
        <NeedsYouProvider>
        <CurrentCompetitionProvider>
        <NavExtrasProvider>
        <AgeGroupsProvider>
        <TickerProvider>
        <WeatherLineProvider>
        <ConnectionStatusProvider>
        <CompetitionMetaProvider>
        <CompactPageBarProvider>
        <BrowserRouter>
          <ScrollToTop />
          <PageLoadBoundary page="app">
          <Suspense fallback={<OpeningPage />}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignUpPage />} />
            <Route path="/register" element={<Navigate to="/signup" replace />} />
            <Route path="/invite" element={<InvitePage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
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
                <Route path="enter/*" element={<EntryPage />} />
                <Route path="scoring" element={<AfterDrawOnly><ScoringTab /></AfterDrawOnly>} />
                <Route path="toplists" element={<AfterDrawOnly><ScoringTab key="toplists" startOn="toplist" /></AfterDrawOnly>} />
                <Route path="tv" element={<TvKioskPage />} />
                <Route path="commentary" element={<CommentaryDeskPage />} />
                <Route path="session/:sessionId" element={<AfterDrawOnly><SessionPage /></AfterDrawOnly>} />
                <Route path="arena" element={<ArenaPage />} />
                <Route path="arena-crew" element={<ArenaCrewPage />} />
                <Route path="weather" element={<WeatherPage />} />
                <Route path="volunteers" element={<VolunteerRotaPage />} />
                <Route path="standings" element={<Navigate to="../scoring" replace />} />
                <Route path="timetable" element={<TimetableRoute />} />
                <Route path="teams" element={<TeamsTab />} />
                <Route path="teams/:teamId" element={<CompetitionTeamPage />} />
                <Route path="teams/:teamId/stats" element={<TeamStatsPage />} />
                <Route path="following" element={<FollowingTab />} />
                <Route path="shop" element={<EventShopPage />} />
                <Route path="shop/manage" element={<ProtectedRoute roles={['Admin', 'Trainer']}><CommerceManagementPage /></ProtectedRoute>} />
                <Route path="rulebooks" element={<RulebooksPage />} />
                <Route path="operations" element={<ProtectedRoute roles={['Admin', 'Trainer']}><OperationsPage /></ProtectedRoute>} />
                <Route path="operations/:tool" element={<ProtectedRoute roles={['Admin', 'Trainer']}><OperationsPage /></ProtectedRoute>} />
                <Route path="sections" element={<ProtectedRoute roles={['Admin', 'Trainer']}><SectionsPage /></ProtectedRoute>} />
                <Route path="timetable-and-draw" element={<ProtectedRoute roles={['Admin', 'Trainer']}><TimetablePage /></ProtectedRoute>} />
                <Route path="equipment" element={<ProtectedRoute roles={['Admin', 'Trainer']}><EquipmentPage /></ProtectedRoute>} />
                <Route path="sponsors-and-sharing" element={<ProtectedRoute roles={['Admin', 'Trainer']}><SponsorsSharingPage /></ProtectedRoute>} />
                <Route path="entries" element={<ProtectedRoute roles={['Admin', 'Trainer']}><EntriesPage /></ProtectedRoute>} />
                <Route path="event-details" element={<ProtectedRoute roles={['Admin', 'Trainer']}><EventDetailsPage /></ProtectedRoute>} />
                <Route path="declarations" element={<DeclarationsTab />} />
                <Route path="broadcast" element={<ProtectedRoute roles={['Admin', 'Trainer']}><BroadcastPage /></ProtectedRoute>} />
                <Route path="stream-controls" element={<ProtectedRoute roles={['Admin', 'Trainer']}><StreamControlsPage /></ProtectedRoute>} />
                <Route path="prize-giving" element={<ProtectedRoute><PrizeGivingPage /></ProtectedRoute>} />
                <Route path="produce" element={<ProtectedRoute><ProducePage /></ProtectedRoute>} />
                <Route path="chat" element={<AfterDrawOnly><ChatTab /></AfterDrawOnly>} />
                <Route path="contact" element={<ContactOrganisersPage />} />
                <Route path="announcements" element={<ProtectedRoute roles={['Admin', 'Trainer']}><AnnouncementsPage /></ProtectedRoute>} />
                <Route path="messages/:userId" element={<ProtectedRoute roles={['Admin', 'Trainer']}><MessageThreadPage /></ProtectedRoute>} />
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
              <Route path="team-profiles/:profileId/stats" element={<TeamProfileStatsPage />} />
              <Route path="stats" element={<StatsPage />} />
              <Route path="stats/:kind" element={<StatsPage />} />
              <Route path="event-tools/:competitionId" element={<ProtectedRoute roles={['Admin', 'Trainer']}><EventToolsPage /></ProtectedRoute>} />
              <Route path="declarations" element={<DeclarationsIndexPage />} />
              <Route path="chat" element={<Navigate to="/events" replace />} />
              <Route path="shop" element={<ShopPage />} />
              <Route path="me" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
              <Route path="me/members" element={<ProtectedRoute roles={['Manager', 'Admin']}><MembersPage /></ProtectedRoute>} />
              <Route path="me/payouts" element={<ProtectedRoute><PayoutsPage /></ProtectedRoute>} />
              <Route path="me/catalogue" element={<ProtectedRoute><SellerCataloguePage /></ProtectedRoute>} />
              <Route path="me/orders" element={<ProtectedRoute><CommerceOrdersPage /></ProtectedRoute>} />
              <Route path="admin" element={
                <ProtectedRoute roles={['Admin']}><SiteAdminDashboard /></ProtectedRoute>
              } />
              <Route path="admin/competitions" element={
                <ProtectedRoute roles={['Admin']}><AdminCompetitionsPage /></ProtectedRoute>
              } />
              <Route path="admin/trainer-requests" element={
                <ProtectedRoute roles={['Admin']}><TrainerRequestsPage /></ProtectedRoute>
              } />
              <Route path="admin/users" element={
                <ProtectedRoute roles={['Admin']}><UsersPage /></ProtectedRoute>
              } />
              <Route path="admin/blocked" element={
                <ProtectedRoute roles={['Admin']}><BlockedAccountsPage /></ProtectedRoute>
              } />
              <Route path="admin/email" element={
                <ProtectedRoute roles={['Admin']}><EmailPage /></ProtectedRoute>
              } />
              <Route path="admin/competitions/new" element={
                <ProtectedRoute roles={['Admin', 'Trainer']}><CompetitionEditor /></ProtectedRoute>
              } />
              <Route path="admin/competitions/:id" element={
                <ProtectedRoute roles={['Admin', 'Trainer']}><CompetitionEditor /></ProtectedRoute>
              } />
              <Route path="admin/competitions/:id/format" element={
                <ProtectedRoute roles={['Admin', 'Trainer']}><LegacyEventRedirect /></ProtectedRoute>
              } />
              <Route path="admin/rules" element={
                <ProtectedRoute roles={['Admin']}><RulesLibraryPage /></ProtectedRoute>
              } />
              <Route path="privacy" element={<PrivacyPage />} />
              <Route path="terms" element={<PrivacyPage />} />
              <Route path="refunds" element={<PrivacyPage />} />
              <Route path="cookies" element={<PrivacyPage />} />
              <Route path="safeguarding" element={<PrivacyPage />} />
              <Route path="data-deletion" element={<PrivacyPage />} />
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
        </WeatherLineProvider>
        </TickerProvider>
        </AgeGroupsProvider>
        </NavExtrasProvider>
        </CurrentCompetitionProvider>
        </NeedsYouProvider>
      </AuthProvider>
    </ThemeProvider>
    </LiteMotionConfig>
    </LiteModeProvider>
    </LanguageProvider>
  );
}
