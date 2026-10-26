import { footerShown, linkedParagraphs, type EmailDraft } from './emailDraft';

/**
 * What the email will look like: an ordinary email, text and pictures only. A From / To / Subject strip sits above it,
 * linked words are underlined and the footer comes last. The API makes the real HTML; this mirrors it.
 */
export function EmailPreview({ draft, to }: { draft: EmailDraft; to: string }) {
  const { paragraphs } = linkedParagraphs(draft.message, draft.links);
  const news = draft.audience === 0;
  const usual = !draft.footerText?.trim();
  return (
    <div className="em-prev">
      <div className="em-prev-meta">
        <span><b>From</b> Mounted Games</span>
        <span><b>To</b> {to}</span>
        <span><b>Subject</b> {draft.subject.trim() || 'Your subject'}</span>
      </div>
      <div className="em-prev-body">
        {draft.kind === 'text' && (paragraphs.length === 0
          ? <p className="em-prev-empty">Your message</p>
          : paragraphs.map((parts, i) => (
            <p key={i}>{parts.map((part, j) => (part.link ? <u key={j} className="em-lnk">{part.text}</u> : part.text))}</p>
          )))}
        {draft.kind === 'picture' && (draft.picture
          ? (draft.pictureLink
            ? <u className="em-lnk em-prev-pic"><img src={draft.picture.url} alt={draft.subject.trim()} /></u>
            : <img className="em-prev-pic" src={draft.picture.url} alt={draft.subject.trim()} />)
          : <p className="em-prev-empty em-prev-slot">Picture goes here</p>)}
        <div className="em-prev-foot">
          {draft.footerPicture && <img src={draft.footerPicture.url} alt="" />}
          <p>
            {footerShown(draft)}
            {news && <>{' '}<u>Unsubscribe</u>{usual ? ' at any time.' : ''}</>}
          </p>
        </div>
      </div>
    </div>
  );
}
