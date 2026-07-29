import { Router } from "express";
import { staffAuthRouter } from "./staffAuth.routes";
import { staffDashboardRouter } from "./staffDashboard.routes";
import { staffPushRouter } from "./push.routes";
import { staffShiftRouter } from "./shift.routes";
import { staffAdminRouter } from "./admin.routes";
import { staffMenuAdminRouter } from "./menuAdmin.routes";

export const staffRouter = Router();

staffRouter.use("/auth", staffAuthRouter);
staffRouter.use("/dashboard", staffDashboardRouter);
staffRouter.use("/push", staffPushRouter);
staffRouter.use("/shift", staffShiftRouter);
// Mount the menu editor BEFORE the generic /admin router so /admin/menu/* is
// handled only here (no redundant auth pass through staffAdminRouter's `.use`).
staffRouter.use("/admin/menu", staffMenuAdminRouter);
staffRouter.use("/admin", staffAdminRouter);
