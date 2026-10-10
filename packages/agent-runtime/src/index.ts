import { once } from "node:events";
import { createInterface } from "node:readline";
import { handleLine } from "./handler.js";

// shortcut: health checks only; bound input frames before adding domain commands.
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });

for await (const line of input) {
  if (!process.stdout.write(`${JSON.stringify(handleLine(line))}\n`)) {
    await once(process.stdout, "drain");
  }
}
