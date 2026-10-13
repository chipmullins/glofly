import express, { Router, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { passwordSchema, PASSWORD_MAX } from "../auth/validation";
import { confirmEmail, resetPassword } from "../account/email";
import { findToken, looksLikeToken } from "../email/tokens";
import { birthdaySchema } from "../auth/validation";
import { acceptInvite, findInvite, inviterName, type Invite } from "../admin/invites";
import { displayNameSchema, usernameSchema } from "../auth/validation";
import { getSignupMode } from "../admin/signups";
import { acceptFriendInvite, findFriendInvite, FRIEND_INVITE_DAYS, type FriendInvite } from "../friends/invites";
import { DISPLAY_NAME_MAX, USERNAME_MAX } from "@glofly/shared";

// The pages people open from Glofly's emails:
//   /reset?t=…    choose a new password (Forgot password)
//   /confirm?t=…  confirm an email address (after sign-up, or a new address)
//   /welcome?t=…  finish an account made in Glofly Control
//   /join?t=…     make an account from a friend's invite (0.3.0, "Invite your friends")
//
// They live at https://glofly.app/reset and /confirm: Caddy hands just those two paths
// from the website to this server. Plain HTML forms, no scripts at all. Opening a link
// never uses it up (mail apps "pre-open" links to scan them); only pressing the button does.

export const webRouter = Router();

// Pressing a button (POST) is limited more tightly than opening a page.
const limiter = (limit: number) =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, res) =>
      page(res.status(429), {
        title: "Slow down a little",
        body: `<p>Too many tries from here. Wait a few minutes and try again.</p>`,
      }),
  });
const openLimiter = limiter(60);
const submitLimiter = limiter(20);

const formBody = express.urlencoded({ extended: false, limit: "4kb" });

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const tokenFrom = (value: unknown): string | null => (looksLikeToken(value) ? value : null);

