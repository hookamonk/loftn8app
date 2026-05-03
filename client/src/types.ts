export type MenuItem = {
  id: number;
  name: string;
  description?: string | null;
  priceCzk: number;
  imageUrl?: string | null;
};

export type MenuSection = "DISHES" | "DRINKS" | "HOOKAH";

export type MenuCategory = {
  id: number; 
  name: string;
  sort: number;
  section: MenuSection;
  items: MenuItem[];
};

export type MenuResponse = {
  venue: { id: number; name: string; slug: string };
  categories: MenuCategory[];
};

export type CartItem = {
  menuItemId: number;
  name: string;
  priceCzk: number;
  qty: number;
  comment?: string;
};

export type AuthMeResponse =
  | { authenticated: false }
  | {
      authenticated: true;
      user: {
        id: string;
        name: string;
        phone: string;
        email: string;
        role: string;
      };
    };

export type AccountReceipt = {
  id: string;
  venue: { id: number; slug: string; name: string };
  method: "CARD" | "CASH";
  methodLabel: string;
  amountCzk: number;
  billTotalCzk: number;
  loyaltyAppliedCzk: number;
  cashbackEarnedCzk: number;
  closedAt: string;
  itemCount: number;
  items: Array<{
    key: string;
    name: string;
    qty: number;
    totalCzk: number;
    comment?: string;
  }>;
};

export type AccountLoyaltyEntry = {
  id: string;
  venue: { id: number; slug: string; name: string };
  createdAt: string;
  availableAt: string;
  baseAmountCzk: number;
  cashbackCzk: number;
  redeemedAmountCzk: number;
  remainingCzk: number;
  status: "available" | "pending" | "redeemed" | "partial";
};

export type AccountOverviewResponse = {
  ok: true;
  user: {
    id: string;
    name: string;
    phone: string;
    email: string;
    role: string;
    privacyAcceptedAt: string | null;
    createdAt: string;
  };
  loyalty: {
    availableCzk: number;
    pendingCzk: number;
    nextAvailableAt: string | null;
    cashbackPercent: number;
    history: AccountLoyaltyEntry[];
  };
  receipts: AccountReceipt[];
};
