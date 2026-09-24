// Recent news headlines from Google News RSS (free, no API key). India edition, since
// Skinstinct's audience is Indian.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decode(text) {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(\w+);/g, (m, name) => ENTITIES[name] ?? m)
    .trim();
}

function tag(xml, name) {
  const match = xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`));
  return match ? decode(match[1]) : '';
}

/** Parses a Google News RSS feed into { title, link, source, sourceUrl, publishedAt }. */
export function parseNewsRss(xml) {
  const items = xml.match(/<item\b[\s\S]*?<\/item>/g) ?? [];
  return items
    .map((item) => {
      const source = tag(item, 'source');
      let title = tag(item, 'title');
      // Google News appends " - Source Name" to every headline.
      if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
      const publishedAt = new Date(tag(item, 'pubDate'));
      return {
        title,
        link: tag(item, 'link'),
        source,
        sourceUrl: item.match(/<source\b[^>]*url="([^"]*)"/)?.[1] ?? '',
        publishedAt: Number.isNaN(publishedAt.getTime()) ? null : publishedAt,
      };
    })
    .filter((item) => item.title && item.link && item.publishedAt);
}

/** Searches Google News for each query and returns up to `limit` unique, recent headlines, newest first. */
export async function fetchNews(queries, { now = new Date(), maxAgeDays = 10, limit = 8, fetchImpl = fetch } = {}) {
  const feeds = await Promise.all(
    queries.map(async (query) => {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`${query} when:${maxAgeDays}d`)}&hl=en-IN&gl=IN&ceid=IN:en`;
      try {
        const res = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw new Error(`status ${res.status}`);
        return parseNewsRss(await res.text());
      } catch (err) {
        console.warn(`News search failed for "${query}":`, err.message);
        return [];
      }
    }),
  );

  const cutoff = now.getTime() - maxAgeDays * 86_400_000;
  const seen = new Set();
  return feeds
    .flat()
    .filter((item) => item.publishedAt.getTime() >= cutoff)
    .filter((item) => {
      const key = item.title.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.publishedAt - a.publishedAt)
    .slice(0, limit);
}
