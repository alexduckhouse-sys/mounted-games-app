import { Link, useLocation, useNavigate } from 'react-router-dom';
import { CardDropdownRow } from '../components/CardDropdownRow';
import { usePageHeader } from '../components/CompactPageBarContext';
import { POLICIES, policyForLocation } from '../lib/policies';
import '../components/sitePages.css';

// Keep the published placeholder until the operator confirms a monitored address.
const CONTACT_EMAIL = '[contact email to be added]';

/** One policy at a time, picked from the "Showing" row. Each policy has its own address (`/privacy`, `/terms`, `/refunds`, `/cookies`, `/safeguarding`). */
export function PrivacyPage() {
  usePageHeader({
    title: 'Policies and legal',
    backTo: '/settings',
    backLabel: 'Back to settings',
    plain: true,
  });
  const location = useLocation();
  const navigate = useNavigate();
  const id = policyForLocation(location.pathname, location.hash);
  const policy = POLICIES.find((candidate) => candidate.id === id)!;

  return (
    <div className="skin mx-auto w-full max-w-[560px] py-4">
      <h1 className="sr-only">Policies and legal</h1>
      <div className="sp-card">
        <CardDropdownRow label="Showing" value={id} options={POLICIES.map((item) => ({ value: item.id, label: item.label }))}
          onChange={(value) => navigate(POLICIES.find((item) => item.id === value)!.path)} />
      </div>
      <h2 className="sp-policy-title">{policy.title}</h2>
      <div className="space-y-3">
        {id === 'privacy' && <PrivacyPolicy />}
        {id === 'terms' && <TermsPolicy />}
        {id === 'refunds' && <RefundsPolicy />}
        {id === 'cookies' && <CookiesPolicy />}
        {id === 'safeguarding' && <SafeguardingPolicy />}
        <section className="mg-card space-y-2 p-4">
          <h2 className="mg-h2">Questions or requests</h2>
          <p className="mg-lede">
            To see what we hold about you, correct it, report a safeguarding or copyright concern, or ask us to delete
            something the account page can’t, email{' '}
            <span className="font-semibold">{CONTACT_EMAIL}</span>
            .
          </p>
        </section>
      </div>
    </div>
  );
}

