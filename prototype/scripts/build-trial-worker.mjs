import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const html = await readFile(path.join(dist, 'index.html'), 'utf8');
const scriptPath = html.match(/<script[^>]+src="([^"]+)"/)?.[1];
const stylePath = html.match(/<link[^>]+href="([^"]+)"/)?.[1];
if (!scriptPath || !stylePath) throw new Error('Vite build assets were not found.');

const [script, style] = await Promise.all([
  readFile(path.join(dist, scriptPath.replace(/^\//, '')), 'utf8'),
  readFile(path.join(dist, stylePath.replace(/^\//, '')), 'utf8'),
]);
const page = html
  .replace(/<script[^>]+src="[^"]+"[^>]*><\/script>/, `<script type="module">${script.replace(/<\/script/gi, '<\\/script')}</script>`)
  .replace(/<link[^>]+href="[^"]+"[^>]*>/, `<style>${style}</style>`);
const worker = `const page=${JSON.stringify(page)};\nexport default {fetch(request){const url=new URL(request.url);if(url.pathname==='/'||!url.pathname.includes('.'))return new Response(page,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});return new Response('',{status:204});}};\n`;
await mkdir(path.join(dist, 'server'), { recursive: true });
await writeFile(path.join(dist, 'server', 'index.js'), worker);
