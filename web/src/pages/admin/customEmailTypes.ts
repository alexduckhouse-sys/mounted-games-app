// Wire types for admin custom emails (api/Dtos/CustomEmailDtos.cs). Enums travel as numbers.

/** Who gets it: 0 people who said yes to news, 1 trainers, 2 organisers and admins. */
export type CustomEmailAudience = 0 | 1 | 2;
/** 0 text, 1 picture, 2 button, 3 competition card. Only the fields for the type are read. */
export type EmailBlockType = 0 | 1 | 2 | 3;
/** 0 sending (call send-batch until `remaining` is 0), 1 done, 2 cancelled. */
export type CustomEmailStatus = 0 | 1 | 2;

export interface EmailBlock {
  type: EmailBlockType;
  /** Plain text. Blank lines make paragraphs; no markup is read. */
  text?: string | null;
  /** From `POST /api/admin/custom-email-images`. */
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
