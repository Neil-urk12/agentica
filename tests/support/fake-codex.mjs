// Stand-in for Codex under tests: records raw PTY input and emits an OSC 9
// notification once the trigger file appears. No real agent runs.
// Paths arrive as arguments: <received file> <trigger file>.
import { appendFileSync, existsSync } from "node:fs";

const [received, trigger] = process.argv.slice(2);

// Raw mode keeps the PTY bytes verbatim: the tests assert the exact
// bracketed-paste sequence the backend sent, with no line buffering added.
if (typeof process.stdin.setRawMode === "function") {
  try {
    process.stdin.setRawMode(true);
  } catch {
    // A pipe (no console) is already unbuffered for the tests' purposes.
  }
}
process.stdin.on("data", (chunk) => appendFileSync(received, chunk));
process.stdout.write("fake codex ready\r\n");
const timer = setInterval(() => {
  if (existsSync(trigger)) {
    clearInterval(timer);
    process.stdout.write("\x1b]9;Approval requested\x07");
  }
}, 50);