function PrivacyPolicy() {
  return (
    <>
      <div className="mg-card space-y-2 p-4">
        <h3 className="mg-h2">If you just watch</h3>
        <p className="mg-lede">
          You don’t need an account to follow a competition, so we don’t know who you are. Your device’s IP address
          reaches our servers like it does for any website, and we use it to limit abuse (for example, how often one
          address can ask for a lookup). Those counters last about a minute. Our host, Vercel, keeps its own ordinary
          server logs.
        </p>
        <p className="mg-lede">
          If you watch a live stream, your connection goes through Cloudflare, which carries the video.
        </p>
      </div>

      <div className="mg-card space-y-2 p-4">
        <h3 className="mg-h2">If you have an account</h3>
        <ul className="list-disc space-y-1.5 pl-5 marker:text-[rgb(var(--mg-muted))]">
          <li className="mg-lede">
            <strong>Account details.</strong> Your name, sign-in (an email address or username), club if you gave
            one, phone number if you added one to a declaration, and your role. Your password is stored as a hash,
            never as text.
          </li>
          <li className="mg-lede">
            <strong>Entries and declarations.</strong> Public competition pages can show team and club names, rider
            display names, pony names and heights, bib details, team roles and results. A declaration can also show
            the submitter’s name. The surname-initial option changes how rider names appear publicly. Team tack-and-turnout
            scores and standings are public.
          </li>
          <li className="mg-lede">
            <strong>Private declaration details.</strong> Depending on what the organiser asks for, forms can hold
            the trainer’s phone number, a rider’s date of birth, birth year or age group, weight, membership number,
            emergency contact details, medical notes, pony passport and owner details, pony age and answers to extra
            questions. These fields are available to the competition’s organisers, the trainer or person who submitted
            the form, and administrators. They are excluded from public declarations. Your saved rider list is available
            to you and administrators. Competition signups record your name, club, contact details and payment status.
          </li>
          <li className="mg-lede">
            <strong>Club payout details.</strong> If you set up payouts for your club, we keep the club’s business
            details, the name and date of birth of the person responsible, the account holder name, the sort code and
            the last four digits of the bank account. Full account numbers are checked and then discarded, never
            stored. Only that club’s managers and administrators can see them.
          </li>
          <li className="mg-lede">
            <strong>Notes and teams.</strong> Private trainer notes, and the teams you coach or support.
          </li>
          <li className="mg-lede">
            <strong>Chat and the marketplace.</strong> What you post, the name you posted under, and any contact
            details you put in a listing. Private marketplace messages are visible to the two people involved and to
            administrators.
          </li>
          <li className="mg-lede">
            <strong>Push notifications.</strong> If you turn them on, we keep the address your browser gave us for
            sending them, until you switch them off or delete your account.
          </li>
        </ul>
        <p className="mg-lede">
          We use this information to run accounts and competition features, including entries, declarations, scoring,
          timetables, notifications and moderation. Data is stored in Neon Postgres and served through Vercel.
          We don’t sell your data or use it for advertising.
        </p>
      </div>

      <div className="mg-card space-y-2 p-4">
        <h3 className="mg-h2">IP addresses on posts</h3>
        <p className="mg-lede">
          When you post a chat message or something in the marketplace, we record your IP address so an administrator
          can block someone who is abusing the service. After 30 days the address is replaced with a scrambled code.
          That still shows when the same address posts again, but the address itself is no longer stored. IP addresses
          on the block list stay until an administrator removes the block.
        </p>
      </div>

      <div className="mg-card space-y-2 p-4">
        <h3 className="mg-h2">Deleting your account</h3>
        <p className="mg-lede">
          Signed in, go to{' '}
          <Link to="/me/account" className="font-semibold text-[rgb(var(--mg-heading))] underline">
            My account
          </Link>{' '}
          and choose “Delete my account”. You’ll be asked for your password. Your notes, saved riders, push
          notifications and private marketplace messages are deleted. Chat messages, marketplace posts and comments
          you wrote stay, but your name, IP address and contact details are taken off them. Declarations and signups
          stay as the competition’s record (a signup keeps the payer’s name because it’s also a payment record, but
          loses your contact details). Competitions you created and teams you coached stay, with no owner.
        </p>
        <p className="mg-lede">
          If you’ve published seasons or team history, sold items or placed an order, we keep your account as an
          empty shell that nobody can sign in to, because those records depend on it. It holds no name, email address
          or phone number.
        </p>
        <p className="mg-lede">
          The shared administrator account and the last remaining administrator can’t be deleted this way. If you
          can’t sign in, write to us and we’ll do it for you. You also have the right to ask for a copy of your data,
          ask us to fix mistakes, or complain to the UK Information Commissioner’s Office (ico.org.uk).
        </p>
      </div>
    </>
  );
}

function TermsPolicy() {
  return (
    <>
      <div className="mg-card space-y-2.5 p-4">
        <h3 className="mg-h2">Terms of use &amp; event conduct</h3>
        <ul className="list-disc space-y-1.5 pl-5 marker:text-[rgb(var(--mg-muted))]">
          <li className="mg-lede">
            <strong>How the platform works.</strong> Mounted Games provides the software for timetables, live scoring,
            arena streaming, competition entries, rider declarations and the tack shop. Each physical competition is
            organised and run by its own host club, association or event organiser, who sets that event’s schedule,
            rulebook and entry conditions.
          </li>
          <li className="mg-lede">
            <strong>Entries and declarations.</strong> Give accurate rider, pony and emergency contact details when
            entering or submitting a declaration. Check the organiser’s entry conditions, including requirements for
            parental permission, passports, vaccinations, rider equipment and pony fitness, before attending.
          </li>
          <li className="mg-lede">
            <strong>Steward and camera QR keys.</strong> Organiser-issued QR codes and links for scoring or arena
            broadcasting grant live permissions for that competition. Keep them within your stewarding or filming team
            and do not post them publicly.
          </li>
          <li className="mg-lede">
            <strong>Tack &amp; kit shop.</strong> Marketplace listings and event-stall reservations are arranged
            directly between buyers, sellers and organisers. Describe items honestly and agree payment and collection
            with the seller or organiser.
          </li>
          <li className="mg-lede">
            <strong>Live chat and comments.</strong> Keep event announcements, messages to organisers and shop
            comments respectful. Organisers and administrators can remove posts or block network addresses that abuse
            the service.
          </li>
        </ul>
      </div>

      <div className="mg-card space-y-2 p-4">
        <h3 className="mg-h2">The app and the event</h3>
        <p className="mg-lede">
          The app provides competition administration, scoring, timetable and streaming tools. The event organiser
          manages the physical event and its arrangements. Check their published conditions and contact them about
          facilities, insurance requirements, safety rules, official decisions or changes to the event.
        </p>
        <p className="mg-lede">
          Signal, device and service interruptions can affect live information. Check with event officials if a
          timetable, score or announcement appears incomplete or out of date. These statements do not limit any
          rights you have under applicable law.
        </p>
      </div>
    </>
  );
}

