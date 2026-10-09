import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { eq, sql } from "drizzle-orm";
import QRCode from "qrcode";
import { db, pool } from "../db";
import { admins, adminSessions, users } from "../db/schema";
import { hashPassword, verifyPassword } from "../auth/passwords";
import { newTotpSecret, otpauthUri, verifyTotp } from "./totp";
import { adminConfigured, encryptSecret, hashBackupCode, newBackupCode } from "./secrets";
import { logAction } from "./audit";

// Makes a Glofly account the admin for Glofly Control, or resets its admin password and
// authenticator. Run it on the server, in a terminal (never through the API):
//
//   On your PC:        npm run admin:setup -w apps/server -- chipm
//   On the live server: docker compose exec -it server node dist/admin/setup.js chipm
//
// It asks for a NEW admin password (not your Glofly password), shows a QR code for your
// authenticator app, checks one code, and prints 8 backup codes once.

const MIN_ADMIN_PASSWORD = 12;
const BACKUP_CODES = 8;

// Typing a password shows nothing (like sudo). The mute is switched on just for those prompts.
let muted = false;
const output = new Writable({
  write(chunk, _encoding, done) {
    if (!muted) process.stdout.write(chunk);
    done();
  },
});
const rl = createInterface({ input: process.stdin, output, terminal: true });

function ask(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    muted = hidden;
    rl.question("", (answer) => {
      if (hidden) process.stdout.write("\n");
      muted = false;
      resolve(answer.trim());
    });
  });
}

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  console.log("\nGlofly Control — admin setup\n");
  if (!adminConfigured()) {
    fail(
      "ADMIN_KEY isn't set (or isn't 64 hex characters). Make one with\n" +
        "    node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"\n" +
        "  put ADMIN_KEY=<that> in the .env file (deploy/.env on the live server), restart, and run this again.",
    );
  }

  const username = (process.argv[2] || (await ask("Glofly username to make admin: "))).replace(/^@/, "");
  const [user] = await db
    .select({ id: users.id, username: users.username, displayName: users.displayName, passwordHash: users.passwordHash, deleteAfter: users.deleteAfter })
    .from(users)
    .where(eq(sql`lower(${users.username})`, username.toLowerCase()));
  if (!user || user.deleteAfter) fail(`No Glofly account called @${username}. Sign up in the Glofly app first.`);

  const [existing] = await db.select({ id: admins.id }).from(admins).where(eq(admins.userId, user.id));
  if (existing) {
    console.log(`@${user.username} is already the admin.`);
    const answer = await ask("Reset the admin password, authenticator and backup codes? (y/n) ");
    if (answer.toLowerCase() !== "y") fail("Nothing changed.");
  }

  console.log(`\nChoose an admin password for @${user.username}. Use a NEW one, not your Glofly password.`);
  console.log(`At least ${MIN_ADMIN_PASSWORD} characters. Nothing shows while you type.\n`);
  let password = "";
  for (;;) {
    password = await ask("Admin password: ", true);
    if (password.length < MIN_ADMIN_PASSWORD) {
      console.log(`  Too short: at least ${MIN_ADMIN_PASSWORD} characters.`);
      continue;
    }
    if (await verifyPassword(user.passwordHash, password)) {
      console.log("  That's your Glofly password. Choose a different one for Control.");
      continue;
    }
    if ((await ask("Type it again: ", true)) !== password) {
      console.log("  Those didn't match. Try again.");
      continue;
    }
    break;
  }

  const secret = newTotpSecret();
  const uri = otpauthUri(secret, user.username);
  console.log("\nScan this with your authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…):\n");
  console.log(await QRCode.toString(uri, { type: "terminal", small: true, errorCorrectionLevel: "M" }));
  console.log("Can't scan? Add it by hand:");
  console.log(`  Account: Glofly Control (@${user.username})`);
  console.log(`  Key:     ${secret.match(/.{1,4}/g)!.join(" ")}`);
  console.log("  Type:    time-based, 6 digits, every 30 seconds\n");

  let step: number | null = null;
  for (let tries = 0; tries < 5 && step === null; tries++) {
    step = verifyTotp(secret, await ask("Type the 6-digit code it shows now: "), 0);
    if (step === null) console.log("  That code doesn't match. Check the time on your phone and try the next code.");
  }
  if (step === null) fail("No code matched, so nothing changed. Run this again to start over.");
  // The code just typed can't also be used to sign in (sign in with the next one).
  const lastStep = step;

  const backup = Array.from({ length: BACKUP_CODES }, () => newBackupCode());
  const values = {
    passwordHash: await hashPassword(password),
    totpSecret: encryptSecret(secret),
    lastTotpStep: lastStep,
    backupCodes: backup.map(hashBackupCode),
  };
  let adminId: string;
  if (existing) {
    await db.update(admins).set(values).where(eq(admins.id, existing.id));
    // Any Control window that was signed in has to sign in again with the new details.
    await db.delete(adminSessions).where(eq(adminSessions.adminId, existing.id));
    adminId = existing.id;
  } else {
    const [created] = await db.insert(admins).values({ userId: user.id, ...values }).returning({ id: admins.id });
    adminId = created.id;
  }
  await logAction({
    adminId,
    action: existing ? "Admin details reset" : "Admin set up",
    targetUserId: user.id,
    targetLabel: `@${user.username}`,
    note: "admin:setup script on the server",
  });

  console.log("\n✓ Done. Backup codes (each works once, if your phone isn't handy). Keep them somewhere safe:\n");
  for (let i = 0; i < backup.length; i += 2) console.log(`    ${backup[i]}    ${backup[i + 1] ?? ""}`);
  console.log(`\nSign in to Glofly Control as @${user.username} with the admin password and the NEXT code your app shows.\n`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    rl.close();
    await pool.end().catch(() => {});
  });
