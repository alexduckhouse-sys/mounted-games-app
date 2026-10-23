import { Link } from 'react-router-dom';

// TODO: put the real privacy contact address here before launch. It is shown on the page as a placeholder.
const CONTACT_EMAIL = '[contact email to be added]';

export function PrivacyPage() {
  return (
    <div className="skin mx-auto w-full max-w-[560px] space-y-5 py-4">
      <header className="space-y-2">
        <h1 className="mg-h1">Privacy</h1>
        <p className="mg-lede">
          Mounted Games runs competitions on phones. To do that we hold some information about the people taking part
          and using the app. This page says what, why, for how long, and how to get rid of it.
        </p>
      </header>

      <section className="mg-card space-y-2 p-4">
        <h2 className="mg-h2">If you just watch</h2>
        <p className="mg-lede">
          You don't need an account to follow a competition, so we don't know who you are. Your device's IP address
          reaches our servers like it does for any website, and we use it to limit abuse (for example, how often one
          address can ask for a lookup). Those counters last about a minute. Our host, Vercel, keeps its own ordinary
          server logs.
        </p>
        <p className="mg-lede">
          If you watch a live stream, your connection goes through Cloudflare, which carries the video.
        </p>
      </section>

      <section className="mg-card space-y-2 p-4">
        <h2 className="mg-h2">If you have an account</h2>
        <ul className="list-disc space-y-1.5 pl-5 marker:text-[rgb(var(--mg-muted))]">
          <li className="mg-lede"><strong>Account details.</strong> Your name, sign-in (an email address or username), club if you gave one, phone number if you added one to a declaration, and your role. Your password is stored as a hash, never as text.</li>
          <li className="mg-lede"><strong>Entries and declarations.</strong> Declaration forms list riders (name, date of birth if entered, horse, bib colour) and who submitted them. The saved rider list you build is visible only to you and to administrators. Signing up for a competition records your name, club, any contact details you gave and the payment status.</li>
          <li className="mg-lede"><strong>Club payout details.</strong> If you set up payouts for your club, we keep the club's business details, the name and date of birth of the person responsible, and the last four digits of the bank account. Full account numbers are checked and then discarded, never stored. Only that club's managers and administrators can see them.</li>
          <li className="mg-lede"><strong>Notes and teams.</strong> Private trainer notes, and the teams you coach or support.</li>
          <li className="mg-lede"><strong>Chat and the marketplace.</strong> What you post, the name you posted under, and any contact details you put in a listing. Private marketplace messages are visible to the two people involved and to administrators.</li>
          <li className="mg-lede"><strong>Push notifications.</strong> If you turn them on, we keep the address your browser gave us for sending them, until you switch them off or delete your account.</li>
        </ul>
        <p className="mg-lede">
          We use all of this to run competitions: scoring, timetables, entries and moderation. We don't sell it and we
          don't use it for advertising.
        </p>
      </section>

      <section className="mg-card space-y-2 p-4">
        <h2 className="mg-h2">IP addresses on posts</h2>
        <p className="mg-lede">
          When you post a chat message or something in the marketplace, we record your IP address so an administrator can
          block someone who is abusing the service. After 30 days the address is replaced with a scrambled code. That still
          shows when the same address posts again, but the address itself is no longer stored. IP addresses on the block list stay until an administrator removes the block.
        </p>
      </section>

      <section className="mg-card space-y-2 p-4">
        <h2 className="mg-h2">What stays on your device</h2>
        <p className="mg-lede">
          We don't use tracking or advertising cookies, and we don't run analytics. The app keeps these on your device:
        </p>
        <ul className="list-disc space-y-1.5 pl-5 marker:text-[rgb(var(--mg-muted))]">
          <li className="mg-lede">your sign-in;</li>
          <li className="mg-lede">your choices: colour theme, Lite mode, weather, notifications, the competition you picked and, if you asked it to remember, one small preference cookie holding that competition for 180 days;</li>
          <li className="mg-lede">teams you follow, a draft declaration form you haven't submitted, and banners you saved on a streaming device;</li>
          <li className="mg-lede">a saved copy of public pages (timetables, results) so they open without signal.</li>
        </ul>
        <p className="mg-lede">
          Clearing your browser's site data removes all of it. Organisers can add a YouTube or Twitch stream to a
          competition; if you play one, that provider's own cookies and policy apply to the video.
        </p>
      </section>

      <section className="mg-card space-y-2 p-4">
        <h2 className="mg-h2">Deleting your account</h2>
        <p className="mg-lede">
          Signed in, go to <Link to="/me/account" className="font-semibold text-[rgb(var(--mg-heading))] underline">My account</Link> and choose "Delete my account".
          You'll be asked for your password. Your notes, saved riders, push notifications and private marketplace
          messages are deleted. Chat messages, marketplace posts and comments you wrote stay, but your name, IP address
          and contact details are taken off them. Declarations and signups stay as the competition's record (a signup
          keeps the payer's name because it's also a payment record, but loses your contact details). Competitions you
          created and teams you coached stay, with no owner.
        </p>
        <p className="mg-lede">
          If you've published seasons or team history, sold items or placed an order, we keep your account as an empty
          shell that nobody can sign in to, because those records depend on it. It holds no name, email address or
          phone number.
        </p>
        <p className="mg-lede">
          The shared administrator account and the last remaining administrator can't be deleted this way. If you can't
          sign in, write to us and we'll do it for you.
        </p>
      </section>

      <section className="mg-card space-y-2 p-4">
        <h2 className="mg-h2">Children</h2>
        <p className="mg-lede">
          Many riders are under 18. Trainers and parents enter their details on a declaration, and only organisers of that
          competition, the trainer and administrators see dates of birth. A rider can be shown on public pages with their
          surname as an initial only (Oliver S.), and can ask not to be filmed or photographed close up: tick either box
          on the declaration or entry form. If you want a young rider's details removed, ask us at the address below.
        </p>
      </section>

      <section className="mg-card space-y-2 p-4">
        <h2 className="mg-h2">Questions or requests</h2>
        <p className="mg-lede">
          To see what we hold about you, correct it, or ask us to delete something the account page can't, email{' '}
          <span className="font-semibold">{CONTACT_EMAIL}</span>.
        </p>
      </section>
    </div>
  );
}
