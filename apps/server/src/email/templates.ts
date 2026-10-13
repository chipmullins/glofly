import type { Email } from "./send";

// Glofly's emails: one shared layout (HTML that works in Gmail, Outlook and phone mail
// apps, plus a plain-text copy) and the words for each email.

/** Where the links in emails point: the website, which hands /reset and /confirm to the server. */
export const SITE_URL = (process.env.SITE_URL || `http://localhost:${process.env.PORT || 4000}`).replace(
  /\/+$/,
  "",
);

const ICON_URL = "https://glofly.app/icon.png";

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** "maya.patel@gmail.com" → "m•••@gmail.com": enough to recognise, not enough to harvest. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "•••";
  return `${email[0]}•••${email.slice(at)}`;
}

type Layout = {
  to: string;
  subject: string;
  /** Big line at the top. */
  heading: string;
  /** Paragraphs (plain text; escaped for HTML). */
  paragraphs: string[];
  button?: { label: string; url: string };
  /** Small grey lines under the button. */
  footnotes: string[];
};

const FONT = "'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, Helvetica, Arial, sans-serif";

function render({ to, subject, heading, paragraphs, button, footnotes }: Layout): Email {
  const p = (text: string): string =>
    `<p style="margin:0 0 16px;font:400 16px/1.6 ${FONT};color:#24170f;">${escapeHtml(text)}</p>`;
  const small = (text: string): string =>
    `<p style="margin:0 0 10px;font:400 13px/1.55 ${FONT};color:#6b5547;">${escapeHtml(text)}</p>`;

  const buttonHtml = button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
        <tr><td bgcolor="#e0193a" style="border-radius:12px;background:#e0193a;">
          <a href="${escapeHtml(button.url)}" target="_blank"
             style="display:inline-block;padding:14px 26px;font:600 16px/1 ${FONT};color:#ffffff;text-decoration:none;border-radius:12px;">${escapeHtml(button.label)}</a>
        </td></tr>
      </table>
      ${small("Button not working? Copy this link into your browser:")}
      <p style="margin:0 0 20px;font:400 13px/1.5 ${FONT};word-break:break-all;"><a href="${escapeHtml(button.url)}" style="color:#c0122f;">${escapeHtml(button.url)}</a></p>`
    : "";

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f7f0e9;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f7f0e9;">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
      <tr><td style="padding:0 4px 18px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="vertical-align:middle;"><img src="${ICON_URL}" width="36" height="36" alt="" style="display:block;border:0;border-radius:10px;"></td>
          <td style="vertical-align:middle;padding-left:10px;font:700 22px/1 ${FONT};color:#24170f;">Glofly</td>
        </tr></table>
      </td></tr>
      <tr><td style="background:#ffffff;border:1px solid #eaddd1;border-radius:18px;padding:32px 30px 22px;">
        <h1 style="margin:0 0 18px;font:700 24px/1.25 ${FONT};color:#24170f;">${escapeHtml(heading)}</h1>
        ${paragraphs.map(p).join("\n        ")}
        ${buttonHtml}
        ${footnotes.map(small).join("\n        ")}
      </td></tr>
      <tr><td style="padding:18px 4px 0;font:400 12px/1.5 ${FONT};color:#6b5547;">
        Say it. Send it. Glofly. · You're getting this because of your Glofly account. Questions? Reply to this email.<br>
        <a href="https://glofly.app" style="color:#6b5547;">glofly.app</a> · <a href="https://glofly.app/privacy" style="color:#6b5547;">Privacy</a> · <a href="https://glofly.app/terms" style="color:#6b5547;">Terms</a>
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
    ...(button ? [`${button.label}: ${button.url}`, ""] : []),
    ...footnotes,
    "",
    "Questions? Reply to this email or write to support@glofly.app.",
    "— Glofly · https://glofly.app",
  ].join("\n");

  return { to, subject, html, text };
}

type Person = { email: string; displayName: string; username: string };

export const resetPasswordEmail = (user: Person, url: string): Email =>
  render({
    to: user.email,
    subject: "Reset your Glofly password",
    heading: "Choose a new password",
    paragraphs: [
      `Hi ${user.displayName},`,
      `Someone (hopefully you) asked to reset the password for @${user.username}. Use the button below to choose a new one.`,
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
    subject: "Confirm your email for Glofly",
    heading: "Confirm your email",
    paragraphs: [
      `Hi ${user.displayName}, welcome to Glofly!`,
      `Confirm that this is your email address so you can always get back into @${user.username}, even if you forget your password.`,
    ],
    button: { label: "Confirm my email", url },
    footnotes: ["This link works for 7 days.", "Didn't make a Glofly account? You can ignore this email."],
  });

export const changeEmailConfirm = (user: Person, newEmail: string, url: string): Email =>
  render({
    to: newEmail,
    subject: "Confirm your new email for Glofly",
    heading: "Confirm your new email",
    paragraphs: [
      `Hi ${user.displayName},`,
      `You asked to use this address for @${user.username} on Glofly. Confirm it and it'll replace your old email for logging in and password resets.`,
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
    heading: "Email change requested",
    paragraphs: [
      `Hi ${user.displayName},`,
      `Someone asked to change the email for @${user.username} to ${maskEmail(newEmail)}. It only changes once the link sent to that address is used.`,
    ],
    footnotes: [
      "This was you? Nothing else to do.",
      "Not you? Open Glofly, go to Settings → Account, cancel the change and update your password.",
    ],
  });

export const emailChangedNotice = (user: Person, oldEmail: string, newEmail: string): Email =>
  render({
    to: oldEmail,
    subject: "Your Glofly email was changed",
    heading: "Your email was changed",
    paragraphs: [
      `Hi ${user.displayName},`,
      `The email for @${user.username} is now ${maskEmail(newEmail)}. Glofly won't send anything to this address any more.`,
    ],
    footnotes: [
      "Didn't do this? Email support@glofly.app right away (or reply to this email) so we can help you get your account back.",
    ],
  });

export const passwordChangedNotice = (user: Person): Email =>
  render({
    to: user.email,
    subject: "Your Glofly password was changed",
    heading: "Your password was changed",
    paragraphs: [`Hi ${user.displayName},`, `The password for @${user.username} was just changed.`],
    footnotes: [
      "This was you? Nothing else to do.",
      "Not you? Use Forgot password? on Glofly's login screen to choose a new one right away.",
    ],
  });

export const inviteEmail = (
  invite: { email: string; displayName: string; username: string },
  inviterName: string,
  url: string,
): Email =>
  render({
    to: invite.email,
    subject: `${inviterName} invited you to Glofly`,
    heading: "You're invited to Glofly",
    paragraphs: [
      `Hi ${invite.displayName},`,
      `${inviterName} set up a Glofly account for you: @${invite.username}. Glofly is an instant messenger for chatting, group chats and calls with friends.`,
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
    heading: `${inviter.displayName} invited you to Glofly`,
    paragraphs: [
      "Hi there,",
      `${inviter.displayName} (@${inviter.username}) wants to chat with you on Glofly, an instant messenger for chats, group chats and calls with friends.`,
      `Make your account from this link and you and ${inviter.displayName} will be friends straight away. It only takes a minute.`,
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
    heading: `${inviter.displayName} wants to be friends`,
    paragraphs: [
      `Hi ${user.displayName},`,
      `${inviter.displayName} invited you to Glofly. You already have an account, so to be friends, open Glofly, choose Add friend and search for @${inviter.username}.`,
    ],
    footnotes: ["Don't know them? Just ignore this email. They haven't been told you have an account."],
  });
