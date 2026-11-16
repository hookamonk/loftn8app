import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { HttpError } from "../../utils/httpError";
import { requireStaffAuth } from "./staff.middleware";
import { getOpenShiftOrThrow } from "./shiftCache";
import { ETA_MINUTES, listTickets, moveTicket, setTicketEta, type TicketAction } from "./tickets.service";
import { staffDeviceOf } from "./staffDevice";

/**
 * Station tickets for the current shift.
 *
 *   GET  /staff/tickets?view=active|served
 *   POST /staff/tickets/:id/accept   station: «Принять»
 *   POST /staff/tickets/:id/ready    station: «Готово»
 *   POST /staff/tickets/:id/served   waiter / hookah master: «Выдано»
 *   POST /staff/tickets/:id/eta      station: «Выдача через 10–40 мин» (busy hours)
 *
 * Who may do what is decided in roles.ts; every list is already filtered to
 * the stations the caller works with.
 */
export const staffTicketsRouter = Router();
staffTicketsRouter.use(requireStaffAuth);

const ListQuerySchema = z.object({
  view: z.enum(["active", "served"]).default("active"),
});

staffTicketsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { view } = ListQuerySchema.parse(req.query);
    const venueId = req.staff!.venueId;
    const shift = await getOpenShiftOrThrow(venueId);

    const tickets = await listTickets({ venueId, shiftId: shift.id, role: req.staff!.role, view });
    res.json({ ok: true, tickets, serverTime: new Date().toISOString() });
  })
);

const ACTIONS: TicketAction[] = ["accept", "ready", "served"];

for (const action of ACTIONS) {
  staffTicketsRouter.post(
    `/:id/${action}`,
    asyncHandler(async (req, res) => {
      const venueId = req.staff!.venueId;
      await getOpenShiftOrThrow(venueId);

      const result = await moveTicket({
        ticketId: String(req.params.id),
        venueId,
        staffId: req.staff!.staffId,
        role: req.staff!.role,
        action,
        deviceId: staffDeviceOf(req),
      });
      res.json({ ok: true, ...result });
    })
  );
}

const EtaSchema = z.object({
  minutes: z
    .number()
    .int()
    .refine((m) => (ETA_MINUTES as readonly number[]).includes(m))
    .nullable(),
});

staffTicketsRouter.post(
  "/:id/eta",
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;
    await getOpenShiftOrThrow(venueId);
    const parsed = EtaSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "INVALID_INPUT", "Время: от 10 до 40 минут");
    const { minutes } = parsed.data;

    const result = await setTicketEta({
      ticketId: String(req.params.id),
      venueId,
      staffId: req.staff!.staffId,
      role: req.staff!.role,
      minutes,
    });
    res.json({ ok: true, ...result });
  })
);
