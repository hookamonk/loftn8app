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
