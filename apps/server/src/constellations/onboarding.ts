import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  ONBOARDING_ANSWER_NEBULAS_MAX,
  ONBOARDING_ANSWER_ROLES_MAX,
  ONBOARDING_ANSWERS_MAX,
  ONBOARDING_DESCRIPTION_MAX,
  ONBOARDING_LABEL_MAX,
  ONBOARDING_QUESTIONS_MAX,
  ONBOARDING_TITLE_MAX,
  type BrowseNebula,
  type OnboardingSettings,
} from "@glofly/shared";
import { db } from "../db";
import { constellationCategories, constellationMemberRoles, constellationMembers, constellationRoles, constellations, nebulas } from "../db/schema";
import type { Tx } from "../messages/routes";

// Communities round 4.3 (approved boards 25–28): onboarding.
//
// Owners and admins write a few questions; new members answer them right after the welcome
// screen. An answer gives roles members may pick themselves (labels, never permissions) and shows
// "optional" nebulas: nebulas for everyone that, while onboarding is on, people only see once
// they pick them (an answer, or Browse nebulas). Who sees what is still decided in one place,
// constellations/access.ts (a nebula's conversation = the people who see it), so unread counts,
// pushes, mentions and the Inbox follow by themselves. Role-only nebulas come with the role.

const HIDDEN_CHARS = /[\u0000-\u001f\u007f-\u009f­؜᠎​-‏‪-‮⁠-⁩﻿]/;
const line = (max: number, what: string) =>
  z
    .string()
    .transform((t) => t.normalize("NFKC").trim())
    .refine((t) => !HIDDEN_CHARS.test(t), `${what} can't have hidden characters.`)
    .refine((t) => t.length <= max, `${what} can be up to ${max} characters.`);
const shortId = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/).optional();

export const onboardingInput = z.object({
  enabled: z.boolean(),
  questions: z
    .array(
      z.object({
        id: shortId,
        title: line(ONBOARDING_TITLE_MAX, "A question").refine((t) => t.length > 0, "Every question needs words."),
        multi: z.boolean(),
        required: z.boolean(),
        answers: z
          .array(
            z.object({
              id: shortId,
              emoji: z.string().max(16).transform((t) => t.trim()),
              label: line(ONBOARDING_LABEL_MAX, "An answer").refine((t) => t.length > 0, "Every answer needs a name."),
              description: line(ONBOARDING_DESCRIPTION_MAX, "An answer's description"),
              roleIds: z.array(z.uuid()).max(ONBOARDING_ANSWER_ROLES_MAX),
              nebulaIds: z.array(z.uuid()).max(ONBOARDING_ANSWER_NEBULAS_MAX),
            }),
          )
          .min(1, "Every question needs at least one answer.")
          .max(ONBOARDING_ANSWERS_MAX, `A question can have up to ${ONBOARDING_ANSWERS_MAX} answers.`),
      }),
    )
    .max(ONBOARDING_QUESTIONS_MAX, `Onboarding can have up to ${ONBOARDING_QUESTIONS_MAX} questions.`),
  /** The nebulas for everyone that become optional (the rest is "Everyone sees") */
  optionalNebulaIds: z.array(z.uuid()).max(200),
});
export type OnboardingInput = z.infer<typeof onboardingInput>;

/** The settings as stored (null when never set up). */
export async function onboardingOf(constellationId: string, x: typeof db | Tx = db): Promise<OnboardingSettings | null> {
  const [c] = await x.select({ onboarding: constellations.onboarding }).from(constellations).where(eq(constellations.id, constellationId));
  return c?.onboarding ?? null;
}

/** Roles answers may give (custom roles members pick themselves), and nebulas that may be optional (for everyone). */
async function choicesOf(constellationId: string, x: typeof db | Tx = db) {
  const roles = await x
    .select({ id: constellationRoles.id })
    .from(constellationRoles)
    .where(and(eq(constellationRoles.constellationId, constellationId), eq(constellationRoles.selfAssign, true), eq(constellationRoles.kind, "custom")));
  const open = await x
    .select({ id: nebulas.id, optional: nebulas.optional, categoryVisibility: constellationCategories.visibility, visibility: nebulas.visibility })
    .from(nebulas)
    .leftJoin(constellationCategories, eq(constellationCategories.id, nebulas.categoryId))
    .where(eq(nebulas.constellationId, constellationId));
  return {
    pickableRoles: new Set(roles.map((r) => r.id)),
    // Only nebulas for everyone (not role-only, not in a role-only category) can be optional.
    forEveryone: new Set(open.filter((n) => n.visibility !== "roles" && n.categoryVisibility !== "roles").map((n) => n.id)),
    optionalNow: new Set(open.filter((n) => n.optional).map((n) => n.id)),
  };
}

