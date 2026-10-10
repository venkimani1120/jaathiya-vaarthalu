// Uses Node's built-in SQLite (node:sqlite, Node 22.13+), so there is no native module to compile.
// The small wrapper keeps the same prepare().all/get/run style used across the app.
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const raw = new DatabaseSync(path.join(dataDir, 'app.db'));
raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
raw.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
// Columns added after launch: CREATE TABLE IF NOT EXISTS does not change existing tables, so add them here
const hasCol = (t, c) => raw.prepare(`PRAGMA table_info(${t})`).all().some((r) => r.name === c);
if (!hasCol('categories', 'name_en')) raw.exec('ALTER TABLE categories ADD COLUMN name_en TEXT');
if (!hasCol('enquiries', 'notify_status')) raw.exec('ALTER TABLE enquiries ADD COLUMN notify_status TEXT; ALTER TABLE enquiries ADD COLUMN notify_error TEXT');
// Section names are shown in English: give starter sections created before name_en existed their English name
const fillEn = raw.prepare('UPDATE categories SET name_en = ? WHERE slug = ? AND name_en IS NULL');
require('./starterCategories').forEach(([, en, slug]) => fillEn.run(en, slug));

module.exports = {
  prepare(sql) {
    const st = raw.prepare(sql);
    return { all: (...a) => st.all(...a), get: (...a) => st.get(...a), run: (...a) => st.run(...a) };
  },
  exec: (sql) => raw.exec(sql),
};
