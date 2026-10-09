import express, { Router, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { passwordSchema, PASSWORD_MAX } from "../auth/validation";
import { confirmEmail, resetPassword } from "../account/email";
import { findToken, looksLikeToken } from "../email/tokens";

// The two pages people open from Glofly's emails:
//   /reset?t=…    choose a new password (Forgot password)
//   /confirm?t=…  confirm an email address (after sign-up, or a new address)
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
  :root { color-scheme: light; --page:#f7f0e9; --card:#fff; --line:#eaddd1; --ink:#24170f; --muted:#6b5547; --red:#e0193a; --red-deep:#c0122f; --red-tint:#fce8eb; --ok:#1f8a4c; --ok-tint:#e6f5ec; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; padding:32px 16px; background:var(--page); color:var(--ink); font:400 16px/1.6 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, Helvetica, Arial, sans-serif; }
  main { width:100%; max-width:440px; }
  .brand { display:flex; align-items:center; gap:10px; margin:0 0 18px 4px; font-weight:700; font-size:22px; color:var(--ink); text-decoration:none; }
  .brand img { width:36px; height:36px; border-radius:10px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:18px; padding:30px 28px 26px; box-shadow:0 18px 40px -28px rgba(36,23,15,.35); }
  h1 { margin:0 0 12px; font-size:24px; line-height:1.25; }
  p { margin:0 0 14px; }
  .muted { color:var(--muted); font-size:14px; }
  label { display:block; margin:16px 0 6px; font-weight:600; font-size:14px; }
  input[type=password] { width:100%; padding:12px 14px; border:1.5px solid var(--line); border-radius:12px; font:inherit; color:var(--ink); background:#fff; }
  input[type=password]:focus { outline:none; border-color:var(--red); box-shadow:0 0 0 3px rgba(224,25,58,.18); }
  button { margin-top:22px; width:100%; padding:14px 18px; border:0; border-radius:12px; background:var(--red); color:#fff; font-family:inherit; font-size:16px; font-weight:600; line-height:1; cursor:pointer; }
  button:hover { background:var(--red-deep); }
  button:focus-visible { outline:3px solid rgba(224,25,58,.45); outline-offset:3px; }
  .error { margin:16px 0 0; padding:10px 12px; border-radius:10px; background:var(--red-tint); color:var(--red-deep); font-size:14px; }
  .done { display:inline-grid; place-items:center; width:44px; height:44px; margin-bottom:12px; border-radius:50%; background:var(--ok-tint); color:var(--ok); font-size:24px; font-weight:700; }
  .address { font-weight:600; word-break:break-all; }
</style>
</head>
<body>
<main>
  <a class="brand" href="https://glofly.app"><img src="/icon.png" alt="">Glofly</a>
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
