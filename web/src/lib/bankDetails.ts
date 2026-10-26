/** What the entrant needs to make a bank transfer. */
export interface BankDetails {
  /** The organiser's account details, as typed (may run to several lines). Null when they haven't given any. */
  payTo: string | null;
  reference: string;
  /** The amount, already formatted ("£32.00"). */
  amount: string;
}

/** The details as plain lines, for pasting into a banking app. */
export function bankDetailsText({ payTo, reference, amount }: BankDetails): string {
  return [payTo && `Pay to: ${payTo}`, `Reference: ${reference}`, `Amount: ${amount}`].filter(Boolean).join('\n');
}
