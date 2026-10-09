// One-off: fingerprint the reference page as hashed word pairs. Usage: node tools/make-ref-bigrams.mjs <ref-index.html>
import fs from "node:fs";
import { segmentsOf, bigramHashes } from "./text.mjs";
const html = fs.readFileSync(process.argv[2], "utf8");
const set = bigramHashes(segmentsOf(html));
fs.writeFileSync(new URL("./ref-bigrams.json", import.meta.url), JSON.stringify([...set].sort()));
console.log("bigrams:", set.size);
