// Wire types for admin custom emails (api/Dtos/CustomEmailDtos.cs). Enums travel as numbers.

/** Who gets it: 0 people who said yes to news, 1 trainers, 2 organisers and admins, 3 admins only. */
export type CustomEmailAudience = 0 | 1 | 2 | 3;
/** 0 text, 1 picture, 2 button, 3 competition card, 4 footer. Only the fields for the type are read. */
export type EmailBlockType = 0 | 1 | 2 | 3 | 4;
/** A page on the site that a link can open for an event: 0 the competition page, 1 entry form, 2 timetable, 3 results. */
export type EmailPage = 0 | 1 | 2 | 3;

/**
 * Words in a text block that become a link: an https `url`, or a site page for an event (`competitionId` + `page`), which
 * the API turns into that page's https address.
 */
export interface EmailLink {
  words: string;
  url?: string | null;
  competitionId?: number | null;
  page?: EmailPage | null;
}
/** 0 sending (call send-batch until `remaining` is 0), 1 done, 2 cancelled. */
export type CustomEmailStatus = 0 | 1 | 2;

export interface EmailBlock {
  type: EmailBlockType;
  /** Plain text. Blank lines make paragraphs; no markup is read. For a footer, blank means the usual line. */
  text?: string | null;
  /** Words in a text block that link somewhere. */
  links?: EmailLink[] | null;
  /** With `competitionId`, the site page a picture links to (or use `url`). */
  page?: EmailPage | null;
  /** From `POST /api/admin/custom-email-images`. A picture block's, or a footer's picture. */
  imageId?: string | null;
  alt?: string | null;
  /** A button's label (up to 60 characters) and its https link. */
  label?: string | null;
  url?: string | null;
  competitionId?: number | null;
}

export interface CustomEmailContent {
  subject: string;
  audience: CustomEmailAudience;
  blocks: EmailBlock[];
}

/** `POST /api/admin/custom-emails`: `expectedRecipients` is the number the admin saw, so a changed list is caught. */
export interface SendCustomEmailRequest extends CustomEmailContent {
  confirm: boolean;
  expectedRecipients: number;
}

export interface CustomEmailAudienceCount {
  audience: CustomEmailAudience;
  label: string;
  recipients: number;
}

export interface CustomEmailPreview {
  subject: string;
  html: string;
  text: string;
}

export interface CustomEmailImage {
  id: string;
  url: string;
  bytes: number;
}

export interface CustomEmailSummary {
  id: number;
  subject: string;
  audience: CustomEmailAudience;
  status: CustomEmailStatus;
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  /** People still to try. The send is finished when this is 0. */
  remaining: number;
  createdAt: string;
  completedAt: string | null;
  createdByName: string | null;
}

export interface CustomEmailDetail {
  email: CustomEmailSummary;
  blocks: EmailBlock[];
}
