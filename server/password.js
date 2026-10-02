// Hash della password aziendale con scrypt (incluso in Node, nessuna dipendenza).
// Formato salvato in .env:  scrypt$<salt hex>$<hash hex>

import crypto from "node:crypto";

export function creaHash(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verificaPassword(password, salvato) {
  if (!password || !salvato) return false;
  const [algo, saltHex, hashHex] = salvato.split("$");
  if (algo !== "scrypt" || !saltHex || !hashHex) return false;
  const atteso = Buffer.from(hashHex, "hex");
  const calcolato = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), atteso.length);
  return crypto.timingSafeEqual(atteso, calcolato);
}
