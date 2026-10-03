// src/direct-sources-client.js
// Crawla le directSources definite in config.js (portali TSO/DSO/EPC) usando
// l'actor Apify Website Content Crawler, ed estrae il testo pulito di ogni
// pagina. Il testo viene poi passato ad Anthropic (vedi extractTenderItems
// in anthropic-client.js) per identificare eventuali tender menzionati.

/**
 * Crawla una singola fonte diretta e restituisce le pagine trovate come
 * { url, text }. Se il sito blocca il crawling via robots.txt (con
 * respectRobotsTxtFile: true) l'actor restituirà semplicemente 0 pagine:
 * in quel caso la fonte va controllata manualmente (viene segnalato nei log).
 */
export async function crawlDirectSource(client, websiteCrawlerConfig, source) {
  const run = await client.actor(websiteCrawlerConfig.actorId).call({
    startUrls: [{ url: source.url }],
    crawlerType: websiteCrawlerConfig.crawlerType,
    maxCrawlDepth: websiteCrawlerConfig.maxCrawlDepth,
    maxCrawlPages: source.maxPages || 1,
    respectRobotsTxtFile: websiteCrawlerConfig.respectRobotsTxtFile,
    saveMarkdown: false,
  });

  const { items } = await client.dataset(run.defaultDatasetId).listItems();

  return items
    .filter((item) => item.text && item.text.trim().length > 0)
    .map((item) => ({
      sourceName: source.name,
      url: item.url || source.url,
      text: item.text.slice(0, 15000), // limite di sicurezza per non esplodere i token in input
    }));
}

/**
 * Crawla tutte le directSources in sequenza (per non saturare i concurrent
 * runs del piano Apify) e restituisce un array unico di pagine.
 */
export async function crawlAllDirectSources(client, websiteCrawlerConfig, sources, onProgress) {
  const allPages = [];
  for (const source of sources) {
    try {
      const pages = await crawlDirectSource(client, websiteCrawlerConfig, source);
      allPages.push(...pages);
      if (onProgress) {
        if (pages.length === 0) {
          onProgress(source, 0, "0 pagine ottenute: possibile blocco robots.txt o pagina vuota, controllare manualmente");
        } else {
          onProgress(source, pages.length, null);
        }
      }
    } catch (err) {
      if (onProgress) onProgress(source, 0, err.message);
    }
  }
  return allPages;
}
