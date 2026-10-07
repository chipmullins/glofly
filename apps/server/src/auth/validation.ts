import { z } from "zod";

// Rules for new accounts. These match the register screen design, and the
// register screen will show the same rules live as people type.

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
export const DISPLAY_NAME_MAX = 32;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128; // stops someone sending a huge "password" to slow the server
export const MINIMUM_AGE = 13;

// Handles nobody should be able to claim, so no one can impersonate staff.
const RESERVED_USERNAMES = new Set([
  "admin",
  "administrator",
  "glofly",
  "gloflyapp",
  "help",
  "mod",
  "moderator",
  "official",
  "root",
  "security",
  "staff",
  "support",
  "system",
  "team",
]);

export const usernameSchema = z
  .string({ error: "Choose a username." })
  .trim()
  .min(USERNAME_MIN, `Usernames need at least ${USERNAME_MIN} characters.`)
  .max(USERNAME_MAX, `Usernames can be at most ${USERNAME_MAX} characters.`)
  .regex(
    /^[a-zA-Z0-9](?:[a-zA-Z0-9._]*[a-zA-Z0-9])?$/,
    "Use letters, numbers, periods and underscores. Start and end with a letter or number.",
  )
  .refine((u) => !/[._]{2}/.test(u), "Periods and underscores can't be next to each other.")
  .refine((u) => !RESERVED_USERNAMES.has(u.toLowerCase()), "That username isn't available.");

// Control characters (invisible formatting codes) are blocked so names can't break layouts.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/;

const displayNameSchema = z
  .string({ error: "Enter a display name." })
  .trim()
  .min(1, "Enter a display name.")
  .max(DISPLAY_NAME_MAX, `Display names can be at most ${DISPLAY_NAME_MAX} characters.`)
  .refine((n) => !CONTROL_CHARS.test(n), "Display names can't contain hidden characters.");

const emailSchema = z
  .string({ error: "Enter your email address." })
  .trim()
  .max(254, "That email address is too long.")
  .pipe(z.email("Enter a valid email address."));

const passwordSchema = z
  .string({ error: "Choose a password." })
  .min(PASSWORD_MIN, `Passwords need at least ${PASSWORD_MIN} characters.`)
  .max(PASSWORD_MAX, `Passwords can be at most ${PASSWORD_MAX} characters.`)
  .regex(/[0-9]/, "Passwords need at least one number.")
  .regex(/\p{L}/u, "Passwords need at least one letter.");

/** Age in whole years on `today` for someone born on `birthday` (both YYYY-MM-DD). */
export function ageOn(birthday: string, today: Date): number {
  const [y, m, d] = birthday.split("-").map(Number);
  let age = today.getUTCFullYear() - y;
  const beforeBirthdayThisYear =
    today.getUTCMonth() + 1 < m || (today.getUTCMonth() + 1 === m && today.getUTCDate() < d);
  if (beforeBirthdayThisYear) age -= 1;
  return age;
}

function isRealDate(value: string): boolean {
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

const birthdaySchema = z
  .string({ error: "Enter your birthday." })
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter your birthday.")
  .refine(isRealDate, "That date doesn't exist.")
  .refine((b) => Number(b.slice(0, 4)) >= 1900, "Check the year you were born.")
  .refine((b) => ageOn(b, new Date()) >= 0, "Your birthday can't be in the future.")
  .refine(
    (b) => ageOn(b, new Date()) >= MINIMUM_AGE,
    `You need to be at least ${MINIMUM_AGE} to use Glofly.`,
  );

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
});

export type RegisterInput = z.infer<typeof registerSchema>;

// Login only checks the shape. Whether the details are right is decided by the database.
export const loginSchema = z.object({
  identifier: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(PASSWORD_MAX),
  keepSignedIn: z.boolean().default(false),
  deviceName: z.string().trim().max(60).optional(),
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
