import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireStaffAuth } from "./staff.middleware";
import { getOpenShiftOrThrow } from "./shiftCache";
import { listTickets, moveTicket, type TicketAction } from "./tickets.service";

/**
 * Station tickets for the current shift.
 *
 *   GET  /staff/tickets?view=active|served
 *   POST /staff/tickets/:id/accept   station: «Принять»
 *   POST /staff/tickets/:id/ready    station: «Готово»
 *   POST /staff/tickets/:id/served   waiter / hookah master: «Выдано»
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
      });
      res.json({ ok: true, ...result });
    })
  );
}
