CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT CHECK(role IN ('admin','editor','reporter')) NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  name_te TEXT NOT NULL,
  name_en TEXT,
  slug TEXT UNIQUE NOT NULL,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  summary TEXT,
  body TEXT NOT NULL,
  image_path TEXT,
  category_id INTEGER REFERENCES categories(id),
  author_id INTEGER REFERENCES users(id),
  status TEXT CHECK(status IN ('draft','scheduled','published')) DEFAULT 'draft',
  is_breaking INTEGER DEFAULT 0,
  published_at TEXT,
  views INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_articles_pub ON articles(status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_cat ON articles(category_id, published_at DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
  title, body, content='articles', content_rowid='id', tokenize='trigram'
);

CREATE TRIGGER IF NOT EXISTS articles_ai AFTER INSERT ON articles BEGIN
  INSERT INTO articles_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
END;
CREATE TRIGGER IF NOT EXISTS articles_ad AFTER DELETE ON articles BEGIN
  INSERT INTO articles_fts(articles_fts, rowid, title, body) VALUES ('delete', old.id, old.title, old.body);
END;
CREATE TRIGGER IF NOT EXISTS articles_au AFTER UPDATE OF title, body ON articles BEGIN
  INSERT INTO articles_fts(articles_fts, rowid, title, body) VALUES ('delete', old.id, old.title, old.body);
  INSERT INTO articles_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
END;

CREATE TABLE IF NOT EXISTS epaper_editions (
  id INTEGER PRIMARY KEY,
  edition_date TEXT NOT NULL,
  edition_name TEXT DEFAULT 'Main',
  pdf_path TEXT NOT NULL,
  thumb_path TEXT,
  UNIQUE(edition_date, edition_name)
);

CREATE TABLE IF NOT EXISTS ads (
  id INTEGER PRIMARY KEY,
  slot TEXT NOT NULL,
  image_path TEXT NOT NULL,
  link_url TEXT,
  start_date TEXT,
  end_date TEXT,
  active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS subscribers (
  id INTEGER PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  subscribed_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  user_id INTEGER, action TEXT, entity TEXT, entity_id INTEGER,
  at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Advertising and print-subscription enquiries from /advertise and /subscribe
CREATE TABLE IF NOT EXISTS enquiries (
  id INTEGER PRIMARY KEY,
  kind TEXT CHECK(kind IN ('advertise','subscription')) NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  option_key TEXT,
  place TEXT,
  message TEXT,
  status TEXT CHECK(status IN ('new','done')) DEFAULT 'new',
  notify_status TEXT,   -- SMS alert to staff: 'sent', 'logged' (no SMS provider set) or 'failed'
  notify_error TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Messages pulled from the configured WhatsApp groups (server/whatsapp.js). wa_id makes each pull idempotent.
-- status: 'draft' (became a draft article), 'image' (photo without text, attached to the sender's draft) or 'skipped'
CREATE TABLE IF NOT EXISTS wa_messages (
  id INTEGER PRIMARY KEY,
  wa_id TEXT UNIQUE NOT NULL,
  group_id TEXT NOT NULL,
  sender TEXT,
  sender_name TEXT,
  text TEXT,
  image_path TEXT,
  sent_at TEXT NOT NULL,
  article_id INTEGER REFERENCES articles(id) ON DELETE SET NULL,
  status TEXT CHECK(status IN ('draft','image','skipped')) NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_wa_sender ON wa_messages(group_id, sender, sent_at);
