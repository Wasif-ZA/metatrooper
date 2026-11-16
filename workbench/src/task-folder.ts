import fs from 'node:fs/promises';
import path from 'node:path';

export function taskSlug(task: string): string {
  const slug = task.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40).replace(/^-+|-+$/g, '');
  return !slug || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(slug) ? 'task' : slug;
}

export async function makeTaskFolder(base: string, task: string): Promise<string> {
  const root = path.resolve(base);
  await fs.mkdir(root, { recursive: true });
  const slug = taskSlug(task);
  for (let n = 1; ; n++) {
    const folder = path.join(root, n === 1 ? slug : `${slug}-${n}`);
    try {
      await fs.mkdir(folder);
      return folder;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
}