/**
 * Checks and saves the settings. Answers only give roles members may pick themselves and only
 * show optional nebulas. Turning onboarding on doesn't hide anything from people already here:
 * they're counted as onboarded and keep every optional nebula; a nebula made optional later
 * stays shown for everyone who's already in. Answers the problem, or null.
 */
export async function saveOnboarding(constellationId: string, input: OnboardingInput): Promise<string | null> {
  return db.transaction(async (tx) => {
    const before = await onboardingOf(constellationId, tx);
    const { pickableRoles, forEveryone, optionalNow } = await choicesOf(constellationId, tx);
    const optional = new Set(input.optionalNebulaIds);
    for (const id of optional) if (!forEveryone.has(id)) return "Only nebulas for everyone can be optional.";
    const seenQuestion = new Set<string>();
    const seenAnswer = new Set<string>();
    const questions = input.questions.map((q) => {
      const qid = q.id && !seenQuestion.has(q.id) ? q.id : randomUUID().slice(0, 12);
      seenQuestion.add(qid);
      return {
        id: qid,
        title: q.title,
        multi: q.multi,
        required: q.required,
        answers: q.answers.map((a) => {
          const aid = a.id && !seenAnswer.has(a.id) ? a.id : randomUUID().slice(0, 12);
          seenAnswer.add(aid);
          return { id: aid, emoji: [...a.emoji].slice(0, 4).join(""), label: a.label, description: a.description, roleIds: [...new Set(a.roleIds)], nebulaIds: [...new Set(a.nebulaIds)] };
        }),
      };
    });
    for (const q of questions)
      for (const a of q.answers) {
        if (a.roleIds.some((id) => !pickableRoles.has(id))) return "Answers can only give roles members may pick themselves.";
        if (a.nebulaIds.some((id) => !optional.has(id))) return "Answers can only show optional nebulas.";
      }
    if (input.enabled && !questions.length) return "Add a question before turning onboarding on.";

    const now = new Date();
    const turningOn = input.enabled && !before?.enabled;
    const newlyOptional = [...optional].filter((id) => !optionalNow.has(id));
    // Everyone already here keeps what they see.
    const keep = turningOn ? [...optional] : newlyOptional;
    if (keep.length) {
      await tx
        .update(constellationMembers)
        .set({ shownNebulas: sql`(select array(select distinct unnest(${constellationMembers.shownNebulas} || ${sql.param(keep)}::uuid[])))` })
        .where(eq(constellationMembers.constellationId, constellationId));
    }
    if (turningOn) {
      await tx
        .update(constellationMembers)
        .set({ onboardedAt: now })
        .where(and(eq(constellationMembers.constellationId, constellationId), sql`${constellationMembers.onboardedAt} is null`));
    }
    await tx
      .update(nebulas)
      .set({ optional: sql`${nebulas.id} = any(${sql.param([...optional])}::uuid[])` })
      .where(eq(nebulas.constellationId, constellationId));
    await tx
      .update(constellations)
      .set({ onboarding: { enabled: input.enabled, questions } })
      .where(eq(constellations.id, constellationId));
    return null;
  });
}

/**
 * My answers to some questions (all of them when `done`). Roles from answers I picked are given;
 * roles from the other answers of those questions are taken off (only roles members pick
 * themselves). Optional nebulas follow the same way. Answers the problem, or null.
 */
