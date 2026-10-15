import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, realpath, rename, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

/** File access for the local MCP server is confined to its configured workspace. */
export class McpWorkspace {
  private constructor(readonly root: string) {}

  static async open(directory: string) {
    const root = await realpath(resolve(directory));
    if (!(await stat(root)).isDirectory()) throw new Error('MCP workspace must be a directory');
    return new McpWorkspace(root);
  }

  private inside(path: string) {
    const fromRoot = relative(this.root, path);
    if (fromRoot === '..' || fromRoot.startsWith('../') || fromRoot.startsWith('..\\') || isAbsolute(fromRoot)) {
      throw new Error('Path must stay inside the MCP workspace');
    }
    return path;
  }

  async read(path: string) {
    const file = this.inside(await realpath(this.inside(resolve(this.root, path))));
    if (!(await stat(file)).isFile()) throw new Error('Input must be a regular file');
    return file;
  }

  private async destination(path: string) {
    const destination = this.inside(resolve(this.root, path));
    if (destination === this.root) throw new Error('Output must be a file or directory inside the workspace');
    const parent = dirname(destination);
    let ancestor = parent;
    for (;;) {
      try {
        this.inside(await realpath(ancestor));
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        ancestor = dirname(ancestor);
      }
    }
    await mkdir(parent, { recursive: true });
    this.inside(await realpath(parent));
    return destination;
  }

  generatedPath(extension: string) {
    return join('.gaterunner-mcp', `${randomUUID()}${extension}`);
  }

  async write(path: string, writer: (temporary: string) => Promise<unknown>, overwrite = false) {
    const destination = await this.destination(path);
    try {
      const existing = await lstat(destination);
      if (!overwrite) throw new Error('Output already exists; set overwrite=true to replace it');
      if (!existing.isFile()) throw new Error('Cannot overwrite a directory or symbolic link');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const temporary = join(dirname(destination), `.gaterunner-${randomUUID()}.tmp`);
    try {
      await writer(temporary);
      if (overwrite) {
        try {
          const existing = await lstat(destination);
          if (!existing.isFile()) throw new Error('Cannot overwrite a directory or symbolic link');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        await rename(temporary, destination);
      } else {
        await copyFile(temporary, destination, constants.COPYFILE_EXCL);
      }
      return destination;
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async writeDirectory<T>(path: string, writer: (directory: string) => Promise<T>) {
    const destination = await this.destination(path);
    // Exclusive creation means a failed export never removes an existing folder.
    await mkdir(destination);
    const created = await lstat(destination);
    try {
      return { directory: destination, result: await writer(destination) };
    } catch (error) {
      // Verify both workspace containment and identity before recursive cleanup.
      const current = await lstat(destination);
      this.inside(await realpath(destination));
      if (!current.isDirectory() || current.isSymbolicLink() || current.ino !== created.ino || current.dev !== created.dev) {
        throw new Error('Output directory changed during export; cleanup stopped', { cause: error });
      }
      await rm(destination, { recursive: true, force: true });
      throw error;
    }
  }
}
