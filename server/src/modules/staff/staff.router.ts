import { Router } from "express";
import { staffAuthRouter } from "./staffAuth.routes";
import { staffDashboardRouter } from "./staffDashboard.routes";
import { staffPushRouter } from "./push.routes";
import { staffShiftRouter } from "./shift.routes";
import { staffAdminRouter } from "./admin.routes";

export const staffRouter = Router();

staffRouter.use("/auth", staffAuthRouter);
staffRouter.use("/dashboard", staffDashboardRouter);
staffRouter.use("/push", staffPushRouter);
staffRouter.use("/shift", staffShiftRouter);
staffRouter.use("/admin", staffAdminRouter);
