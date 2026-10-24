import { publicTableCode } from "../../config/venues";

/** The table as staff see it: the printed label when there is one, else the code. */
export function toPublicTable<T extends { code: string; label: string | null }>(table: T): T {
  const publicCode = publicTableCode(table.code);
  return {
    ...table,
    code: table.label?.trim() || publicCode,
    label: table.label && table.label.trim() && table.label.trim() !== publicCode ? table.label : null,
  };
}
