import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

// Sends Glofly's emails (Forgot password, confirm your email, …).
//
// Live server (EMAIL_TRANSPORT=ses): Amazon SES in AWS_REGION, sending as
// "Glofly <noreply@glofly.app>". The machine's AWS role gives permission, so no keys here.
// While developing: nothing is sent; each email is printed in the server's terminal,
// links included, so you can click through the whole flow on your own PC.

export type Email = { to: string; subject: string; html: string; text: string };

const useSes = process.env.EMAIL_TRANSPORT === "ses";
const FROM = process.env.EMAIL_FROM || "Glofly <noreply@glofly.app>";

let ses: SESv2Client | null = null;
const client = (): SESv2Client =>
  (ses ??= new SESv2Client({ region: process.env.AWS_REGION || "us-east-2" }));

export const emailKind = useSes ? "Amazon SES" : "printed in this terminal";

export async function sendEmail(email: Email): Promise<void> {
  if (!useSes) {
    console.log(
      [
        "",
        "──── Email (not sent: EMAIL_TRANSPORT isn't ses) ────",
        `To: ${email.to}`,
        `Subject: ${email.subject}`,
        "",
        email.text,
        "─────────────────────────────────────────────────────",
        "",
      ].join("\n"),
    );
    return;
  }
  await client().send(
    new SendEmailCommand({
      FromEmailAddress: FROM,
      Destination: { ToAddresses: [email.to] },
      Content: {
        Simple: {
          Subject: { Data: email.subject, Charset: "UTF-8" },
          Body: {
            Html: { Data: email.html, Charset: "UTF-8" },
            Text: { Data: email.text, Charset: "UTF-8" },
          },
        },
      },
    }),
  );
}

/**
 * Sends without making anyone wait. A failure is logged (never the link itself) and
 * otherwise ignored: the person can always ask for another email.
 */
export function sendInBackground(email: Email): void {
  sendEmail(email).catch((err: unknown) => {
    const e = err as { name?: string; message?: string };
    console.error(`Email "${email.subject}" couldn't be sent: ${e?.name ?? "Error"} ${e?.message ?? ""}`);
  });
}
