// Bundles dist/ into one self-contained HTML page (scripts and styles inlined), for hosts that
// serve a single file. Usage: node tools/single-file.mjs <out.html>
import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve('dist');
let html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const read = (href) => fs.readFileSync(path.join(dist, href.replace(/^\.\//, '')), 'utf8');

html = html.replace(/<link rel="stylesheet"[^>]*href="(\.\/assets\/[^"]+\.css)"[^>]*>/g, (_, href) => `<style>\n${read(href)}\n</style>`);
html = html.replace(/<script type="module"[^>]*src="(\.\/assets\/[^"]+\.js)"[^>]*><\/script>/g, (_, src) =>
  `<script type="module">\n${read(src).replace(/<\/script/gi, '<\\/script')}\n</script>`);

// The host wraps the page in its own document skeleton: keep only the head's title, links and
// styles, then the body content.
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1].replace(/<meta[^>]*>\s*/g, '');
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
const title = head.match(/<title>[\s\S]*?<\/title>/)[0];
const rest = head.replace(title, '');
// The module script reads #app, so it must come after the body markup.
fs.writeFileSync(process.argv[2], `${title}\n${rest.trim()}\n${body.trim()}\n`);
console.log('wrote', process.argv[2], (fs.statSync(process.argv[2]).size / 1024).toFixed(0), 'KB');
