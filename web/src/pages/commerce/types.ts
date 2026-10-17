export type CommerceItemCategory = 0 | 1 | 2 | 3;
export type CommerceListingStatus = 0 | 1 | 2 | 3;
export type CommerceOrderStatus = 0 | 1 | 2 | 3 | 4 | 5;
export type FakePaymentOutcome = 0 | 1 | 2;
export type TestPaymentStatus = 0 | 1 | 2 | 3;

export interface CatalogueItem {
  id: number;
  title: string;
  description: string;
  priceMinor: number;
  currency: 'GBP';
  stockQuantity: number | null;
  category: CommerceItemCategory;
  imageUrl: string | null;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CompetitionListing {
  id: number;
  competitionId: number;
  catalogueItemId: number;
  sellerUserId: string;
  status: CommerceListingStatus;
  reviewNote: string | null;
  reviewedAt: string | null;
  item: CatalogueItem;
  createdAt: string;
  updatedAt: string;
}

export interface PublicCompetitionListing {
  id: number;
  competitionId: number;
  catalogueItemId: number;
  title: string;
  description: string;
  priceMinor: number;
  currency: 'GBP';
  stockQuantity: number | null;
  category: CommerceItemCategory;
  imageUrl: string | null;
}

export interface EventCommerceSettings {
  competitionId: number;
  isDemo: boolean;
  isLocked: boolean;
  updatedAt: string | null;
}

export interface EventOrderLine {
  id: number;
  listingId: number;
  catalogueItemId: number;
  sellerUserId: string;
  title: string;
  unitPriceMinor: number;
  quantity: number;
  lineTotalMinor: number;
}

export interface TestPayment {
  id: number;
  competitionId: number;
  target: 0 | 1;
  targetId: number;
  operation: 0 | 1;
  requestedOutcome: FakePaymentOutcome | null;
  status: TestPaymentStatus;
  amountMinor: number;
  currency: 'GBP';
  isTest: true;
  provider: 'fake';
  receiptReference: string;
  receiptLabel: string;
  createdAt: string;
}

export interface EventOrder {
  id: number;
  competitionId: number;
  buyerUserId: string;
  status: CommerceOrderStatus;
  totalMinor: number;
  currency: 'GBP';
  isTestOrder: boolean;
  hasStockReservation: boolean;
  paidAt: string | null;
  cancelledAt: string | null;
  refundedAt: string | null;
  lines: EventOrderLine[];
  testPayments: TestPayment[];
  createdAt: string;
  updatedAt: string;
}

export interface SellerSale {
  orderId: number;
  competitionId: number;
  status: CommerceOrderStatus;
  sellerTotalMinor: number;
  currency: 'GBP';
  isTestOrder: boolean;
  lines: EventOrderLine[];
  createdAt: string;
}

export interface DemoOrderPaymentResult {
  order: EventOrder;
  payment: TestPayment;
}

export interface DemoEntryPaymentResult {
  signupId: number;
  signupStatus: 0 | 1 | 2 | 3;
  paidAt: string | null;
  payment: TestPayment;
}

export interface CompetitionChoice {
  id: number;
  name: string;
  startDate: string;
  location?: string | null;
}

export interface CompetitionChoicePage {
  items: CompetitionChoice[];
  hasMore: boolean;
}
