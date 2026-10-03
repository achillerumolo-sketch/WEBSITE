// src/anthropic-client.js
// Wrapper attorno all'SDK Anthropic per: (1) scorare la rilevanza di ogni
// risultato rispetto ai tender power/distribution transformer, e (2)
// produrre una sintesi finale leggibile.

import Anthropic from "@anthropic-ai/sdk";

export function createAnthropicClient(apiKey) {
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY mancante. Copia .env.example in .env e inserisci la tua chiave."
    );
  }
  return new Anthropic({ apiKey });
}

const SCORING_SYSTEM_PROMPT = `Sei un analista che supporta un Area Sales Manager di un produttore di power/distribution transformer (alta e media tensione, fino a 400+ kV) attivo su TSO/DSO, EPC contractor e sviluppatori rinnovabili in LATAM e Iberia.

Il tuo compito: per ogni risultato di ricerca fornito, valuta se si tratta EFFETTIVAMENTE di un'opportunità di tender/gara/procurement per power transformer o distribution transformer (non trasformatori generici da giocattolo, non alimentatori, non articoli di cronaca generica sull'energia).

Rispondi SOLO con un oggetto JSON valido, senza markdown, senza testo introduttivo, con questa struttura esatta:
{
  "relevance_score": <intero 0-10>,
  "is_tender": <true|false>,
  "reason": "<motivazione in una frase, in italiano>",
  "entity": "<nome dell'ente/utility/EPC se identificabile, altrimenti null>",
  "country": "<paese se identificabile, altrimenti null>"
}

Criteri di punteggio:
- 9-10: tender/gara esplicita e attiva per power o distribution transformer, ente e paese chiari
- 6-8: probabile opportunità (procurement, invito a manifestare interesse, prequalifica) ma con qualche ambiguità
- 3-5: menzione tangenziale (articolo di settore, analisi di mercato) senza gara concreta
- 0-2: non pertinente (rumore, trasformatori non elettrici, alimentatori, ecc.)`;

/**
 * Valuta un singolo risultato di ricerca e restituisce lo score strutturato.
 */
export async function scoreResult(client, model, maxTokens, result) {
  const userPrompt = `Titolo: ${result.title}
URL: ${result.url}
Snippet: ${result.snippet}
Mercato di ricerca: ${result.market}`;

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: SCORING_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = response.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("")
    .trim();

  try {
    const cleaned = text.replace(/```json|```/g, "").trim();
    return JSON.parse(cleaned);
  } catch {
    return {
      relevance_score: 0,
      is_tender: false,
      reason: "Errore di parsing della risposta del modello",
      entity: null,
      country: null,
    };
  }
}

/**
 * Scora in sequenza tutti i risultati (sequenziale per restare entro i
 * rate limit di default; vedi README per parallelizzazione).
 */
export async function scoreAllResults(client, anthropicConfig, results, onProgress) {
  const scored = [];
  for (const r of results) {
    const score = await scoreResult(
      client,
      anthropicConfig.model,
      anthropicConfig.maxTokensPerScoring,
      r
    );
    scored.push({ ...r, ...score });
    if (onProgress) onProgress(r, score);
  }
  return scored;
}

const EXTRACTION_SYSTEM_PROMPT = `Sei un analista che supporta un Area Sales Manager di un produttore di power/distribution transformer (alta e media tensione, fino a 400+ kV) attivo su TSO/DSO, EPC contractor e sviluppatori rinnovabili in LATAM e Iberia.

Riceverai il testo grezzo estratto da una pagina web di un portale di procurement/tender (TSO, DSO, ente pubblico). Il testo può contenere menu, footer e altro rumore: ignoralo.

Il tuo compito: identifica SOLO le voci che sono effettivamente bandi/gare/tender/inviti a manifestare interesse per power transformer o distribution transformer. Se non ce ne sono, restituisci un array vuoto.

Rispondi SOLO con un array JSON valido, senza markdown, senza testo introduttivo. Ogni elemento con questa struttura esatta:
{
  "title": "<titolo o oggetto del bando così come appare nella pagina>",
  "relevance_score": <intero 0-10>,
  "is_tender": <true|false>,
  "reason": "<motivazione in una frase, in italiano>",
  "entity": "<nome dell'ente/utility se identificabile, altrimenti null>",
  "country": "<paese se identificabile, altrimenti null>"
}

Stessi criteri di punteggio della valutazione dei risultati di ricerca web:
9-10 = gara esplicita e attiva; 6-8 = probabile opportunità con qualche ambiguità; 3-5 = menzione tangenziale; 0-2 = non pertinente.`;

/**
 * Estrae ed valuta in un'unica chiamata eventuali tender presenti nel testo
 * di una pagina crawlata da una directSource. Restituisce un array (anche
 * vuoto) di item nello stesso formato usato da scoreResult, così da poter
 * essere unito ai risultati di ricerca web nel report finale.
 */
export async function extractTenderItemsFromPage(client, model, maxTokens, page) {
  const userPrompt = `Fonte: ${page.sourceName}
URL: ${page.url}

Testo della pagina:
${page.text}`;

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: EXTRACTION_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = response.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("")
    .trim();

  try {
    const cleaned = text.replace(/```json|```/g, "").trim();
    const items = JSON.parse(cleaned);
    if (!Array.isArray(items)) return [];
    return items.map((item) => ({
      title: item.title || "(senza titolo)",
      url: page.url,
      snippet: item.reason || "",
      market: page.sourceName,
      lang: "n/a",
      sourceQuery: `directSource:${page.sourceName}`,
      relevance_score: item.relevance_score,
      is_tender: item.is_tender,
      reason: item.reason,
      entity: item.entity,
      country: item.country,
    }));
  } catch {
    return [];
  }
}

/**
 * Applica extractTenderItemsFromPage a tutte le pagine crawlate e restituisce
 * un unico array di item già scorati (stesso formato di scoreAllResults).
 */
export async function extractTenderItemsFromAllPages(client, anthropicConfig, pages, onProgress) {
  const allItems = [];
  for (const page of pages) {
    const items = await extractTenderItemsFromPage(
      client,
      anthropicConfig.model,
      anthropicConfig.maxTokensPerScoring,
      page
    );
    allItems.push(...items);
    if (onProgress) onProgress(page, items.length);
  }
  return allItems;
}

/**
 * Genera una sintesi finale in linguaggio naturale (italiano) dei risultati
 * sopra soglia, pronta per essere letta in 2 minuti.
 */
export async function generateSummary(client, model, relevantResults) {
  if (relevantResults.length === 0) {
    return "Nessuna opportunità sopra soglia di rilevanza individuata oggi.";
  }

  const listing = relevantResults
    .map(
      (r, i) =>
        `${i + 1}. [Score ${r.relevance_score}] ${r.entity || "Ente non identificato"} (${r.country || r.market}) - ${r.title} - ${r.url}`
    )
    .join("\n");

  const response = await client.messages.create({
    model,
    max_tokens: 1000,
    system:
      "Sei un analista commerciale. Ricevi una lista di opportunità di tender per power/distribution transformer già filtrate e valutate. Scrivi una sintesi in italiano, in prosa scorrevole, di massimo 150 parole, che raggruppi le opportunità per area geografica ed evidenzi quelle con score più alto. Non ripetere pedissequamente ogni riga, sintetizza.",
    messages: [{ role: "user", content: listing }],
  });

  return response.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("")
    .trim();
}
