import express, { Router, type NextFunction, type Request, type Response } from "express";
import { requireAuth } from "../auth/sessions";
import { coreRouter } from "./routes";
import { playRouter } from "./play";
import { contentRouter } from "./content";
import { hubRouter } from "./hub";
import { sweepPresence } from "./live";
import { campaignRow } from "./perms";
import { broadcast, forgetAudience } from "./state";
import { presentAt } from "./live";

// Campfire (phase 1, Nov 2026): the tabletop, mounted at /campfire after the Pause gate.
// Its own JSON limit (sheets, built maps and handouts are bigger than chat requests).

export const campfireRouter = Router();
campfireRouter.use(requireAuth);
campfireRouter.use(express.json({ limit: "512kb" }));
campfireRouter.use(coreRouter, playRouter, contentRouter, hubRouter);
campfireRouter.use((_req: Request, res: Response, _next: NextFunction) => {
  res.status(404).json({ error: "not_found" });
});

/** Every 15 s: people whose app stopped saying they're at a table leave it. */
export async function sweepCampfirePresence(): Promise<void> {
  for (const campaignId of sweepPresence()) {
    forgetAudience(campaignId);
    const campaign = await campaignRow(campaignId);
    if (!campaign) continue;
    const present = presentAt(campaignId);
    await broadcast(campaign, "campfire:presence", () => ({ present }));
  }
}

export { sweepDeletedCampaigns } from "./routes";
export { sweepSessionReminders } from "./hub";
export { campfireFilesOfLeaver, removeStored } from "./files";
