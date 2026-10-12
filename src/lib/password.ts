import { scryptSync, timingSafeEqual } from "node:crypto";

export function verifyPassword(password: string, encodedHash: string): boolean {
  if (password.length > 1_024) {
    return false;
  }

  const [algorithm, salt, expectedHex, extra] = encodedHash.split(":");

  if (
    algorithm !== "scrypt" ||
    !salt ||
    !expectedHex ||
    extra !== undefined ||
    !/^[\da-f]{32,128}$/i.test(salt) ||
    !/^[\da-f]{128}$/i.test(expectedHex)
  ) {
    return false;
  }

  const expected = Buffer.from(expectedHex, "hex");
  const actual = scryptSync(password, Buffer.from(salt, "hex"), expected.length);

  return timingSafeEqual(actual, expected);
}
