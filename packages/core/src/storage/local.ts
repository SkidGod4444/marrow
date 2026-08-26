import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import type { Storage } from "./index.ts";

/** Filesystem-backed storage for tests and no-Docker development. Keys map 1:1 to paths under `root`. */
export class LocalStorage implements Storage {
  constructor(private root: string) {}

  private path(key: string) {
    if (key.includes("..")) throw new Error(`invalid key ${key}`);
    return join(this.root, key);
  }

  async put(key: string, body: Uint8Array | string) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body);
  }

  async putFile(key: string, path: string) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await copyFile(path, p);
  }

  async get(key: string) {
    return new Uint8Array(await readFile(this.path(key)));
  }

  async getToFile(key: string, path: string) {
    await mkdir(dirname(path), { recursive: true });
    await copyFile(this.path(key), path);
  }

  async exists(key: string) {
    try {
      await stat(this.path(key));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string) {
    await rm(this.path(key), { force: true });
  }

  async list(prefix: string): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: string) => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = join(dir, e.name);
        if (e.isDirectory()) await walk(full);
        else out.push(relative(this.root, full));
      }
    };
    await walk(this.root);
    return out.filter((k) => k.startsWith(prefix)).sort();
  }

  async deletePrefix(prefix: string) {
    for (const k of await this.list(prefix)) await this.delete(k);
  }
}
