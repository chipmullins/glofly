import type { Email } from "./send";

// Glofly's emails: one shared layout and the words for each email.
//
// Nov 6, 2026: no external stylesheet (Google Fonts) and a short preview-text spacer: both are
// things spam filters weigh against a new sender. Fonts fall back to each mail app's own.
// Nov 5, 2026 polish: the website's twilight look (night-sky header with fireflies, glow-orange
// button, Outfit headings / DM Sans text with safe fallbacks), a hidden preview line for inboxes,
// codes in a big box that's easy to read and copy, details (device, time, dates) as a small table,
// a dark-mode version for mail apps that support it (Apple Mail, iOS Mail, Outlook for Mac), and a
// plain-text copy of everything. Tables and inline styles only, so Gmail, Outlook and phone mail
// apps all draw it the same.

/** Where the links in emails point: the website, which hands /reset and /confirm to the server. */
export const SITE_URL = (
  process.env.SITE_URL || `http://localhost:${process.env.PORT || 4000}`
).replace(/\/+$/, "");

const ICON_URL = "https://glofly.app/icon.png";

const escapeHtml = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

/** "maya.patel@gmail.com" → "m•••@gmail.com": enough to recognise, not enough to harvest. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "•••";
  return `${email[0]}•••${email.slice(at)}`;
}

/** "Thursday, November 5, 2026 at 11:42 PM UTC": we don't know the reader's time zone, so say which. */
export function emailTime(when: Date): string {
  const date = when.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  const time = when.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
  return `${date} at ${time} UTC`;
}

/** "December 5, 2026" */
const emailDate = (when: Date): string =>
  when.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

type Layout = {
  to: string;
  subject: string;
  /** The grey line inboxes show after the subject (hidden in the email itself). */
  preview: string;
  /** Big line at the top. */
  heading: string;
  /** Paragraphs (plain text; escaped for HTML). */
  paragraphs: string[];
  /** A one-time code, shown big and spaced out. */
  code?: string;
  /** Label / value rows (device, time, dates). */
  details?: [string, string][];
  button?: { label: string; url: string };
  /** A tinted box for "Not you?" advice. */
  callout?: string;
  /** Small grey lines at the bottom of the card. */
  footnotes: string[];
};

const TEXT =
  "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const DISPLAY =
  "'Outfit', 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";

// Colors from glofly.app (site.css).
const C = {
  page: "#f7f0e9",
  card: "#ffffff",
  line: "#eaddd1",
  ink: "#24170f",
  muted: "#6b5547",
  link: "#b8430a",
  accent: "#f47a1f",
  onAccent: "#2a1406",
  tint: "#fde9d7",
  night: "#1b1036",
  nightTop: "#33215f",
  sky: "#fbf5ff",
  skyMuted: "#cbbde6",
  glow: "#ffb347",
};

// Little glowing dots across the header, like the website's fireflies. Plain spans: no images to
// block, nothing that moves.
function fireflies(): string {
  const dot = (
    left: number,
    top: number,
    size: number,
    alpha: number,
  ): string =>
    `<span style="position:absolute;left:${left}%;top:${top}px;width:${size}px;height:${size}px;border-radius:50%;background:${C.glow};opacity:${alpha};box-shadow:0 0 ${size * 3}px ${C.glow};"></span>`;
  return [
    dot(62, 22, 4, 0.9),
    dot(78, 48, 3, 0.7),
    dot(88, 18, 5, 0.85),
    dot(71, 70, 3, 0.55),
    dot(94, 62, 2, 0.6),
  ].join("");
}