export async function answerOnboarding(
  constellationId: string,
  userId: string,
  answers: Record<string, string[]>,
  done: boolean,
): Promise<{ problem: string } | { rolesChanged: boolean }> {
  const settings = await onboardingOf(constellationId);
  if (!settings?.enabled || !settings.questions.length) return { problem: "This constellation has no questions right now." };
  const asked = Object.keys(answers);
  for (const qid of asked) {
    const q = settings.questions.find((x) => x.id === qid);
    if (!q) return { problem: "That question isn't there any more. Reload and try again." };
    const picked = [...new Set(answers[qid])];
    if (picked.some((aid) => !q.answers.some((a) => a.id === aid))) return { problem: "That answer isn't there any more. Reload and try again." };
    if (!q.multi && picked.length > 1) return { problem: `Pick one answer for “${q.title}”.` };
    if (q.required && !picked.length) return { problem: `Answer “${q.title}” to continue.` };
    answers[qid] = picked;
  }
  if (done) {
    const missing = settings.questions.find((q) => q.required && !answers[q.id]?.length);
    if (missing) return { problem: `Answer “${missing.title}” to continue.` };
  }
  return db.transaction(async (tx) => {
    const { pickableRoles, optionalNow } = await choicesOf(constellationId, tx);
    const give = new Set<string>();
    const take = new Set<string>();
    const show = new Set<string>();
    const hide = new Set<string>();
    for (const qid of asked) {
      const q = settings.questions.find((x) => x.id === qid)!;
      for (const a of q.answers) {
        const on = answers[qid].includes(a.id);
        for (const r of a.roleIds) if (pickableRoles.has(r)) (on ? give : take).add(r);
        for (const n of a.nebulaIds) if (optionalNow.has(n)) (on ? show : hide).add(n);
      }
    }
    for (const r of give) take.delete(r);
    for (const n of show) hide.delete(n);
    const held = await tx
      .select({ roleId: constellationMemberRoles.roleId })
      .from(constellationMemberRoles)
      .where(and(eq(constellationMemberRoles.constellationId, constellationId), eq(constellationMemberRoles.userId, userId)));
    const has = new Set(held.map((h) => h.roleId));
    const adding = [...give].filter((r) => !has.has(r));
    const removing = [...take].filter((r) => has.has(r));
    if (adding.length) await tx.insert(constellationMemberRoles).values(adding.map((roleId) => ({ constellationId, userId, roleId }))).onConflictDoNothing();
    if (removing.length)
      await tx
        .delete(constellationMemberRoles)
        .where(and(eq(constellationMemberRoles.constellationId, constellationId), eq(constellationMemberRoles.userId, userId), inArray(constellationMemberRoles.roleId, removing)));
    const [me] = await tx
      .select({ answers: constellationMembers.onboardingAnswers, shown: constellationMembers.shownNebulas, onboardedAt: constellationMembers.onboardedAt })
      .from(constellationMembers)
      .where(and(eq(constellationMembers.constellationId, constellationId), eq(constellationMembers.userId, userId)));
    if (!me) return { problem: "You're not in this constellation." };
    const shown = new Set(me.shown);
    for (const n of hide) shown.delete(n);
    for (const n of show) shown.add(n);
    await tx
      .update(constellationMembers)
      .set({
        onboardingAnswers: { ...(me.answers ?? {}), ...answers },
        shownNebulas: [...shown],
        ...(done && !me.onboardedAt ? { onboardedAt: new Date() } : {}),
      })
      .where(and(eq(constellationMembers.constellationId, constellationId), eq(constellationMembers.userId, userId)));
    return { rolesChanged: adding.length > 0 || removing.length > 0 };
  });
}

/** Browse nebulas: show or hide one optional nebula for me. Answers the problem, or null. */
export async function setNebulaShown(constellationId: string, userId: string, nebulaId: string, shown: boolean): Promise<string | null> {
  const [n] = await db
    .select({ optional: nebulas.optional })
    .from(nebulas)
    .where(and(eq(nebulas.id, nebulaId), eq(nebulas.constellationId, constellationId)));
  if (!n) return "That nebula isn't there any more.";
  if (!n.optional) return "Only optional nebulas can be shown or hidden.";
  await db
    .update(constellationMembers)
    .set({
      shownNebulas: shown
        ? sql`(select array(select distinct unnest(${constellationMembers.shownNebulas} || array[${nebulaId}::uuid])))`
        : sql`array_remove(${constellationMembers.shownNebulas}, ${nebulaId}::uuid)`,
    })
    .where(and(eq(constellationMembers.constellationId, constellationId), eq(constellationMembers.userId, userId)));
  return null;
}

/** The optional nebulas someone doesn't see (with onboarding on). */
export async function browseFor(constellationId: string, seen: Set<string>, onboarding: OnboardingSettings | null): Promise<BrowseNebula[]> {
  if (!onboarding?.enabled) return [];
  const rows = await db
    .select({ id: nebulas.id, name: nebulas.name, kind: nebulas.kind, topic: nebulas.topic, position: nebulas.position, visibility: nebulas.visibility, categoryVisibility: constellationCategories.visibility })
    .from(nebulas)
    .leftJoin(constellationCategories, eq(constellationCategories.id, nebulas.categoryId))
    .where(and(eq(nebulas.constellationId, constellationId), eq(nebulas.optional, true)));
  return rows
    // A nebula limited to roles (itself or by its category) is never listed, even if it was optional before.
    .filter((r) => r.visibility !== "roles" && r.categoryVisibility !== "roles")
    .filter((r) => !seen.has(r.id))
    .sort((a, b) => a.position - b.position)
    .map((r) => ({ id: r.id, name: r.name, kind: r.kind === "voice" ? "voice" : r.kind === "forum" ? "forum" : "text", topic: r.topic }));
}
