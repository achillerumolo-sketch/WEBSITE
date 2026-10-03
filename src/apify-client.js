// src/apify-client.js
// Wrapper minimale attorno all'SDK Apify per lanciare le query di ricerca
// definite in config.js e normalizzare i risultati.

import { ApifyClient } from "apify-client";

export function createApifyClient(apiToken) {
  if (!apiToken) {
    throw new Error(
      "APIFY_API_TOKEN mancante. Copia .env.example in .env e inserisci la tua chiave."
    );
  }
  return new ApifyClient({ token: apiToken });
}

/**
 * Lancia l'actor Google Search Scraper per una singola query e restituisce
 * i risultati normalizzati (title, url, snippet, market, lang).
 */
export async function runSearchQuery(client, actorId, resultsPerQuery, { query, market, lang }) {
  const run = await client.actor(actorId).call({
    queries: query,
    maxPagesPerQuery: 1,
    resultsPerPage: resultsPerQuery,
    languageCode: lang,
  });

  const { items } = await client.dataset(run.defaultDatasetId).listItems();

  // Il formato esatto dipende dall'actor; normalizziamo qui i campi che ci servono.
  const results = [];
  for (const item of items) {
    const organicResults = item.organicResults || item.results || [];
    for (const r of organicResults) {
      results.push({
        title: r.title || "",
        url: r.url || r.link || "",
        snippet: r.description || r.snippet || "",
        market,
        lang,
        sourceQuery: query,
      });
    }
  }
  return results;
}

/**
 * Esegue tutte le query configurate in sequenza (per non saturare i
 * concurrent runs del piano Apify) e restituisce un array unico di risultati.
 */
export async function runAllSearchQueries(client, apifyConfig, searchQueries, onProgress) {
  const all = [];
  for (const q of searchQueries) {
    try {
      const results = await runSearchQuery(
        client,
        apifyConfig.actorId,
        apifyConfig.resultsPerQuery,
        q
      );
      all.push(...results);
      if (onProgress) onProgress(q, results.length, null);
    } catch (err) {
      if (onProgress) onProgress(q, 0, err);
    }
  }
  return all;
}
