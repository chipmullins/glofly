import { z } from "zod";

// Rules for new accounts. The limits and messages live in @glofly/shared, so the apps show
// exactly the same rules live as people type.

import {
  birthdayProblem,
  displayNameProblem,
  passwordProblem,
  usernameProblem,
  EMAIL_MAX,
} from "@glofly/shared";

export {
  USERNAME_MIN,
  USERNAME_MAX,
  DISPLAY_NAME_MAX,
  PASSWORD_MIN,
  PASSWORD_MAX,
  MINIMUM_AGE,
  ageOn,
} from "@glofly/shared";
import { PASSWORD_MAX } from "@glofly/shared";

/** Adds the shared rule's message as a validation problem when there is one. */
const rule =
  (problem: (value: string) => string | null) =>
  (value: string, ctx: z.RefinementCtx) => {
    const message = problem(value);
    if (message) ctx.addIssue({ code: "custom", message });
  };

export const usernameSchema = z.string({ error: "Choose a username." }).trim().superRefine(rule(usernameProblem));

export const displayNameSchema = z
  .string({ error: "Enter a display name." })
  .trim()
  .superRefine(rule(displayNameProblem));

export const emailSchema = z
  .string({ error: "Enter your email address." })
  .trim()
  .max(EMAIL_MAX, "That email address is too long.")
  .pipe(z.email("Enter a valid email address."));

export const passwordSchema = z.string({ error: "Choose a password." }).superRefine(rule(passwordProblem));

export const birthdaySchema = z
  .string({ error: "Enter your birthday." })
  .superRefine(rule((b) => birthdayProblem(b)));

export const registerSchema = z.object({
  email: emailSchema,
  username: usernameSchema,
  displayName: displayNameSchema,
  password: passwordSchema,
  birthday: birthdaySchema,
  acceptTerms: z.literal(true, {
    error: "Please agree to the Terms of Service and Privacy Policy.",
  }),
  deviceName: z.string().trim().max(60).optional(),
  // Needed while sign-ups are invite only (Control → Sign-ups). Checked in the route.
  inviteCode: z.string().trim().max(20).optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;

// Login only checks the shape. Whether the details are right is decided by the database.
export const loginSchema = z.object({
  identifier: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(PASSWORD_MAX),
  keepSignedIn: z.boolean().default(false),
  deviceName: z.string().trim().max(60).optional(),
  // Logging in to an account that's set to be deleted: true restores it.
  restore: z.boolean().default(false),
});

export const forgotPasswordSchema = z.object({
  identifier: z.string().trim().min(1).max(254),
});

/** Turns validation problems into { field: "message" }, first problem per field. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form");
    if (!out[field]) out[field] = issue.message;
  }
  return out;
}
