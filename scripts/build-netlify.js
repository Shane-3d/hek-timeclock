// Assembles the static "dist" folder that Netlify publishes:
//   - everything in public/  (employee clock-in page + assets)
//   - the admin page, copied to  <ADMIN_PATH>.html  so it lives at a
//     non-obvious URL (default /office). Netlify serves "/office" for
//     "office.html" automatically.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const publicDir = path.join(root, 'public');

// Fresh dist folder.
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

// Copy public/ (flat set of files).
for (const entry of fs.readdirSync(publicDir, { withFileTypes: true })) {
  if (entry.isFile()) {
    fs.copyFileSync(path.join(publicDir, entry.name), path.join(dist, entry.name));
  }
}

// Admin page at its (obscure) path.
const adminSlug =
  (process.env.ADMIN_PATH || '/office').replace(/^\//, '').replace(/[^a-zA-Z0-9_-]/g, '') ||
  'office';
fs.copyFileSync(path.join(root, 'views', 'admin.html'), path.join(dist, adminSlug + '.html'));

console.log(`Built dist/. Employee page at "/", admin page at "/${adminSlug}".`);
