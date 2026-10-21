// Dev loop (macOS): rebuild the extension and copy it over the installed one, then restart Claude Desktop.
// Install dist/shalav.mcpb once by hand; after that `pnpm dev:install` replaces the uninstall/reinstall. --no-restart skips the restart.
import { execFileSync, execSync } from "node:child_process";
import { cp, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const target = join(homedir(), "Library/Application Support/Claude/Claude Extensions/local.mcpb.shalav.shalav");
if (!(await stat(target).catch(() => null))) {
  console.error(`Not installed yet: install dist/shalav.mcpb in Claude Desktop once (${target} is missing).`);
  process.exit(1);
}

execFileSync("pnpm", ["pack:mcpb"], { stdio: "inherit" });

const running = () => {
  try {
    execSync('pgrep -x Claude', { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};
const restart = !process.argv.includes("--no-restart") && running();
if (restart) {
  execSync(`osascript -e 'quit app "Claude"'`);
  for (let i = 0; i < 40 && running(); i++) await new Promise((r) => setTimeout(r, 250));
}

await rm(join(target, "server"), { recursive: true, force: true });
await cp("build/mcpb", target, { recursive: true });
console.log(`dev:install: copied build/mcpb -> ${target}`);

if (restart) execSync("open -a Claude");
else console.log("dev:install: restart Claude Desktop (or turn Shalav off and on in Settings → Extensions) to load it.");
