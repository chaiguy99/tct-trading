import { randomBytes, scryptSync } from "node:crypto";
import process from "node:process";

const stdin = process.stdin;

if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
  console.error("Run this command directly in a terminal so the password stays hidden.");
  process.exit(1);
}

process.stdout.write("Choose a password (minimum 12 characters): ");
stdin.setEncoding("utf8");
stdin.setRawMode(true);
stdin.resume();

let password = "";

function finish() {
  stdin.setRawMode(false);
  stdin.pause();

  if (password.length < 12) {
    console.error("\nPassword must contain at least 12 characters.");
    process.exitCode = 1;
    return;
  }

  const salt = randomBytes(16);
  const digest = scryptSync(password, salt, 64).toString("hex");
  process.stdout.write(`\nscrypt:${salt.toString("hex")}:${digest}\n`);
}

stdin.on("data", (chunk) => {
  for (const character of chunk) {
    if (character === "\u0003") {
      stdin.setRawMode(false);
      process.stdout.write("\n");
      process.exit(130);
    }
    if (character === "\r" || character === "\n") {
      finish();
      return;
    }
    if (character === "\u007f" || character === "\b") {
      password = password.slice(0, -1);
      continue;
    }
    if (character >= " ") {
      password += character;
    }
  }
});
