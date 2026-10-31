// Reads approved news and published e-papers straight from the news desk app's MongoDB (the database of
// jaathiya-vaartalu-studio-app; its photos are Cloudinary URLs). Only reads: give this app a read-only database user.
// Collections are the ones Mongoose makes for the desk app's models: news, epapers, users.
// fetchFromMongo() returns the same { base, news, epapers } as fetchRemote() in src/remote.js, so content.js maps both alike.
const { MongoClient, ObjectId } = require('mongodb');

const VISIBLE = { status: { $in: ['approved', 'published'] } };
const FIELDS = { title: 1, highlights: 1, body: 1, images: 1, section: 1, district: 1, constituency: 1, dateline: 1, author: 1, reviewedAt: 1, createdAt: 1, updatedAt: 1 };

// One desk news document → the shape of GET /api/public/news. Desk news is approved when created, so it has no reviewedAt.
const toItem = (n, names) => ({
  id: String(n._id), title: n.title, highlights: n.highlights || [], body: n.body, images: n.images || [],
  section: n.section, district: n.district, constituency: n.constituency, dateline: n.dateline,
  author: names.get(String(n.author)) || '', approvedAt: n.reviewedAt || n.createdAt, updatedAt: n.updatedAt || n.createdAt,
});

function connect(uri) {
  const client = new MongoClient(uri, { maxPoolSize: 5, serverSelectionTimeoutMS: 15000, readPreference: 'secondaryPreferred' });
  const db = () => client.db(); // the database named in the connection string, e.g. …mongodb.net/jaathiya
  const authorNames = async (docs) => {
    const ids = [...new Set(docs.map((n) => n.author).filter(Boolean).map(String))].map((s) => new ObjectId(s));
    const users = ids.length ? await db().collection('users').find({ _id: { $in: ids } }, { projection: { name: 1 } }).toArray() : [];
    return new Map(users.map((u) => [String(u._id), u.name]));
  };

  // News approved in the last `days` days, and the newest published e-papers
  async function fetchFromMongo({ days = 90, base = '' } = {}) {
    const since = new Date(Date.now() - days * 864e5);
    const docs = await db().collection('news').find({ ...VISIBLE, $or: [{ reviewedAt: { $gte: since } }, { reviewedAt: null, createdAt: { $gte: since } }] },
      { projection: FIELDS }).sort({ createdAt: -1 }).limit(20000).toArray();
    const names = await authorNames(docs);
    const epapers = await db().collection('epapers').find({ status: 'published', shareSlug: { $exists: true } },
      { projection: { title: 1, editionDate: 1, shareSlug: 1 } }).sort({ editionDate: -1 }).limit(60).toArray();
    return { base: base.replace(/\/+$/, ''), news: docs.map((n) => toItem(n, names)), epapers };
  }

  // One story by its id, for links to stories older than `days`. null when it is missing or not approved.
  async function findNews(id) {
    if (!/^[a-f0-9]{24}$/.test(id)) return null;
    const n = await db().collection('news').findOne({ _id: new ObjectId(id), ...VISIBLE }, { projection: FIELDS });
    return n ? toItem(n, await authorNames([n])) : null;
  }

  return { client, fetchFromMongo, findNews, close: () => client.close() };
}

module.exports = { connect, toItem };
