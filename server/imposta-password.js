// Imposta (o cambia) la password aziendale del portale.
// Uso:  npm run password
// Salva l'hash in .env (la password in chiaro non viene mai scritta).
// Dopo il cambio riavvia il servizio: sudo systemctl restart portale-zoffoli

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { creaHash } from "./password.js";

const FILE_ENV = path.join(path.dirname(fileURLToPath(import.meta.url)), ".env");

function chiediNascosto(domanda) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(domanda)) process.stdout.write(s); };
    rl.question(domanda, (risposta) => {
      rl.close();
      process.stdout.write("\n");
      resolve(risposta);
    });
  });
}

const p1 = await chiediNascosto("Nuova password aziendale: ");
if (p1.length < 8) {
  console.error("La password deve avere almeno 8 caratteri.");
  process.exit(1);
}
const p2 = await chiediNascosto("Ripeti la password: ");
if (p1 !== p2) {
  console.error("Le due password non coincidono.");
  process.exit(1);
}

const riga = `PORTALE_PASSWORD_HASH=${creaHash(p1)}`;
let contenuto = fs.existsSync(FILE_ENV) ? fs.readFileSync(FILE_ENV, "utf8") : "";
if (/^PORTALE_PASSWORD_HASH=.*$/m.test(contenuto)) {
  contenuto = contenuto.replace(/^PORTALE_PASSWORD_HASH=.*$/m, riga);
} else {
  contenuto += (contenuto && !contenuto.endsWith("\n") ? "\n" : "") + riga + "\n";
}
fs.writeFileSync(FILE_ENV, contenuto, { mode: 0o600 });
console.log(`Password salvata in ${FILE_ENV}. Riavvia il servizio per applicarla.`);
