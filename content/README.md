# Content guide

Everything on the website comes from the files in this folder. To change the site, edit a file here (on GitHub: open the file, click the pencil, then **Commit changes**). The site rebuilds by itself in about two minutes.

If a file has a mistake, the build stops and the live site stays as it was. To see what went wrong, open the repo's **Actions** tab, click the failed run (red cross), and read the list of problems.

Times are India time, written as `2026-10-10 09:30`. Dates are written as `2026-10-10`.

## Add a story: `articles/<web-address>.json`

The file name becomes the story's web address, so `articles/guntur-rain-alert.json` is published at `/article/guntur-rain-alert/`. Use lowercase English letters, numbers and dashes. Don't change the name after the story is published, or old links will break.

```json
{
  "title": "గుంటూరులో భారీ వర్షం",
  "summary": "One or two sentences shown under the headline and in search results.",
  "body": "<p>First paragraph.</p><p>Second paragraph.</p>",
  "image": "images/2026/10/guntur-rain.jpg",
  "section": "state",
  "author": "Reporter name",
  "published_at": "2026-10-10 09:30",
  "breaking": false
}
```

- **Required:** `title`, `body` and `published_at`. Everything else is optional.
- **`body`:** HTML. Wrap each paragraph in `<p>…</p>`. Use `<h2>` for subheadings and `<a href="…">` for links.
- **`section`:** a `slug` from `categories.json`, such as `politics`, `state`, `national`, `sports`, `cinema` or `business`.
- **`image`:** first upload the photo to `images/` (JPG or WebP, ideally 1280 px wide and under 300 KB), then put its path here. A full `https://` link also works.
- **`published_at` in the future:** the story stays hidden and goes live at the first hourly rebuild after that time.
- **`"draft": true`:** keeps the story off the site.
- **`"breaking": true`:** shows the story in the red ticker. Set it back to `false` when the news is no longer breaking.
- **`"updated_at": "2026-10-10 14:00"`:** optional. Tells Google when you corrected a story.

## E-paper: `epaper.json`

PDFs are too big to keep in the repo, so each edition goes on a GitHub Release:

1. In the repo, go to **Releases** → **Draft a new release**.
2. In **Choose a tag**, type `epaper-2026-10-10` and click **Create new tag**. Use the same text as the title.
3. Drag the PDF into the attachments box and click **Publish release**.
4. Right-click the PDF under **Assets**, choose **Copy link address**, and add an entry to the **top** of `epaper.json`:

```json
[
  { "date": "2026-10-10", "pdf": "https://github.com/venkimani1120/jaathiya-vaarthalu/releases/download/epaper-2026-10-10/2026-10-10.pdf", "thumb": "images/epaper/2026-10-10.jpg" }
]
```

- **`thumb`** (optional): a picture of the front page, uploaded to `images/epaper/`.
- **`name`** (optional): for days with more than one edition, for example `"Guntur"`.

The repo must be **public** for readers to open Release files. If it is private, put the PDFs on Google Drive (share as "Anyone with the link") and paste that link as `pdf` instead.

## Ads: `ads.json`

```json
[
  { "slot": "inline", "image": "images/ads/shop.jpg", "link": "https://shop.example", "start": "2026-10-01", "end": "2026-10-31" }
]
```

The ad is shown under every story between `start` and `end`, which are both optional. Only the `inline` slot is used. If several ads are live, one is picked at each rebuild.

## Sections: `categories.json`

Each section has a `slug` (its web address: lowercase letters, numbers and dashes), a `name_en` and, optionally, a `name_te`. The order in the file is the order in the menu. Don't change a slug once the section has stories.

## Paper details: `site.json`

This file holds the newspaper's name, tagline, editor, RNI number, address, phone and `whatsapp` number, where advertising and subscription enquiries are sent. It also holds the ad sizes and subscription plans with their prices. A `price` of `null` shows "Contact us for the price".
