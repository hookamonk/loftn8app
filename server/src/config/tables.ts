import { normalizeVenueSlug } from "./venues";

export type BranchTable = {
  displayName: string;
  slug: string;
  legacyCode?: string;
};

function numericTables(from: number, to: number): BranchTable[] {
  const items: BranchTable[] = [];
  for (let value = from; value <= to; value += 1) {
    items.push({
      displayName: String(value),
      slug: String(value),
      legacyCode: `T${value}`,
    });
  }
  return items;
}

function composite(displayName: string): BranchTable {
  return {
    displayName,
    slug: displayName.replace(/\./g, "-").toLowerCase(),
  };
}

function vip(index: number, legacy = false): BranchTable {
  return {
    displayName: `VIP ${index}`,
    slug: `vip-${index}`,
    legacyCode: legacy ? "VIP" : undefined,
  };
}

function bar(index: number): BranchTable {
  return {
    displayName: `Бар ${index}`,
    slug: `bar-${index}`,
  };
}

const BRANCH_TABLES: Record<string, BranchTable[]> = {
  zizkov: [...numericTables(1, 17), vip(1, true)],
  nekazanka: [...numericTables(1, 24), bar(1), bar(2), bar(3)],
  garden: [
    ...numericTables(1, 25),
    composite("2.1"),
    composite("2.2"),
    composite("4.1"),
    composite("4.2"),
    composite("6.1"),
    composite("6.2"),
    composite("7.1"),
    composite("7.2"),
    composite("9.1"),
    composite("9.2"),
    composite("11.1"),
    composite("11.2"),
    composite("12.1"),
    composite("12.2"),
    composite("14.1"),
    composite("14.2"),
    composite("14.3"),
    composite("15.1"),
    composite("15.2"),
    composite("16.1"),
    composite("16.2"),
    composite("17.1"),
    composite("17.2"),
    vip(1),
    vip(2),
    vip(3),
    vip(4),
  ],
};

export function branchTables(rawVenueSlug?: string | null): BranchTable[] {
  const slug = normalizeVenueSlug(rawVenueSlug);
  return BRANCH_TABLES[slug] ?? [];
}

export function normalizeTableSlugInput(raw: string) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;

  const normalized = trimmed.replace(/\s+/g, " ").trim();
  const compactUpper = normalized.toUpperCase();

  if (/^\d+$/.test(normalized)) {
    const value = String(Number(normalized));
    return {
      slugCandidates: [value],
      legacyCodeCandidates: [`T${value}`],
      displayName: value,
    };
  }

  if (/^T\d+$/i.test(compactUpper)) {
    const value = String(Number(compactUpper.slice(1)));
    return {
      slugCandidates: [value],
      legacyCodeCandidates: [compactUpper],
      displayName: value,
    };
  }

  const compositeMatch = normalized.match(/^(\d+)[.,](\d+)$/);
  if (compositeMatch) {
    const displayName = `${Number(compositeMatch[1])}.${Number(compositeMatch[2])}`;
    return {
      slugCandidates: [displayName.replace(/\./g, "-")],
      legacyCodeCandidates: [],
      displayName,
    };
  }

  const vipMatch = normalized.match(/^vip(?:[\s-]?(\d+))?$/i);
  if (vipMatch) {
    const index = String(Number(vipMatch[1] || "1"));
    return {
      slugCandidates: [`vip-${index}`],
      legacyCodeCandidates: index === "1" ? ["VIP"] : [],
      displayName: `VIP ${index}`,
    };
  }

  const barMatch = normalized.match(/^(?:bar|бар)(?:[\s-]?(\d+))$/i);
  if (barMatch) {
    const index = String(Number(barMatch[1]));
    return {
      slugCandidates: [`bar-${index}`],
      legacyCodeCandidates: [],
      displayName: `Бар ${index}`,
    };
  }

  const slug = normalized
    .toLowerCase()
    .replace(/[.]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (!slug) return null;

  return {
    slugCandidates: [slug],
    legacyCodeCandidates: [slug.toUpperCase()],
    displayName: normalized,
  };
}
