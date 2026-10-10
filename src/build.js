// Builds the whole site into dist/: pages from content/ (JSON), plus public/ (CSS, fonts, JS, logo) and content/images/.
// Usage: SITE_URL=https://example.com npm run build   (SITE_URL may end in a sub-path, e.g. https://user.github.io/repo)
const fs = require('fs');
const path = require('path');
const { load } = require('./content');
const { renderSite } = require('./render');

const ROOT = path.join(__dirname, '..');

function build({ contentDir = path.join(ROOT, 'content'), publicDir = path.join(ROOT, 'public'), outDir = path.join(ROOT, 'dist'),
  siteUrl = process.env.SITE_URL || 'http://localhost:3000', now = new Date() } = {}) {
  const data = load(contentDir, now);
  const files = renderSite({ ...data, siteUrl, now });
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.cpSync(publicDir, outDir, { recursive: true, filter: (src) => !src.endsWith('.txt') });
  const images = path.join(contentDir, 'images');
  if (fs.existsSync(images)) fs.cpSync(images, path.join(outDir, 'images'), { recursive: true, filter: (src) => !src.endsWith('.gitkeep') });
  for (const [file, body] of files) {
    const p = path.join(outDir, file);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }
  return { files: files.size, articles: data.articles.length };
}

if (require.main === module) {
  try {
    const r = build();
    console.log(`Built ${r.files} files (${r.articles} published stories) into dist/`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

module.exports = { build };
