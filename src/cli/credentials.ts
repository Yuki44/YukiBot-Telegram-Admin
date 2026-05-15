import dotenv from "dotenv";
dotenv.config();

import bcrypt from "bcryptjs";
import readline from "readline";
import mongoose from "mongoose";
import { connectDB, disconnectDB } from "../db/connection";
import { credentialRepository } from "../db/repositories/credentialRepository";

const BCRYPT_ROUNDS = 12;

function writeLine(text: string): void {
  process.stdout.write(`${text}\n`);
}

function usage(): never {
  console.error(
    [
      "Uso:",
      "  npm run cred:add  -- <username> <telegramUserId> [displayName]",
      "  npm run cred:list",
      "  npm run cred:rm   -- <username>",
      "",
      "Notas:",
      "  - <username> se guarda en minúsculas y debe ser único.",
      "  - <telegramUserId> es el ID numérico de Telegram al que autentica el credencial:",
      "    el panel mostrará exactamente los chats donde ese ID es admin.",
      "  - cred:add pide la contraseña por stdin (sin eco) y la confirma.",
    ].join("\n")
  );
  process.exit(2);
}

function readSecret(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    process.stdout.write(prompt);
    // Suppress echo while the user types.
    const writeToOutput = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput;
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s) => {
      if (s.includes("\n") || s.includes("\r")) writeToOutput.call(rl, s);
    };
    rl.question("", (answer) => {
      process.stdout.write("\n");
      rl.close();
      resolve(answer);
    });
  });
}

async function cmdAdd(args: string[]): Promise<void> {
  const [username, userIdRaw, ...nameParts] = args;
  if (!username || !userIdRaw) usage();
  const userId = Number(userIdRaw);
  if (!Number.isFinite(userId) || userId <= 0) {
    console.error("ID de Telegram inválido (debe ser un número positivo).");
    process.exit(2);
  }
  const name = nameParts.length > 0 ? nameParts.join(" ").trim() : undefined;

  const pw1 = await readSecret(`Contraseña para "${username}": `);
  if (pw1.length < 8) {
    console.error("La contraseña debe tener al menos 8 caracteres.");
    process.exit(2);
  }
  const pw2 = await readSecret("Confirmar contraseña: ");
  if (pw1 !== pw2) {
    console.error("Las contraseñas no coinciden.");
    process.exit(2);
  }

  const passwordHash = await bcrypt.hash(pw1, BCRYPT_ROUNDS);
  const cred = await credentialRepository.upsert({ username, passwordHash, userId, name });
  writeLine(`OK · ${cred.username} (userId ${cred.userId}${cred.name ? `, "${cred.name}"` : ""})`);
}

async function cmdList(): Promise<void> {
  const all = await credentialRepository.listAll();
  if (all.length === 0) {
    writeLine("(sin credenciales)");
    return;
  }
  for (const c of all) {
    writeLine(
      `${c.username}\tuserId=${c.userId}\tname=${c.name ?? "-"}\tcreated=${c.createdAt.toISOString()}`
    );
  }
}

async function cmdRm(args: string[]): Promise<void> {
  const [username] = args;
  if (!username) usage();
  const removed = await credentialRepository.remove(username);
  if (!removed) {
    console.error(`No existe credencial "${username}".`);
    process.exit(1);
  }
  writeLine(`OK · "${username}" eliminado.`);
}

async function main(): Promise<void> {
  const [, , subcommand, ...rest] = process.argv;
  if (!subcommand) usage();

  await connectDB();
  try {
    switch (subcommand) {
      case "add":
        await cmdAdd(rest);
        break;
      case "list":
        await cmdList();
        break;
      case "rm":
        await cmdRm(rest);
        break;
      default:
        usage();
    }
  } finally {
    await disconnectDB();
    // mongoose holds open handles; force exit so the CLI doesn't hang.
    setImmediate(() => process.exit(0));
  }
}

main().catch((err) => {
  console.error(String(err));
  void mongoose.disconnect().finally(() => process.exit(1));
});