function page(res: Response, { title, body }: { title: string; body: string }): void {
  res.set({
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy":
      "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    "Referrer-Policy": "no-referrer", // the link's token never leaks to another site
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex",
  }).send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Glofly</title>
<style>
  /* Same look as glofly.app: a twilight sky across the top (like the app icon), the card on top of it. */
  :root { color-scheme: light; --page:#fffaf5; --card:#fff; --line:#eaddd1; --ink:#24170f; --muted:#6b5547; --accent:#f47a1f; --accent-deep:#e2650f; --on-accent:#2a1406; --link:#b8430a; --tint:#fde9d7; --error:#a1241a; --error-bg:#fdecea; --ok:#1f8a4c; --ok-tint:#e6f5ec; --night-top:#33215f; --night:#1b1036; --sky-ink:#fbf5ff; --glow:#ffb347; --glow-pale:#ffd27a; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:flex; justify-content:center; padding:28px 16px 48px; color:var(--ink); font:400 16px/1.6 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, Helvetica, Arial, sans-serif;
    background:
      radial-gradient(3px 3px at 14% 40px, rgba(255,210,122,.9), transparent 70%),
      radial-gradient(2px 2px at 82% 70px, rgba(255,210,122,.8), transparent 70%),
      radial-gradient(1.5px 1.5px at 30% 120px, #fff, transparent 70%),
      radial-gradient(1.5px 1.5px at 64% 30px, #fff, transparent 70%),
      radial-gradient(1px 1px at 92% 180px, #fff, transparent 70%),
      radial-gradient(1px 1px at 6% 200px, #fff, transparent 70%),
      linear-gradient(180deg, var(--night-top) 0, var(--night) 260px, var(--page) 260px) no-repeat; }
  main { width:100%; max-width:460px; }
  .brand { display:flex; align-items:center; gap:11px; margin:0 0 22px 4px; font-weight:700; font-size:23px; color:var(--sky-ink); text-decoration:none; }
  .brand img { width:40px; height:40px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:22px; padding:32px 30px 28px; box-shadow:0 30px 60px -30px rgba(27,16,54,.55); }
  h1 { margin:0 0 12px; font-size:25px; line-height:1.25; letter-spacing:-.01em; }
  p { margin:0 0 14px; }
  .muted { color:var(--muted); font-size:14px; }
  label { display:block; margin:16px 0 6px; font-weight:600; font-size:14px; }
  input[type=password], input[type=text] { width:100%; padding:12px 14px; border:1.5px solid var(--line); border-radius:12px; font:inherit; color:var(--ink); background:#fff; }
  input[type=password]:focus, input[type=text]:focus { outline:none; border-color:var(--accent); box-shadow:0 0 0 3px rgba(244,122,31,.2); }
  button { margin-top:22px; width:100%; padding:15px 18px; border:0; border-radius:12px; background:linear-gradient(180deg, var(--glow-pale), var(--glow) 55%, #ff8a1f); color:var(--on-accent); font-family:inherit; font-size:16px; font-weight:700; line-height:1; cursor:pointer; box-shadow:0 12px 26px -12px rgba(255,138,31,.8); }
  button:hover { filter:brightness(1.04); }
  button:focus-visible { outline:3px solid rgba(244,122,31,.45); outline-offset:3px; }
  .error { margin:16px 0 0; padding:10px 12px; border-radius:10px; background:var(--error-bg); color:var(--error); font-size:14px; }
  .done { display:inline-grid; place-items:center; width:48px; height:48px; margin-bottom:12px; border-radius:50%; background:var(--ok-tint); color:var(--ok); font-size:24px; font-weight:700; }
  .address { font-weight:600; word-break:break-all; }
  select { width:100%; min-height:48px; padding:0 10px; border:1.5px solid var(--line); border-radius:12px; font:inherit; color:var(--ink); background:#fff; }
  select:focus { outline:none; border-color:var(--accent); box-shadow:0 0 0 3px rgba(244,122,31,.2); }
  fieldset { margin:16px 0 0; padding:0; border:0; }
  legend { padding:0; margin-bottom:6px; font-weight:600; font-size:14px; }
  .dob { display:grid; grid-template-columns:1.4fr 1fr 1.1fr; gap:10px; }
  .check { display:flex; align-items:flex-start; gap:10px; margin:18px 0 0; font-weight:400; font-size:14px; line-height:1.45; cursor:pointer; }
  .check input { width:18px; height:18px; margin:1px 0 0; accent-color:var(--accent); flex-shrink:0; }
  .check a, .muted a, p a { color:var(--link); }
  .person { display:flex; align-items:center; gap:14px; margin:4px 0 6px; padding:14px 16px; border-radius:16px; background:linear-gradient(135deg, #2a1a52, var(--night)); color:var(--sky-ink); }
  .initials { width:48px; height:48px; flex-shrink:0; border-radius:50%; display:grid; place-items:center; background:var(--glow); color:var(--on-accent); font-weight:700; box-shadow:0 0 0 3px rgba(255,179,71,.25), 0 0 22px rgba(255,166,60,.55); }
  .person-text { display:flex; flex-direction:column; min-width:0; line-height:1.35; font-size:14px; }
  .person-text strong { font-size:16px; }
  .person-text span { color:#cbbde6; overflow-wrap:anywhere; }
  .perks { display:grid; gap:6px; margin:16px 0 0; padding:0; list-style:none; font-size:14px; color:var(--muted); }
  .perks li::before { content:'✦'; color:var(--glow); margin-right:8px; }
  .hint { margin:6px 0 0; color:var(--muted); font-size:13px; }
  .downloads { display:grid; gap:10px; margin-top:20px; }
  .download { display:block; padding:14px 18px; border-radius:12px; background:linear-gradient(180deg, var(--glow-pale), var(--glow) 55%, #ff8a1f); color:var(--on-accent); font-weight:700; text-align:center; text-decoration:none; box-shadow:0 12px 26px -12px rgba(255,138,31,.8); }
  .download.alt { background:#fff; color:var(--ink); border:1.5px solid var(--line); box-shadow:none; }
  .download:hover { filter:brightness(1.04); }
  .download.alt:hover { border-color:var(--accent); }
</style>
</head>
<body>
<main>
  <a class="brand" href="https://glofly.app"><img src="/logo.svg" alt="">Glofly</a>
  <div class="card">
${body}
  </div>
</main>
</body>
</html>`);
}

const expired = (res: Response, what: "reset" | "confirm"): void =>
  page(res.status(410), {
    title: "This link has expired",
    body: `<h1>This link doesn't work any more</h1>
<p>It may have expired, or it was already used. Each link works only once.</p>
<p class="muted">${
      what === "reset"
        ? "Need a new one? In Glofly, choose <strong>Forgot password?</strong> on the login screen."
        : "Need a new one? In Glofly, open <strong>Settings → Account</strong> and choose <strong>Resend link</strong>."
    }</p>`,
  });

// ───────────── Choose a new password ─────────────

function resetForm(res: Response, token: string, error?: string): void {
  page(res, {
    title: "Choose a new password",
    body: `<h1>Choose a new password</h1>
<p class="muted">At least 8 characters, with a letter and a number. You'll be signed out of Glofly everywhere, then you can log in with the new one.</p>
<form method="post" action="/reset">
  <input type="hidden" name="t" value="${esc(token)}">
  <label for="password">New password</label>
  <input id="password" name="password" type="password" autocomplete="new-password" maxlength="${PASSWORD_MAX}" required autofocus>
  <label for="confirm">Type it again</label>
  <input id="confirm" name="confirm" type="password" autocomplete="new-password" maxlength="${PASSWORD_MAX}" required>
  ${error ? `<p class="error" role="alert">${esc(error)}</p>` : ""}
  <button type="submit">Save new password</button>
</form>`,
  });
}

webRouter.get("/reset", openLimiter, async (req, res) => {
  const token = tokenFrom(req.query.t);
  if (!token || !(await findToken(token, ["reset_password"]))) return expired(res, "reset");
  resetForm(res, token);
});

webRouter.post("/reset", submitLimiter, formBody, async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const token = tokenFrom(body.t);
  const link = token ? await findToken(token, ["reset_password"]) : null;
  if (!token || !link) return expired(res, "reset");

  const password = typeof body.password === "string" ? body.password : "";
  const confirm = typeof body.confirm === "string" ? body.confirm : "";
  const rules = passwordSchema.safeParse(password);
  if (!rules.success) return resetForm(res.status(400), token, rules.error.issues[0].message);
  if (password !== confirm) return resetForm(res.status(400), token, "Those two passwords don't match.");

  if (!(await resetPassword(link, password))) return expired(res, "reset");
  page(res, {
    title: "Password updated",
    body: `<div class="done" aria-hidden="true">✓</div>
<h1>Password updated</h1>
<p>Open Glofly and log in with your new password.</p>
<p class="muted">For safety, every device that was signed in has been signed out.</p>`,
  });
});

// ───────────── Confirm an email address ─────────────

webRouter.get("/confirm", openLimiter, async (req, res) => {
  const token = tokenFrom(req.query.t);
  const link = token ? await findToken(token, ["verify_email", "change_email"]) : null;
  if (!token || !link) return expired(res, "confirm");
  const isChange = link.kind === "change_email";
  page(res, {
    title: isChange ? "Confirm your new email" : "Confirm your email",
    body: `<h1>${isChange ? "Confirm your new email" : "Confirm your email"}</h1>
<p>${isChange ? "Use this address for Glofly from now on:" : "Is this your email address?"}</p>
<p class="address">${esc(link.email)}</p>
<form method="post" action="/confirm">
  <input type="hidden" name="t" value="${esc(token)}">
  <button type="submit">${isChange ? "Yes, use this email" : "Yes, confirm my email"}</button>
</form>`,
  });
});

webRouter.post("/confirm", submitLimiter, formBody, async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const token = tokenFrom(body.t);
  const link = token ? await findToken(token, ["verify_email", "change_email"]) : null;
  if (!token || !link) return expired(res, "confirm");

  const result = await confirmEmail(link);
  if (!result.ok) {
    if (result.reason === "taken") {
      return page(res.status(409), {
        title: "Email already in use",
        body: `<h1>That email is already in use</h1>
<p>Another Glofly account uses this address now, so it can't be added to yours. Your email hasn't changed.</p>`,
      });
    }
    return expired(res, "confirm");
  }
  page(res, {
    title: result.kind === "changed" ? "Email changed" : "Email confirmed",
    body: `<div class="done" aria-hidden="true">✓</div>
<h1>${result.kind === "changed" ? "Your email is changed" : "Email confirmed"}</h1>
<p>${
      result.kind === "changed"
        ? `Glofly will use <span class="address">${esc(result.email)}</span> from now on, for logging in and password resets.`
        : `Thanks! <span class="address">${esc(result.email)}</span> is confirmed.`
    }</p>
<p class="muted">You can close this page and go back to Glofly.</p>`,
  });
});

// ───────────── Finish setting up an account made in Glofly Control ─────────────

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => [...part][0]?.toUpperCase() ?? "")
    .join("") || "?";

const inviteExpired = (res: Response): void =>
  page(res.status(410), {
    title: "This invite has expired",
    body: `<h1>This invite doesn't work any more</h1>
<p>It may have expired (invites work for 7 days), or the account is already set up.</p>
<p class="muted">Already finished? Just log in to Glofly. Otherwise, ask whoever invited you to send a new invite.</p>`,
  });

type WelcomeValues = { month?: string; day?: string; year?: string; terms?: boolean };

async function welcomeForm(
  res: Response,
  token: string,
  invite: Invite,
  error?: string,
  values: WelcomeValues = {},
): Promise<void> {
  const inviter = await inviterName(invite.invitedBy);
  const thisYear = new Date().getUTCFullYear();
  const option = (value: string, label: string, selected?: string) =>
    `<option value="${esc(value)}"${selected === value ? " selected" : ""}>${esc(label)}</option>`;
  const months = MONTHS.map((m, i) => option(String(i + 1), m, values.month)).join("");
  const days = Array.from({ length: 31 }, (_, i) => option(String(i + 1), String(i + 1), values.day)).join("");
  const years = Array.from({ length: thisYear - 1900 + 1 }, (_, i) => String(thisYear - i))
    .map((y) => option(y, y, values.year))
    .join("");
  page(res, {
    title: "Finish setting up your account",
    body: `<h1>You're invited to Glofly</h1>
<p class="muted">${esc(inviter)} set up an account for you. Finish setting it up to start chatting.</p>
<div class="person">
  <span class="initials" aria-hidden="true">${esc(initialsOf(invite.displayName))}</span>
  <span class="person-text"><strong>${esc(invite.displayName)} <span>@${esc(invite.username)}</span></strong><span>${esc(invite.email)}</span></span>
</div>
<form method="post" action="/welcome">
  <input type="hidden" name="t" value="${esc(token)}">
  <label for="password">Choose a password</label>
  <input id="password" name="password" type="password" autocomplete="new-password" maxlength="${PASSWORD_MAX}" aria-describedby="password-hint" required autofocus>
  <p class="hint" id="password-hint">At least 8 characters, with a letter and a number.</p>
  <label for="confirm">Type it again</label>
  <input id="confirm" name="confirm" type="password" autocomplete="new-password" maxlength="${PASSWORD_MAX}" required>
  <fieldset>
    <legend>Your birthday</legend>
    <div class="dob">
      <select name="month" aria-label="Month" required><option value="">Month</option>${months}</select>
      <select name="day" aria-label="Day" required><option value="">Day</option>${days}</select>
      <select name="year" aria-label="Year" required><option value="">Year</option>${years}</select>
    </div>
    <p class="hint">Only used to check you're 13 or older. Never shown to anyone.</p>
  </fieldset>
  <label class="check"><input type="checkbox" name="terms" value="yes"${values.terms ? " checked" : ""} required>
    <span>I agree to the <a href="/terms" target="_blank" rel="noopener">Terms of Service</a> and <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a></span></label>
  ${error ? `<p class="error" role="alert">${esc(error)}</p>` : ""}
  <button type="submit">Finish setting up</button>
</form>
<p class="muted" style="margin:16px 0 0">Weren't expecting this? Just ignore it: the account stays unused and goes away after 7 days.</p>`,
  });
}

webRouter.get("/welcome", openLimiter, async (req, res) => {
  const token = tokenFrom(req.query.t);
  const invite = token ? await findInvite(token) : null;
  if (!token || !invite) return inviteExpired(res);
  await welcomeForm(res, token, invite);
});

webRouter.post("/welcome", submitLimiter, formBody, async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const token = tokenFrom(body.t);
  const invite = token ? await findInvite(token) : null;
  if (!token || !invite) return inviteExpired(res);

  const text = (key: string): string => (typeof body[key] === "string" ? (body[key] as string) : "");
  const password = text("password");
  const values: WelcomeValues = {
    month: text("month"),
    day: text("day"),
    year: text("year"),
    terms: text("terms") === "yes",
  };
  const again = (error: string) => welcomeForm(res.status(400), token, invite, error, values);


  const rules = passwordSchema.safeParse(password);
  if (!rules.success) return again(rules.error.issues[0].message);
  if (password !== text("confirm")) return again("Those two passwords don't match.");
  const [m, d, y] = [values.month, values.day, values.year].map((v) => Number(v));
  if (!m || !d || !y) return again("Enter your birthday.");
  const birthday = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const age = birthdaySchema.safeParse(birthday);
  if (!age.success) return again(age.error.issues[0].message);
  if (!values.terms) return again("Please agree to the Terms of Service and Privacy Policy.");

  const result = await acceptInvite(invite, { password, birthday: age.data });
  if (!result.ok) {
    if (result.reason === "taken") {
      return page(res.status(409), {
        title: "Couldn't finish",
        body: `<h1>That username or email is already in use</h1>
<p>Another Glofly account took it in the meantime. Ask whoever invited you to send a new invite.</p>`,
      });
    }
    return inviteExpired(res);
  }
  page(res, {
    title: "You're all set",
    body: `<div class="done" aria-hidden="true">✓</div>
<h1>You're all set</h1>
<p>Your Glofly account is ready. Download Glofly and log in as <span class="address">@${esc(result.username)}</span> with the password you just chose.</p>
<a class="download" href="/download">Download Glofly for Windows</a>
<p class="muted" style="margin:14px 0 0">Already have Glofly? Just open it and log in.</p>`,
  });
});

// ───────────── Join from a friend's invite (0.3.0) ─────────────

const joinExpired = (res: Response): void =>
  page(res.status(410), {
    title: "This invite has expired",
    body: `<h1>This invite doesn't work any more</h1>
<p>It may have expired (invites work for ${FRIEND_INVITE_DAYS} days), or an account was already made with it.</p>
<p class="muted">Already made your account? Just log in to Glofly. Otherwise, ask your friend to invite you again.</p>`,
  });

const signupsClosed = (res: Response): void =>
  page(res.status(403), {
    title: "Sign-ups are closed",
    body: `<h1>Glofly isn't taking new sign-ups right now</h1>
<p>Sorry! Your invite will keep working until it expires, so try again a little later.</p>`,
  });

type JoinValues = WelcomeValues & { displayName?: string; username?: string };
type InviteWithInviter = FriendInvite & { inviterName: string; inviterUsername: string };

function joinForm(res: Response, token: string, invite: InviteWithInviter, error?: string, values: JoinValues = {}): void {
  const thisYear = new Date().getUTCFullYear();
  const option = (value: string, label: string, selected?: string) =>
    `<option value="${esc(value)}"${selected === value ? " selected" : ""}>${esc(label)}</option>`;
  const months = MONTHS.map((m, i) => option(String(i + 1), m, values.month)).join("");
  const days = Array.from({ length: 31 }, (_, i) => option(String(i + 1), String(i + 1), values.day)).join("");
  const years = Array.from({ length: thisYear - 1900 + 1 }, (_, i) => String(thisYear - i))
    .map((y) => option(y, y, values.year))
    .join("");
  page(res, {
    title: `${invite.inviterName} invited you to Glofly`,
    body: `<h1>Join Glofly</h1>
<div class="person">
  <span class="initials" aria-hidden="true">${esc(initialsOf(invite.inviterName))}</span>
  <span class="person-text"><strong>${esc(invite.inviterName)} <span>@${esc(invite.inviterUsername)}</span></strong><span>invited you. You'll be friends as soon as you join.</span></span>
</div>
<ul class="perks"><li>Chats, group chats, voice and video calls</li><li>Free, with no ads and no feeds</li></ul>
<form method="post" action="/join">
  <input type="hidden" name="t" value="${esc(token)}">
  <p class="muted" style="margin:14px 0 0">Your email: <span class="address">${esc(invite.email)}</span></p>
  <label for="displayName">Display name</label>
  <input id="displayName" name="displayName" type="text" autocomplete="name" maxlength="${DISPLAY_NAME_MAX}" value="${esc(values.displayName ?? "")}" aria-describedby="name-hint" required autofocus>
  <p class="hint" id="name-hint">What friends see. You can change it any time.</p>
  <label for="username">Username</label>
  <input id="username" name="username" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="${USERNAME_MAX}" value="${esc(values.username ?? "")}" aria-describedby="username-hint" required>
  <p class="hint" id="username-hint">How people find you, like @${esc(invite.inviterUsername)}. Letters, numbers, dots and underscores.</p>
  <label for="password">Choose a password</label>
  <input id="password" name="password" type="password" autocomplete="new-password" maxlength="${PASSWORD_MAX}" aria-describedby="password-hint" required>
  <p class="hint" id="password-hint">At least 8 characters, with a letter and a number.</p>
  <label for="confirm">Type it again</label>
  <input id="confirm" name="confirm" type="password" autocomplete="new-password" maxlength="${PASSWORD_MAX}" required>
  <fieldset>
    <legend>Your birthday</legend>
    <div class="dob">
      <select name="month" aria-label="Month" required><option value="">Month</option>${months}</select>
      <select name="day" aria-label="Day" required><option value="">Day</option>${days}</select>
      <select name="year" aria-label="Year" required><option value="">Year</option>${years}</select>
    </div>
    <p class="hint">Only used to check you're 13 or older. Never shown to anyone.</p>
  </fieldset>
  <label class="check"><input type="checkbox" name="terms" value="yes"${values.terms ? " checked" : ""} required>
    <span>I agree to the <a href="/terms" target="_blank" rel="noopener">Terms of Service</a> and <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a></span></label>
  ${error ? `<p class="error" role="alert">${esc(error)}</p>` : ""}
  <button type="submit">Join Glofly</button>
</form>
<p class="muted" style="margin:16px 0 0">Already have Glofly? Log in and add @${esc(invite.inviterUsername)} as a friend instead.</p>`,
  });
}

webRouter.get("/join", openLimiter, async (req, res) => {
  const token = tokenFrom(req.query.t);
  const invite = token ? await findFriendInvite(token) : null;
  if (!token || !invite) return joinExpired(res);
  if ((await getSignupMode()) === "closed") return signupsClosed(res);
  joinForm(res, token, invite);
});

webRouter.post("/join", submitLimiter, formBody, async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const token = tokenFrom(body.t);
  const invite = token ? await findFriendInvite(token) : null;
  if (!token || !invite) return joinExpired(res);
  if ((await getSignupMode()) === "closed") return signupsClosed(res);

  const text = (key: string): string => (typeof body[key] === "string" ? (body[key] as string) : "");
  const values: JoinValues = {
    displayName: text("displayName"),
    username: text("username"),
    month: text("month"),
    day: text("day"),
    year: text("year"),
    terms: text("terms") === "yes",
  };
  const again = (error: string) => joinForm(res.status(400), token, invite, error, values);

  const name = displayNameSchema.safeParse(values.displayName);
  if (!name.success) return again(name.error.issues[0].message);
  const username = usernameSchema.safeParse(values.username);
  if (!username.success) return again(username.error.issues[0].message);
  const password = text("password");
  const rules = passwordSchema.safeParse(password);
  if (!rules.success) return again(rules.error.issues[0].message);
  if (password !== text("confirm")) return again("Those two passwords don't match.");
  const [m, d, y] = [values.month, values.day, values.year].map((v) => Number(v));
  if (!m || !d || !y) return again("Enter your birthday.");
  const birthday = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const age = birthdaySchema.safeParse(birthday);
  if (!age.success) return again(age.error.issues[0].message);
  if (!values.terms) return again("Please agree to the Terms of Service and Privacy Policy.");

  const result = await acceptFriendInvite(invite, {
    displayName: name.data,
    username: username.data,
    password,
    birthday: age.data,
  });
  if (!result.ok) {
    if (result.reason === "taken") {
      if (result.fields.email) {
        return page(res.status(409), {
          title: "You already have an account",
          body: `<h1>This email already has a Glofly account</h1>
<p>Just log in to Glofly and add <span class="address">@${esc(invite.inviterUsername)}</span> as a friend.</p>`,
        });
      }
      return again(result.fields.username ?? "That username is taken.");
    }
    return joinExpired(res);
  }
  page(res, {
    title: "Welcome to Glofly",
    body: `<div class="done" aria-hidden="true">✓</div>
<h1>Welcome to Glofly!</h1>
<p>Your account is ready, and you and ${esc(invite.inviterName)} are friends. Download Glofly and log in as <span class="address">@${esc(result.username)}</span> with the password you just chose.</p>
<div class="downloads">
  <a class="download" href="/download">Download for Windows</a>
  <a class="download alt" href="/download/mac">Download for Mac</a>
</div>
<p class="muted" style="margin:14px 0 0">iPhone and Android apps are coming soon. Already have Glofly? Just open it and log in. New to Mac installs? <a href="/mac">Here's how</a>.</p>`,
  });
});
