// config.js
// Configurazione centrale del DAILY BRIEF - Tender Power/Distribution Transformer
// Modifica questo file per aggiungere/rimuovere query, mercati o fonti dirette,
// senza toccare la logica in daily-brief.js

export default {
  // ---------------------------------------------------------------------
  // QUERY DI RICERCA (multi-lingua, multi-mercato)
  // Ogni query viene lanciata separatamente sull'actor Apify Google Search
  // Scraper. Tienile brevi e specifiche: query troppo generiche restituiscono
  // rumore che poi lo scoring Anthropic deve filtrare (costo/tempo inutile).
  // ---------------------------------------------------------------------
  searchQueries: [
    // Inglese - power transformer
    { query: '"power transformer" tender 2026', market: "Global EN", lang: "en" },
    { query: '"power transformer" "invitation to bid"', market: "Global EN", lang: "en" },
    { query: 'HV transformer procurement tender TSO', market: "Global EN", lang: "en" },
    { query: '"distribution transformer" tender DSO', market: "Global EN", lang: "en" },

    // Spagnolo - LATAM
    { query: '"transformador de potencia" licitación', market: "LATAM ES", lang: "es" },
    { query: '"transformador de distribución" licitación pública', market: "LATAM ES", lang: "es" },
    { query: 'licitación subestación transformador AT', market: "LATAM ES", lang: "es" },

    // Portoghese - Brasile
    { query: '"transformador de potência" licitação', market: "Brasil PT", lang: "pt" },
    { query: 'ANEEL leilão transformador subestação', market: "Brasil PT", lang: "pt" },

    // Tedesco - DACH / Balcani (BEW e simili)
    { query: '"Leistungstransformator" Ausschreibung', market: "DACH DE", lang: "de" },
    { query: '"Verteiltransformator" Ausschreibung Netzbetreiber', market: "DACH DE", lang: "de" },

    // Italiano
    { query: 'gara trasformatore di potenza AT/MT', market: "Italia IT", lang: "it" },
  ],

  // ---------------------------------------------------------------------
  // FONTI DIRETTE (siti di TSO/DSO/EPC da monitorare senza passare da
  // Google, dato che il monitoraggio diretto si è dimostrato più affidabile
  // degli actor Apify community per i portali di procurement)
  // Ogni fonte viene crawlata automaticamente (vedi apify.websiteCrawler
  // sotto) e il contenuto passato ad Anthropic per estrazione + scoring.
  //
  // maxPages: quante pagine crawlare a partire dall'url (1 = solo quella
  // pagina, senza seguire link interni). Alza con cautela: ogni pagina in
  // più = più crediti Apify + più token Anthropic.
  // ---------------------------------------------------------------------
  directSources: [
    { name: "TED - Tenders Electronic Daily (EU)", url: "https://ted.europa.eu/en/search/result?search-scope=ACTIVE&FT_TEXT=power%20transformer", maxPages: 1 },
    { name: "BEW Berliner Energie und Wärme - Vergabeplattform", url: "https://www.berlinerenergieundwaerme.de", maxPages: 3 },
    { name: "HEP ODS Croazia - Nabava", url: "https://www.hep.hr/ods/nabava/", maxPages: 3 },
    // Aggiungi qui altri portali TSO/DSO rilevanti per LATAM/Iberia man mano che li identifichi
  ],

  // ---------------------------------------------------------------------
  // ESCLUSIONI - risultati con questi termini nel titolo/snippet vengono
  // scartati prima ancora di arrivare allo scoring Anthropic (risparmio token)
  // ---------------------------------------------------------------------
  excludeIfContains: [
    "toy transformer",
    "transformers movie",
    "transformers toy",
    "power adapter", // spesso confuso con "power transformer" nei risultati consumer
    "usb charger",
  ],

  // ---------------------------------------------------------------------
  // APIFY - actor usato per la ricerca web (Google Search Results Scraper)
  // ---------------------------------------------------------------------
  apify: {
    actorId: "apify/google-search-scraper",
    resultsPerQuery: 10,
    // La ricerca è volutamente limitata al web pubblico indicizzato da Google.
    // LinkedIn NON viene incluso qui: lo scraping automatizzato di LinkedIn
    // viola i suoi Termini di Servizio. Per LinkedIn usa le "ricerche salvate
    // con alert" native dell'app (vedi README, sezione "LinkedIn").

    // Actor usato per crawlare le directSources (portali TSO/DSO/EPC).
    // Rispetta robots.txt di default: se un portale lo vieta esplicitamente,
    // l'actor non lo crawla e va controllato manualmente.
    websiteCrawler: {
      actorId: "apify/website-content-crawler",
      crawlerType: "cheerio", // più leggero e veloce; passa a "playwright" solo se il sito richiede JS
      maxCrawlDepth: 1,
      respectRobotsTxtFile: true,
    },
  },

  // ---------------------------------------------------------------------
  // ANTHROPIC - modello e soglia di rilevanza per lo scoring
  // ---------------------------------------------------------------------
  anthropic: {
    model: "claude-sonnet-5", // aggiornato da "claude-sonnet-4-6": stringa non tra i modelli correnti, verificare se era intenzionale
    relevanceThreshold: 6, // 0-10: sotto questa soglia il risultato non entra nel brief finale
    maxTokensPerScoring: 1000,
  },

  // ---------------------------------------------------------------------
  // OUTPUT
  // markdownDir: viene committato su git dal workflow Actions (storico
  //   versionato dei brief giornalieri, uno per data)
  // jsonDir: dato grezzo completo (utile per debug/analisi), NON committato
  //   — vedi .gitignore
  // ---------------------------------------------------------------------
  output: {
    markdownDir: "./daily-briefs",
    jsonDir: "./output",
  },
};
