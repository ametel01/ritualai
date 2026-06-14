import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";

export type FileSystem = {
  readText(filePath: string): Promise<string>;
  writeTextAtomic(filePath: string, content: string): Promise<void>;
  ensureDir(dirPath: string): Promise<void>;
  removeDir(dirPath: string): Promise<void>;
};

export const nodeFileSystem: FileSystem = {
  async readText(filePath: string): Promise<string> {
    return readFile(filePath, "utf8");
  },
  async writeTextAtomic(filePath: string, content: string): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, content, "utf8");
    await rename(tempPath, filePath);
  },
  async ensureDir(dirPath: string): Promise<void> {
    await mkdir(dirPath, { recursive: true });
  },
  async removeDir(dirPath: string): Promise<void> {
    await rm(dirPath, { recursive: true, force: true });
  },
};