function RefundsPolicy() {
  return (
    <>
      <div className="mg-card space-y-2.5 p-4">
        <h3 className="mg-h2">Entries, withdrawals &amp; shop refunds</h3>
        <ul className="list-disc space-y-1.5 pl-5 marker:text-[rgb(var(--mg-muted))]">
          <li className="mg-lede">
            <strong>Who receives your payment.</strong> Payments are arranged with the competition organiser, club or
            seller. The app records payment details and status for manual confirmation; it does not process online
            payments or hold your money.
          </li>
          <li className="mg-lede">
            <strong>Withdrawals, cancellations and refunds.</strong> Before entering or ordering, check the organiser’s
            or seller’s cancellation, withdrawal and refund terms. Contact them about a withdrawal, cancellation,
            postponement or refund. The app does not set a standard refund deadline, certificate requirement or
            cancellation charge. Your rights depend on the transaction and applicable law as well as any valid terms.
          </li>
          <li className="mg-lede">
            <strong>Tack &amp; kit shop and event stalls.</strong> Agree payment and collection with the seller and check
            whether they are selling privately or as a business. Rights can differ between private and business sales
            and between purchases agreed online and in person. Contact the seller about a problem with an item.
          </li>
        </ul>
      </div>
    </>
  );
}

function CookiesPolicy() {
  return (
    <>
      <div className="mg-card space-y-2 p-4">
        <h3 className="mg-h2">What stays on your device</h3>
        <p className="mg-lede">
          We don’t use tracking or advertising cookies, and we don’t run third-party analytics. The app stores
          information on your device for sign-in, your preferences, offline features and replay tools. This includes:
        </p>
        <ul className="list-disc space-y-1.5 pl-5 marker:text-[rgb(var(--mg-muted))]">
          <li className="mg-lede">your sign-in (<code>mg.auth</code>) and any active steward or camera permission token;</li>
          <li className="mg-lede">
            your choices: colour theme, Lite mode, weather, notifications, bottom bar shortcuts, text size, the
            competition you picked and, if you asked it to remember, one small preference cookie (<code>mg.competition</code>)
            holding that competition for 180 days;
          </li>
          <li className="mg-lede">
            teams you follow, a draft declaration form you haven’t submitted, any offline scores waiting for signal,
            and banners you saved on a streaming device;
          </li>
          <li className="mg-lede">
            local rolling video buffers while broadcasting or watching a live stream. The broadcasting buffer aims to
            retain up to 30 minutes and the viewer buffer up to one minute, subject to device and storage limits.
            Clips you save can remain in browser storage after you leave the page;
          </li>
          <li className="mg-lede">
            a saved copy of public pages (timetables, rulebooks, results) in the service worker cache so they still
            open when showground signal drops.
          </li>
        </ul>
        <p className="mg-lede">
          You can delete saved replays in the replay tools. Clearing the app’s browser site data removes its stored
          data, but does not remove files you downloaded separately. Organisers can also add YouTube or Twitch streams;
          those providers’ own storage practices and policies apply when you use their players.
        </p>
      </div>
    </>
  );
}

function SafeguardingPolicy() {
  return (
    <>
      <div className="mg-card space-y-2 p-4">
        <h3 className="mg-h2">Children &amp; arena filming</h3>
        <p className="mg-lede">
          Many riders are under 18. Private declaration details, including dates of birth, weight, medical notes and
          emergency contacts, are restricted as described above. Public pages can show rider names and competition
          information. Use the surname-initial and filming-preference options where available, and discuss filming
          concerns with the organiser before the event.
        </p>
        <p className="mg-lede">
          Live streams can show identifiable riders and spectators. Broadcasters and viewers can save replay clips,
          and clips or images can be downloaded. Contact the organiser about event filming or use the contact details
          below to raise a concern about content in the app. Copies saved or shared by other people may also need to
          be addressed with the person or service holding them.
        </p>
      </div>

      <div className="mg-card space-y-2 p-4">
        <h3 className="mg-h2">Equine welfare</h3>
        <p className="mg-lede">
          Check the organiser’s welfare, tack, equipment and vaccination requirements before attending. Raise concerns
          about a rider or pony at the event with its organisers or officials.
        </p>
      </div>
    </>
  );
}
