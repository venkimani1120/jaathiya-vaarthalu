const sanitizeHtml = require('sanitize-html');

// Keeps Telugu letters AND combining marks (\p{M}); a plain \w would strip them.
function slugify(title) {
  const base = title
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return base || 'article';
}

function cleanHtml(html) {
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h2', 'h3', 'figure', 'figcaption']),
    allowedAttributes: { a: ['href'], img: ['src', 'alt'] },
    allowedSchemes: ['http', 'https', 'mailto'],
  });
}

// SQLite-friendly UTC timestamp: "YYYY-MM-DD HH:MM:SS"
function toDbTime(input) {
  return new Date(input).toISOString().replace('T', ' ').slice(0, 19);
}

module.exports = { slugify, cleanHtml, toDbTime };
