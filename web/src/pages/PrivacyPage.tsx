import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { usePageHeader } from '../components/CompactPageBarContext';

const CONTACT_EMAIL = 'support@mountedgames.app';

const POLICY_SECTIONS = [
  { id: 'privacy', label: 'Privacy' },
  { id: 'terms', label: 'Terms of service' },
  { id: 'refunds', label: 'Refunds & payments' },
  { id: 'cookies', label: 'Cookies & storage' },
  { id: 'safeguarding', label: 'Safeguarding & welfare' },
] as const;

export function PrivacyPage() {
  usePageHeader({
    title: 'Policies & legal',
    backTo: '/settings',
    backLabel: 'Back to settings',
    plain: true,
  });
  const location = useLocation();

  useEffect(() => {
    const hashId = location.hash ? location.hash.slice(1) : '';
    const pathId =
      location.pathname === '/terms'
        ? 'terms'
        : location.pathname === '/refunds'
          ? 'refunds'
          : location.pathname === '/cookies'
            ? 'cookies'
            : location.pathname === '/safeguarding'
              ? 'safeguarding'
              : '';
    const targetId = hashId || pathId;
    if (targetId) {
      document.getElementById(targetId)?.scrollIntoView?.();
    }
  }, [location.hash, location.pathname]);

  return (
    <div className="skin mx-auto w-full max-w-[560px] space-y-5 py-4">
      <header className="space-y-3">
        <h1 className="mg-h1">Privacy, Terms &amp; Policies</h1>
        <p className="mg-lede">
          Mounted Games runs competitions on phones. Everything below is written in plain English: what data we keep,
          the terms for entering and using the app, how refunds and payments work, what stays on your phone, and how we
          protect young riders and ponies.
        </p>
        <nav aria-label="Policy sections" className="flex flex-wrap gap-1.5 pt-1">
          {POLICY_SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="mg-chip !min-h-9 !px-3 !text-xs font-semibold !no-underline"
            >
              {s.label}
            </a>
          ))}
        </nav>
      </header>

      {/* 1. PRIVACY POLICY */}
      <section id="privacy" className="scroll-mt-20 space-y-3">
        <h2 className="px-1 text-xs font-bold uppercase tracking-[0.08em] text-[rgb(var(--mg-muted))]">
          1. Privacy &amp; Data Protection (UK GDPR)
        </h2>

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
              <strong>Entries and declarations.</strong> Declaration forms list riders (name, horse, bib colour) and
              who submitted them. They also hold the trainer’s phone number and, depending on what the organiser asks
              for, a rider’s date of birth, birth year or age group, weight, membership number, an emergency contact’s
              name and phone number, medical notes, the pony’s passport or ID number, equine flu vaccination
              certification, height and age, and the organiser’s own extra questions. Only the organisers of that
              competition, the trainer or person who submitted the form and administrators can see those details; they
              never appear on public pages, in statistics or in public downloads. The saved rider list you build is
              visible only to you and to administrators. Signing up for a competition records your name, club, any
              contact details you gave and the payment status.
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
            Under the UK GDPR and Data Protection Act 2018, our lawful bases for holding this information are performing
            our agreement with you (running your entries, declarations, notifications and account), legitimate interests
            (keeping competitions scored accurately and preventing abuse), and parent or guardian consent for riders
            under 18. Data is stored in Neon Postgres and served through Vercel. We don’t sell your data and we don’t
            use it for advertising.
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
      </section>

      {/* 2. TERMS OF SERVICE */}
      <section id="terms" className="scroll-mt-20 space-y-3">
        <h2 className="px-1 text-xs font-bold uppercase tracking-[0.08em] text-[rgb(var(--mg-muted))]">
          2. Terms of Service &amp; Platform Rules
        </h2>

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
              <strong>Entries, declarations and equine flu vaccinations.</strong> When you enter a competition or submit
              a rider declaration form, you confirm that the rider, pony and emergency contact details are accurate,
              that a parent or guardian has given consent for any rider under 18, and that every declared pony has an
              up-to-date equine influenza vaccination record in its passport meeting the governing body’s rules (EGUK,
              Pony Club, MGA or STRUK) and is fit to compete. Random passport inspections take place at events; ponies
              without a valid passport and vaccination record will not be allowed to unload or compete.
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
          <h3 className="mg-h2">Equine &amp; sporting liability</h3>
          <p className="mg-lede">
            Mounted equestrian sport carries inherent risks to riders, handlers, officials, spectators and horses.
            Competition organisers, clubs, trainers, riders and parents remain responsible for holding appropriate
            public liability and personal accident insurance, wearing approved riding hats and body protectors, checking
            tack, and looking after horse and rider welfare at the showground.
          </p>
          <p className="mg-lede">
            Mounted Games provides the digital scoring, timetable and streaming tools on an “as available” basis and is
            not responsible for showground conditions, referee or steward decisions, or weather delays. Nothing in these
            terms excludes or limits liability for death or personal injury caused by negligence, fraud, or any statutory
            right under the Consumer Rights Act 2015.
          </p>
        </div>
      </section>

      {/* 3. REFUNDS & CANCELLATIONS */}
      <section id="refunds" className="scroll-mt-20 space-y-3">
        <h2 className="px-1 text-xs font-bold uppercase tracking-[0.08em] text-[rgb(var(--mg-muted))]">
          3. Refunds, Cancellations &amp; Payments Policy
        </h2>

        <div className="mg-card space-y-2.5 p-4">
          <h3 className="mg-h2">Entries, withdrawals &amp; shop refunds</h3>
          <ul className="list-disc space-y-1.5 pl-5 marker:text-[rgb(var(--mg-muted))]">
            <li className="mg-lede">
              <strong>Who receives your payment.</strong> Entry fees, stabling, hook-up, camping and event-shop orders
              are paid to the competition organiser, host club or seller. Payments recorded in the app are confirmed by
              the organiser or club; Mounted Games is the booking tool, not the merchant holding your funds.
            </li>
            <li className="mg-lede">
              <strong>Competition entries and the 14-day cooling-off rule.</strong> Under the UK Consumer Contracts
              Regulations 2013 (Regulation 28(1)(h)), bookings for sporting or leisure events on a specific date do not
              carry an automatic 14-day right to cancel once accepted. Each organiser sets the withdrawal and refund
              cut-off in their event terms — typically a full or partial refund before entries close, and refunds after
              entries close only on production of a veterinary or doctor’s certificate (sometimes minus a small
              administration fee to cover sunk costs).
            </li>
            <li className="mg-lede">
              <strong>Cancelled or abandoned events.</strong> If severe weather, unsafe ground or biosecurity
              restrictions force an organiser to cancel or abandon an event, the organiser will announce whether entry
              fees are refunded in full, refunded minus unavoidable showground costs, or carried over to a rearranged
              date.
            </li>
            <li className="mg-lede">
              <strong>Tack &amp; kit shop and event stalls.</strong> Second-hand tack and kit sold by private
              individuals are peer-to-peer sales agreed in person at the showground — inspect items carefully before
              paying. Items bought from a business or official club stall are covered by the Consumer Rights Act 2015
              and must be as described, fit for purpose and of satisfactory quality. To ask for a refund on an entry or
              stall order, contact the competition organiser or seller listed on your booking.
            </li>
          </ul>
        </div>
      </section>

      {/* 4. COOKIES & OFFLINE STORAGE */}
      <section id="cookies" className="scroll-mt-20 space-y-3">
        <h2 className="px-1 text-xs font-bold uppercase tracking-[0.08em] text-[rgb(var(--mg-muted))]">
          4. Cookies &amp; Offline Storage Policy (UK PECR)
        </h2>

        <div className="mg-card space-y-2 p-4">
          <h3 className="mg-h2">What stays on your device</h3>
          <p className="mg-lede">
            We don’t use tracking or advertising cookies, and we don’t run third-party analytics. Under the UK Privacy
            and Electronic Communications Regulations (PECR), we only use strictly necessary storage so the app works on
            phones at showgrounds, which is why we don’t put a cookie banner in your way. The app keeps these on your
            device:
          </p>
          <ul className="list-disc space-y-1.5 pl-5 marker:text-[rgb(var(--mg-muted))]">
            <li className="mg-lede">your sign-in (`mg.auth`) and any active steward or camera permission token;</li>
            <li className="mg-lede">
              your choices: colour theme, Lite mode, weather, notifications, bottom bar shortcuts, text size, the
              competition you picked and, if you asked it to remember, one small preference cookie (`mg.competition`)
              holding that competition for 180 days;
            </li>
            <li className="mg-lede">
              teams you follow, a draft declaration form you haven’t submitted, any offline scores waiting for signal,
              and banners you saved on a streaming device;
            </li>
            <li className="mg-lede">
              a temporary 30-minute rolling video buffer on a filming phone while broadcasting, used only for local
              judge replay and cleared when you leave the broadcast page;
            </li>
            <li className="mg-lede">
              a saved copy of public pages (timetables, rulebooks, results) in the service worker cache so they still
              open when showground signal drops.
            </li>
          </ul>
          <p className="mg-lede">
            Clearing your browser’s site data removes all of it at once. Organisers can add a YouTube or Twitch stream
            to a competition; if you play one, that provider’s own cookies and policy apply to the video.
          </p>
        </div>
      </section>

      {/* 5. SAFEGUARDING, FILMING & EQUINE WELFARE */}
      <section id="safeguarding" className="scroll-mt-20 space-y-3">
        <h2 className="px-1 text-xs font-bold uppercase tracking-[0.08em] text-[rgb(var(--mg-muted))]">
          5. Safeguarding, Filming &amp; Equine Welfare
        </h2>

        <div className="mg-card space-y-2 p-4">
          <h3 className="mg-h2">Children &amp; arena filming</h3>
          <p className="mg-lede">
            Many riders are under 18. Trainers and parents enter their details on a declaration, and only organisers of
            that competition, the trainer and administrators see dates of birth, weight, medical notes and emergency
            contacts. Arena streams are wide-angle views of the arena — there is no close-up filming of individual
            riders. Anyone who prefers only a surname initial shown on public pages can simply enter their first name
            and surname initial (for example, Oliver S.) on their entry or declaration form. If you want a young
            rider’s details or a stream recording removed, ask the event safeguarding officer or email us below and we
            will act straight away.
          </p>
        </div>

        <div className="mg-card space-y-2 p-4">
          <h3 className="mg-h2">Equine welfare</h3>
          <p className="mg-lede">
            Every competition runs under the horse welfare, rider weight and tack rules of its governing body (EGUK,
            Pony Club, MGA or STRUK). Judges, referees and stewards have full authority to stop a race, require a vet or
            tack check, or excuse a pony that appears lame, exhausted or unsafe.
          </p>
        </div>
      </section>

      <section className="mg-card space-y-2 p-4">
        <h2 className="mg-h2">Questions or requests</h2>
        <p className="mg-lede">
          To see what we hold about you, correct it, report a safeguarding or copyright concern, or ask us to delete
          something the account page can’t, email{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold text-[rgb(var(--mg-heading))] underline">
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </section>
    </div>
  );
}
