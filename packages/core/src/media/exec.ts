import { spawn } from "node:child_process";

export type ExecResult = { stdout: string; stderr: string };

/** Run a binary, collect stdout/stderr, reject on non-zero exit. */
export function exec(bin: string, args: string[], opts: { cwd?: string } = {}): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d: string) => (stdout += d));
    child.stderr.on("data", (d: string) => (stderr += d));
    child.on("error", (err) => reject(new Error(`${bin}: ${err.message} (is it installed and on PATH?)`)));
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${bin} ${args.slice(0, 8).join(" ")}… exited ${code}: ${stderr.trim().slice(-1500)}`));
    });
  });
}
