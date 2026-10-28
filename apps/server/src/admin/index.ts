import { Router } from "express";
import { requireAdminNetwork } from "./network";
import { adminConfigured } from "./secrets";
import { adminAuthRouter, requireAdmin } from "./auth";
import { adminRouter } from "./routes";
import { moderationRouter } from "./moderation";
import { familyRouter } from "./family";
import { serverRouter } from "./server";
import { constellationsAdminRouter } from "./constellations";
import { errorsAdminRouter } from "../errors";
import { devicePairRouter, devicesRouter, deviceSignatureLimiter } from "./devices";
import { alertsRouter } from "./alerts";
import { opsRouter } from "./ops";
import { inboxRouter } from "./inbox";
import { insightsRouter } from "./insights";

// Everything under /admin: Glofly Control (the admin app). In order:
//   1. only from the admin's network (ADMIN_IPS; Caddy checks this too on the live server)
//   2. only if Control is set up on this server (ADMIN_KEY)
//   3. sign-in routes, then everything else needs an admin session
// 0.8.2: a request signed by an approved phone passes step 1 from anywhere (devices.ts).

export const controlRouter = Router();

controlRouter.use(deviceSignatureLimiter);
controlRouter.use(requireAdminNetwork);
controlRouter.use((_req, res, next) => {
  // Admin answers are never cached anywhere.
  res.set("Cache-Control", "no-store");
  if (!adminConfigured()) {
    res.status(503).json({
      error: "control_unavailable",
      message: "Glofly Control isn't set up on this server yet (ADMIN_KEY is missing).",
    });
    return;
  }
  next();
});
// 0.8.2: approving a phone (Control for iPhone) happens before signing in on it.
controlRouter.use("/devices", devicePairRouter);
controlRouter.use("/auth", adminAuthRouter);
controlRouter.use(
  requireAdmin,
  adminRouter,
  moderationRouter,
  familyRouter,
  serverRouter,
  constellationsAdminRouter,
  errorsAdminRouter,
  devicesRouter,
  alertsRouter,
  opsRouter,
  inboxRouter,
  insightsRouter,
);
