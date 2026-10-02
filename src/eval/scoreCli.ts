#!/usr/bin/env node
// Development tool, not part of the published CLI: node dist/eval/scoreCli.js <expected.yml> <findings.json>
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { Finding } from "../model/finding.js";
import { formatScore, parseExpected, score } from "./score.js";

const [expectedFile, findingsFile] = process.argv.slice(2);
if (!expectedFile || !findingsFile) {
  console.error("Usage: npm run eval:score -- <expected.yml> <findings.json>");
  process.exit(1);
}
const expected = parseExpected(await readFile(expectedFile, "utf8"));
const findings = z.array(Finding).parse(JSON.parse(await readFile(findingsFile, "utf8")));
console.log(formatScore(score(expected.expected, findings)));
