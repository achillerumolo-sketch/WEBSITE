#!/usr/bin/env node
// daily-brief.js
// Orchestratore principale: Apify (ricerca web) -> filtro esclusioni ->
// Anthropic API (scoring + sintesi) -> report JSON/Markdown.
//
// Uso: node daily-brief.js
// (richiede .env configurato in locale, vedi .env.example — in CI le
// variabili arrivano dai secrets del workflow, non serve .env)

import "dotenv/config";
import config from "./config.js";
import { createApifyClient, runAllSearchQueries } from "./src/apify-client.js";
import { crawlAllDirectSources } from "./src/direct-sources-client.js";
import {
  createAnthropicClient,
  scoreAllResults,
  extractTenderItemsFromAllPages,
  generateSummary,
} from "./src/anthropic-client.js";
import { ensureOutputDir, writeJsonReport, writeMarkdownReport } from "./src/report.js";

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function filterExclusions(results, excludeTerms) {
  const lowerExcludes = excludeTerms.map((t) => t.toLowerCase());
  return results.filter((r) => {
    const haystack = `${r.title} ${r.snippet}`.toLowerCase();
    return !lowerExcludes.some((term) => haystack.includes(term));
  });
}

function dedupeByUrl(results) {
  const seen = new Set();
  return results.filter((r) => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });
}

async function main() {
  log("Avvio DAILY BRIEF - Tender Power/Distribution Transformer");

  // 1. Setup client
  const apifyClient = createApifyClient(process.env.APIFY_API_TOKEN);
  const anthropicClient = createAnthropicClient(process.env.ANTHROPIC_API_KEY);

  // 2. Ricerca web via Apify
  log(`Esecuzione di ${config.searchQueries.length} query di ricerca via Apify...`);
  const rawResults = await runAllSearchQueries(
    apifyClient,
    config.apify,
    config.searchQueries,
    (q, count, err) => {
      if (err) {
        log(`  ✗ Query "${q.query}" fallita: ${err.message}`);
      } else {
        log(`  ✓ Query "${q.query}" (${q.market}): ${count} risultati`);
      }
    }
  );
  log(`Totale risultati grezzi da ricerca web: ${rawResults.length}`);

  // 3. Pulizia: dedup + esclusioni lessicali (prima dello scoring, per risparmiare token)
  const deduped = dedupeByUrl(rawResults);
  const filtered = filterExclusions(deduped, config.excludeIfContains);
  log(`Dopo dedup ed esclusioni: ${filtered.length} risultati da scorare`);

  // 4. Scoring di rilevanza via Anthropic API (risultati da ricerca web)
  log("Scoring di rilevanza via Anthropic API (può richiedere qualche minuto)...");
  const scoredSearch = await scoreAllResults(anthropicClient, config.anthropic, filtered, (r, score) => {
    const flag = score.relevance_score >= config.anthropic.relevanceThreshold ? "★" : " ";
    log(`  ${flag} [${score.relevance_score}/10] ${r.title.slice(0, 70)}`);
  });

  // 5. Crawling automatico delle fonti dirette (TSO/DSO/EPC) via Apify
  log(`Crawling di ${config.directSources.length} fonti dirette...`);
  const crawledPages = await crawlAllDirectSources(
    apifyClient,
    config.apify.websiteCrawler,
    config.directSources,
    (source, count, warning) => {
      if (warning) {
        log(`  ⚠ ${source.name}: ${warning}`);
      } else {
        log(`  ✓ ${source.name}: ${count} pagine crawlate`);
      }
    }
  );

  // 6. Estrazione + scoring dei tender menzionati nelle fonti dirette
  let scoredDirect = [];
  if (crawledPages.length > 0) {
    log("Estrazione tender dalle fonti dirette via Anthropic API...");
    scoredDirect = await extractTenderItemsFromAllPages(
      anthropicClient,
      config.anthropic,
      crawledPages,
      (page, count) => log(`  ${page.sourceName}: ${count} possibili tender individuati`)
    );
  }

  // 7. Unione dei due flussi (ricerca web + fonti dirette), dedup finale per URL
  const scored = dedupeByUrl([...scoredSearch, ...scoredDirect]);

  // 8. Filtra sopra soglia e ordina per score decrescente
  const relevant = scored
    .filter((r) => r.relevance_score >= config.anthropic.relevanceThreshold)
    .sort((a, b) => b.relevance_score - a.relevance_score);

  log(`Risultati sopra soglia (>= ${config.anthropic.relevanceThreshold}): ${relevant.length}`);

  // 9. Sintesi finale in linguaggio naturale
  log("Generazione sintesi...");
  const summary = await generateSummary(anthropicClient, config.anthropic.model, relevant);

  // 10. Scrittura report — markdown in daily-briefs/ (committato dal workflow),
  //     JSON in output/ (solo locale/debug, gitignored)
  ensureOutputDir(config.output.markdownDir);
  ensureOutputDir(config.output.jsonDir);
  const mdPath = writeMarkdownReport(config.output.markdownDir, {
    summary,
    relevantResults: relevant,
    stats: {
      total: scored.length,
      relevant: relevant.length,
      queriesRun: config.searchQueries.length,
      directSourcesCrawled: config.directSources.length,
      directPagesFound: crawledPages.length,
    },
  });
  const jsonPath = writeJsonReport(config.output.jsonDir, scored);

  log(`Report Markdown (committato): ${mdPath}`);
  log(`Report JSON (locale, non committato): ${jsonPath}`);
  log("Nota: LinkedIn non è incluso nella ricerca automatica - usa gli alert nativi (vedi README).");
  log("DAILY BRIEF completato.");
}

main().catch((err) => {
  console.error("Errore fatale nell'esecuzione del DAILY BRIEF:", err);
  process.exit(1);
});
