import { tr } from '../i18n/translate';
/**
 * The word for an entry or order that has been paid. A payment through the demo checkout moves no money, so on a
 * demo event (or for a test order) it says "Demo paid" instead.
 */
export const paidWord = (isDemo?: boolean | null): string => (isDemo ? tr('ops3.shop.demoPaid') : tr('ops3.shop.paid'));
