import type { CallType } from "@prisma/client";

/**
 * The three hookah calls a guest can make. The guest app sends the code as the
 * call message ("HOOKAH:COALS"); staff screens and pushes show it in Russian.
 */
export const HOOKAH_REASON_LABEL: Record<string, string> = {
  "HOOKAH:COALS": "Поменять угли",
  "HOOKAH:HARSH": "Кальян горит",
  "HOOKAH:NEW": "Новый кальян",
};

/** The call message as staff should read it. */
export function staffCallMessage(type: CallType, message: string | null | undefined) {
  if (!message) return message ?? null;
  if (type === "HOOKAH") return HOOKAH_REASON_LABEL[message.trim()] ?? message;
  return message;
}
