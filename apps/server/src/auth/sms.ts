import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";

// Text messages (0.7.3: two-step sign-in codes). Amazon SNS in AWS_REGION, from the number set in
// SMS_ORIGINATION_NUMBER (a toll-free number registered in AWS End User Messaging; US carriers
// refuse texts from unregistered numbers). The machine's AWS role gives permission.
//
// Without SMS_ORIGINATION_NUMBER texts are off: the apps only offer email codes. While
// developing (SMS_TRANSPORT=print) each text is printed in the server's terminal instead.

const ORIGIN = process.env.SMS_ORIGINATION_NUMBER?.trim() || "";
const printOnly = process.env.SMS_TRANSPORT === "print";

export const smsAvailable = printOnly || /^\+\d{8,15}$/.test(ORIGIN);
export const smsKind = printOnly ? "printed in this terminal" : smsAvailable ? `Amazon SNS from ${ORIGIN}` : "off";

let sns: SNSClient | null = null;
const client = (): SNSClient => (sns ??= new SNSClient({ region: process.env.AWS_REGION || "us-east-2" }));

/** Sends a text. Throws if Amazon refuses it. */
export async function sendText(to: string, text: string): Promise<void> {
  if (!smsAvailable) throw new Error("Texts aren't set up on this server (SMS_ORIGINATION_NUMBER).");
  if (printOnly) {
    console.log(`\n──── Text (not sent: SMS_TRANSPORT=print) ────\nTo: ${to}\n${text}\n──────────────────────────────────────────────\n`);
    return;
  }
  await client().send(
    new PublishCommand({
      PhoneNumber: to,
      Message: text,
      MessageAttributes: {
        "AWS.SNS.SMS.SMSType": { DataType: "String", StringValue: "Transactional" },
        "AWS.MM.SMS.OriginationNumber": { DataType: "String", StringValue: ORIGIN },
      },
    }),
  );
}
