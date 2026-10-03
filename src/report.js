// src/report.js
// Genera i file di output (JSON + Markdown) a partire dai risultati scorati.

import fs from "fs";
import path from "path";

function todayStamp() {
  const d = new Date();
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

export function ensureOutputDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Scrive il JSON grezzo completo (tutti i risultati scorati, sopra e sotto
// soglia). Pensato come dato di debug/audit locale, non committato su git.
export function writeJsonReport(outputDir, allScoredResults) {
  const stamp = todayStamp();
  const filePath = path.join(outputDir, `${stamp}.json`);
  fs.writeFileSync(filePath, JSON.stringify(allScoredResults, null, 2), "utf-8");
  return filePath;
}

// Scrive il Markdown finale in daily-briefs/YYYY-MM-DD.md — questo è il file
// che il workflow GitHub Actions committa nel repo per lo storico versionato.
export function writeMarkdownReport(outputDir, { summary, relevantResults, stats }) {
  const stamp = todayStamp();
  const filePath = path.join(outputDir, `${stamp}.md`);

  const lines = [];
  lines.push(`# Daily Brief - Tender Power/Distribution Transformer`);
  lines.push(`_Generato il ${stamp}_\n`);
  lines.push(`## Sintesi\n`);
  lines.push(summary + "\n");
  lines.push(`## Statistiche\n`);
  lines.push(`- Risultati totali analizzati: ${stats.total}`);
  lines.push(`- Risultati sopra soglia di rilevanza: ${stats.relevant}`);
  lines.push(`- Query di ricerca web eseguite: ${stats.queriesRun}`);
  if (stats.directSourcesCrawled !== undefined) {
    lines.push(`- Fonti dirette (TSO/DSO/EPC) configurate: ${stats.directSourcesCrawled}, pagine crawlate: ${stats.directPagesFound}`);
  }
  lines.push("");

  if (relevantResults.length > 0) {
    lines.push(`## Opportunità identificate\n`);
    for (const r of relevantResults) {
      lines.push(`### [Score ${r.relevance_score}/10] ${r.title}`);
      lines.push(`- **Ente**: ${r.entity || "non identificato"}`);
      lines.push(`- **Paese/Area**: ${r.country || r.market}`);
      lines.push(`- **Motivazione**: ${r.reason}`);
      lines.push(`- **Link**: ${r.url}\n`);
    }
  }

  fs.writeFileSync(filePath, lines.join("\n"), "utf-8");
  return filePath;
}