function render({
  to,
  subject,
  preview,
  heading,
  paragraphs,
  code,
  details,
  button,
  callout,
  footnotes,
}: Layout): Email {
  const p = (text: string): string =>
    `<p class="g-ink" style="margin:0 0 16px;font:400 16px/1.6 ${TEXT};color:${C.ink};">${escapeHtml(text)}</p>`;
  const small = (text: string): string =>
    `<p class="g-muted" style="margin:0 0 8px;font:400 13px/1.55 ${TEXT};color:${C.muted};">${escapeHtml(text)}</p>`;

  const codeHtml = code
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 22px;">
          <tr><td class="g-code" bgcolor="${C.page}" style="background:${C.page};border:1px solid ${C.line};border-radius:14px;padding:16px 26px;">
            <span class="g-ink" style="font:700 32px/1 ${MONO};letter-spacing:10px;color:${C.ink};">${escapeHtml(code)}</span>
          </td></tr>
        </table>`
    : "";

  const detailsHtml = details?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="g-box" style="margin:4px 0 22px;border:1px solid ${C.line};border-radius:14px;">
          ${details
            .map(
              ([label, value], i) => `<tr>
            <td class="g-muted" style="padding:12px 16px;${i ? `border-top:1px solid ${C.line};` : ""}font:500 13px/1.4 ${TEXT};color:${C.muted};width:34%;vertical-align:top;">${escapeHtml(label)}</td>
            <td class="g-ink" style="padding:12px 16px;${i ? `border-top:1px solid ${C.line};` : ""}font:500 14px/1.4 ${TEXT};color:${C.ink};vertical-align:top;">${escapeHtml(value)}</td>
          </tr>`,
            )
            .join("")}
        </table>`
    : "";

  const buttonHtml = button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 22px;">
          <tr><td bgcolor="${C.accent}" style="border-radius:999px;background:${C.accent};box-shadow:0 6px 18px rgba(244,122,31,0.35);">
            <a href="${escapeHtml(button.url)}" target="_blank"
               style="display:inline-block;padding:15px 30px;font:700 16px/1 ${TEXT};color:${C.onAccent};text-decoration:none;border-radius:999px;">${escapeHtml(button.label)}</a>
          </td></tr>
        </table>
        ${small("Button not working? Copy this link into your browser:")}
        <p style="margin:0 0 20px;font:400 13px/1.5 ${TEXT};word-break:break-all;"><a href="${escapeHtml(button.url)}" class="g-link" style="color:${C.link};">${escapeHtml(button.url)}</a></p>`
    : "";

  const calloutHtml = callout
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:2px 0 18px;">
          <tr><td class="g-tint" bgcolor="${C.tint}" style="background:${C.tint};border-radius:12px;padding:13px 16px;font:400 14px/1.55 ${TEXT};color:${C.ink};">${escapeHtml(callout)}</td></tr>
        </table>`
    : "";

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(subject)}</title>
<style>
  @media (prefers-color-scheme: dark) {
    .g-page { background:#120c0a !important; }
    .g-card { background:#2a231f !important; border-color:#3a302a !important; }
    .g-ink { color:#f5ede6 !important; }
    .g-muted { color:#b8a699 !important; }
    .g-link { color:#ffb36b !important; }
    .g-code, .g-box { background:#1e1916 !important; border-color:#3a302a !important; }
    .g-box td { border-color:#3a302a !important; }
    .g-tint { background:#3a2615 !important; color:#f5ede6 !important; }
  }
  @media (max-width: 480px) {
    .g-pad { padding-left:22px !important; padding-right:22px !important; }
  }
</style>
</head>
<body class="g-page" style="margin:0;padding:0;background:${C.page};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${C.page};opacity:0;">${escapeHtml(preview)}${"&#847;&zwnj;&nbsp;".repeat(12)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="g-page" style="background:${C.page};">
  <tr><td align="center" style="padding:28px 12px 36px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:540px;">
      <tr><td bgcolor="${C.night}" style="position:relative;overflow:hidden;background:${C.night};background-image:linear-gradient(160deg,${C.nightTop} 0%,${C.night} 70%);border-radius:20px 20px 0 0;padding:26px 30px 24px;" class="g-pad">
        ${fireflies()}
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="position:relative;"><tr>
          <td style="vertical-align:middle;"><img src="${ICON_URL}" width="40" height="40" alt="" style="display:block;border:0;border-radius:11px;"></td>
          <td style="vertical-align:middle;padding-left:12px;">
            <div style="font:700 22px/1.1 ${DISPLAY};color:${C.sky};letter-spacing:-0.2px;">Glofly</div>
            <div style="font:400 12px/1.4 ${TEXT};color:${C.skyMuted};padding-top:2px;">A brighter kind of together.</div>
          </td>
        </tr></table>
      </td></tr>
      <tr><td class="g-card g-pad" bgcolor="${C.card}" style="background:${C.card};border:1px solid ${C.line};border-top:0;border-radius:0 0 20px 20px;padding:30px 32px 22px;">
        <h1 class="g-ink" style="margin:0 0 18px;font:700 26px/1.25 ${DISPLAY};color:${C.ink};letter-spacing:-0.3px;">${escapeHtml(heading)}</h1>
        ${paragraphs.map(p).join("\n        ")}
        ${codeHtml}
        ${detailsHtml}
        ${buttonHtml}
        ${calloutHtml}
        ${footnotes.map(small).join("\n        ")}
      </td></tr>
      <tr><td class="g-muted" align="center" style="padding:20px 8px 0;font:400 12px/1.6 ${TEXT};color:${C.muted};">
        You're getting this because of your Glofly account. Questions? Just reply.<br>
        <a href="https://glofly.app" class="g-link" style="color:${C.muted};">glofly.app</a> &nbsp;·&nbsp; <a href="https://glofly.app/privacy" class="g-link" style="color:${C.muted};">Privacy</a> &nbsp;·&nbsp; <a href="https://glofly.app/terms" class="g-link" style="color:${C.muted};">Terms</a>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  const text = [
    heading,
    "",
    ...paragraphs.flatMap((t) => [t, ""]),
    ...(code ? [`    ${code}`, ""] : []),
    ...(details?.length ? [...details.map(([k, v]) => `${k}: ${v}`), ""] : []),
    ...(button ? [`${button.label}: ${button.url}`, ""] : []),
    ...(callout ? [callout, ""] : []),
    ...footnotes,
    "",
    "Questions? Reply to this email or write to support@glofly.app.",
    "— Glofly · A brighter kind of together. · https://glofly.app",
  ].join("\n");

  return { to, subject, html, text };
}

type Person = { email: string; displayName: string; username: string };

/** "Maya" from "Maya Patel": friendlier greetings. */
const first = (name: string): string => name.trim().split(/\s+/)[0] || name;

export const resetPasswordEmail = (user: Person, url: string): Email =>
  render({
    to: user.email,
    subject: "Reset your Glofly password",
    preview:
      "Choose a new password for your Glofly account. This link works for one hour.",
    heading: "Choose a new password",
    paragraphs: [
      `Hi ${first(user.displayName)},`,
      `Someone (hopefully you) asked to reset the password for @${user.username}. Tap the button to choose a new one.`,
    ],
    button: { label: "Choose a new password", url },
    footnotes: [
      "This link works once, for the next hour. Resetting signs you out of Glofly everywhere.",
      "Didn't ask for this? You can ignore this email. Your password won't change.",
    ],
  });

export const verifyEmail = (user: Person, url: string): Email =>
  render({
    to: user.email,
    subject: "Welcome to Glofly! Confirm your email",
    preview: `One tap to confirm your email, so you can always get back into @${user.username}.`,
    heading: `Welcome to Glofly, ${first(user.displayName)}! ✨`,
    paragraphs: [
      `We're so glad you're here. Confirm that this is your email address so you can always get back into @${user.username}, even if you forget your password.`,
    ],
    button: { label: "Confirm my email", url },
    footnotes: [
      "This link works for 7 days.",
      "Didn't make a Glofly account? You can ignore this email.",
    ],
  });

export const changeEmailConfirm = (
  user: Person,
  newEmail: string,
  url: string,
): Email =>
  render({
    to: newEmail,
    subject: "Confirm your new email for Glofly",
    preview: `Confirm this address for @${user.username}. Your old email keeps working until you do.`,
    heading: "Confirm your new email",
    paragraphs: [
      `Hi ${first(user.displayName)},`,
      `You asked to use this address for @${user.username}. Once you confirm, it replaces your old email for logging in and password resets.`,
    ],
    button: { label: "Confirm new email", url },
    footnotes: [
      "This link works for 24 hours. Your old email keeps working until you confirm.",
      "Didn't ask for this? You can ignore this email.",
    ],
  });

export const changeEmailRequested = (user: Person, newEmail: string): Email =>
  render({
    to: user.email,
    subject: "Your Glofly email is being changed",
    preview: `Someone asked to move @${user.username} to a new email address.`,
    heading: "Email change requested",
    paragraphs: [
      `Hi ${first(user.displayName)},`,
      `Someone asked to change the email for @${user.username}. Nothing changes until the link sent to the new address is used.`,
    ],
    details: [["New email", maskEmail(newEmail)]],
    callout:
      "Not you? Open Glofly, go to Settings → Account, cancel the change and choose a new password.",
    footnotes: ["This was you? There's nothing else to do."],
  });

export const emailChangedNotice = (
  user: Person,
  oldEmail: string,
  newEmail: string,
): Email =>
  render({
    to: oldEmail,
    subject: "Your Glofly email was changed",
    preview: `@${user.username} now uses a different email address.`,
    heading: "Your email was changed",
    paragraphs: [
      `Hi ${first(user.displayName)},`,
      `@${user.username} now uses a new email address, so Glofly won't send anything here any more.`,
    ],
    details: [["New email", maskEmail(newEmail)]],
    callout:
      "Didn't do this? Reply to this email (or write to support@glofly.app) right away and we'll help you get your account back.",
    footnotes: [],
  });

export const passwordChangedNotice = (user: Person): Email =>
  render({
    to: user.email,
    subject: "Your Glofly password was changed",
    preview: `The password for @${user.username} was just changed.`,
    heading: "Your password was changed",
    paragraphs: [
      `Hi ${first(user.displayName)},`,
      `The password for @${user.username} was just changed.`,
    ],
    details: [["When", emailTime(new Date())]],
    callout:
      "Not you? Tap Forgot password? on Glofly's login screen to choose a new one right away.",
    footnotes: ["This was you? There's nothing else to do."],
  });

export const inviteEmail = (
  invite: { email: string; displayName: string; username: string },
  inviterName: string,
  url: string,
): Email =>
  render({
    to: invite.email,
    subject: `${inviterName} invited you to Glofly`,
    preview: `${inviterName} set up @${invite.username} for you. Choose a password to start chatting.`,
    heading: "You're invited to Glofly",
    paragraphs: [
      `Hi ${first(invite.displayName)},`,
      `${inviterName} set up a Glofly account for you: @${invite.username}. Glofly is a free messenger for chats, group chats, calls and watching things together with friends.`,
      "Finish setting it up by choosing your own password. It only takes a minute.",
    ],
    button: { label: "Finish setting up", url },
    footnotes: [
      "This link works for 7 days.",
      "Weren't expecting this? You can ignore this email. The account stays unused and goes away after 7 days.",
    ],
  });

/** "Invite your friends" (0.3.0): a Glofly user invited someone by email. */
export const friendInviteEmail = (
  to: string,
  inviter: { displayName: string; username: string },
  url: string,
  days: number,
): Email =>
  render({
    to,
    subject: `${inviter.displayName} invited you to Glofly`,
    preview: `${first(inviter.displayName)} wants to chat with you on Glofly. Join and you'll be friends straight away.`,
    heading: `${first(inviter.displayName)} invited you to Glofly`,
    paragraphs: [
      "Hi there,",
      `${inviter.displayName} (@${inviter.username}) wants to chat with you on Glofly, a free messenger for chats, group chats, calls and watching things together.`,
      `Make your account from this link and you and ${first(inviter.displayName)} will be friends straight away. It only takes a minute.`,
    ],
    button: { label: "Join Glofly", url },
    footnotes: [
      `This link works for ${days} days.`,
      "Don't know them, or not interested? Just ignore this email. We won't email you again unless someone else invites you.",
    ],
  });

/** Someone tried to invite an email that already has a Glofly account (they're never told that). */
export const friendInviteExistingEmail = (
  user: Person,
  inviter: { displayName: string; username: string },
): Email =>
  render({
    to: user.email,
    subject: `${inviter.displayName} wants to be friends on Glofly`,
    preview: `Search for @${inviter.username} in Add friend to connect.`,
    heading: `${first(inviter.displayName)} wants to be friends`,
    paragraphs: [
      `Hi ${first(user.displayName)},`,
      `${inviter.displayName} invited you to Glofly. You already have an account, so to be friends, open Glofly, choose Add friend and search for @${inviter.username}.`,
    ],
    footnotes: [
      "Don't know them? Just ignore this email. They haven't been told you have an account.",
    ],
  });

// ---- 0.7.3 ----

export const twoStepCodeEmail = (
  user: Person,
  code: string,
  purpose: "sign-in" | "setup",
): Email =>
  render({
    to: user.email,
    subject:
      purpose === "sign-in"
        ? `${code} is your Glofly sign-in code`
        : `${code} is your Glofly code`,
    preview:
      purpose === "sign-in"
        ? "Enter this code to finish signing in. It works for 10 minutes."
        : "Enter this code to turn on two-step sign-in. It works for 10 minutes.",
    heading:
      purpose === "sign-in" ? "Your sign-in code" : "Confirm two-step sign-in",
    paragraphs: [
      `Hi ${first(user.displayName)},`,
      purpose === "sign-in"
        ? `Someone (hopefully you) entered the right password for @${user.username}. To finish signing in, enter this code:`
        : `To turn on two-step sign-in for @${user.username}, enter this code in Glofly:`,
    ],
    code,
    callout:
      purpose === "sign-in"
        ? "Not you? Someone knows your password. Change it in Settings → Account right away."
        : undefined,
    footnotes: [
      "The code works for 10 minutes. Glofly will never ask you for it in a message or a call.",
      ...(purpose === "setup"
        ? ["Didn't ask for this? You can ignore this email."]
        : []),
    ],
  });

export const newSignInEmail = (
  user: Person,
  device: string,
  when: Date,
): Email =>
  render({
    to: user.email,
    subject: "New sign-in to your Glofly account",
    preview: `@${user.username} was just signed in on ${device}.`,
    heading: "New sign-in",
    paragraphs: [
      `Hi ${first(user.displayName)},`,
      `@${user.username} was just signed in on a device Glofly hasn't seen before.`,
    ],
    details: [
      ["Device", device],
      ["When", emailTime(when)],
    ],
    callout:
      "Not you? Open Glofly → Settings → Devices, sign that device out, then change your password and turn on two-step sign-in.",
    footnotes: ["This was you? There's nothing else to do."],
  });

// ---- Nov 5, 2026: account deletion ----

export const deletionScheduledEmail = (
  user: Person,
  deleteAfter: Date,
  graceDays: number,
): Email =>
  render({
    to: user.email,
    subject: "Your Glofly account is set to be deleted",
    preview: `You have ${graceDays} days to change your mind. Just log in to keep @${user.username}.`,
    heading: "Your account is set to be deleted",
    paragraphs: [
      `Hi ${first(user.displayName)},`,
      `We got your request to delete @${user.username}. Your account is hidden and you've been signed out everywhere.`,
      `Changed your mind? Log in to Glofly before the date below and choose Restore. Everything comes back exactly as it was.`,
    ],
    details: [
      ["Account", `@${user.username}`],
      ["Deleted for good on", emailDate(deleteAfter)],
    ],
    callout:
      "Didn't ask for this? Log in and restore your account, then change your password right away.",
    footnotes: [
      "After that date your profile, friends, direct messages and files are removed for good, and we can't bring them back.",
    ],
  });

export const deletionCancelledEmail = (user: Person): Email =>
  render({
    to: user.email,
    subject: "Welcome back! Your Glofly account was restored",
    preview: `@${user.username} won't be deleted. Everything is just as you left it.`,
    heading: "Welcome back! ✨",
    paragraphs: [
      `Hi ${first(user.displayName)},`,
      `@${user.username} has been restored and won't be deleted. Your friends, chats and settings are just as you left them.`,
    ],
    callout:
      "Didn't restore it yourself? Change your password in Settings → Account right away.",
    footnotes: [],
  });

export const deletionCompletedEmail = (user: Person): Email =>
  render({
    to: user.email,
    subject: "Your Glofly account has been deleted",
    preview: `@${user.username} and its data have been removed from Glofly.`,
    heading: "Your account has been deleted",
    paragraphs: [
      `Hi ${first(user.displayName)},`,
      `As requested, @${user.username} has been deleted. Your profile, photo, friends, direct messages and the files in them have been removed from Glofly, and the username may be used by someone else later.`,
      "Thanks for spending time on Glofly. If you ever want to come back, you're always welcome to make a new account.",
    ],
    footnotes: [
      "This is the last email we'll send to this address. Messages you sent in group chats were removed too.",
      "Questions? Reply to this email.",
    ],
  });
