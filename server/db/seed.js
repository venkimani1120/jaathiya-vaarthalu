// Usage: ADMIN_EMAIL=you@site.com ADMIN_PASSWORD=change-me npm run seed
const bcrypt = require('bcryptjs');
const db = require('./client');

const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
if (!email || !password) {
  console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD');
  process.exit(1);
}

db.prepare(
  `INSERT OR IGNORE INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')`
).run('Admin', email.toLowerCase(), bcrypt.hashSync(password, 12));

const cats = require('./starterCategories');
const ins = db.prepare(
  `INSERT OR IGNORE INTO categories (name_te, name_en, slug, sort_order) VALUES (?, ?, ?, ?)`
);
cats.forEach(([te, en, s], i) => ins.run(te, en, s, i));
console.log('Seeded admin user and categories.');
