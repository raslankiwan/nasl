import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir, copyFile } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const app = process.argv[2];
if (!['mobile', 'admin'].includes(app)) throw new Error('Expected mobile or admin');
const dist = resolve(root, 'apps', app, 'dist');
await copyFile(resolve(root, 'scripts/pwa/client.js'), resolve(dist, 'pwa.js'));
async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) => {
        const path = resolve(directory, entry.name);
        return entry.isDirectory() ? files(path) : [path];
      }),
    )
  ).flat();
}
const staticFiles = (await files(dist))
  .filter(
    (path) =>
      /\.(html|js|css|png|ico|webp|svg|ttf|woff2?|webmanifest)$/.test(path) &&
      !path.endsWith('/sw.js'),
  )
  .sort();
const hash = createHash('sha256');
for (const path of staticFiles) hash.update(relative(dist, path)).update(await readFile(path));
const config = {
  cachePrefix: `nasl-${app}-`,
  cacheName: `nasl-${app}-${hash.digest('hex').slice(0, 16)}`,
  assets: staticFiles.map((path) => `/${relative(dist, path).split('\\').join('/')}`),
};
const worker = await readFile(resolve(root, 'scripts/pwa/worker.js'), 'utf8');
await writeFile(
  resolve(dist, 'sw.js'),
  worker.replace('= __CONFIG__', `= ${JSON.stringify(config)}`),
);
console.log(`PWA ${app}: ${config.assets.length} static assets, ${config.cacheName}`);
