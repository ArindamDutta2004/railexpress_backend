const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');

async function main() {
  const inputPdf =
    process.argv[2] ||
    'C:/Users/HP/AppData/Roaming/Cursor/User/workspaceStorage/f837c4eebe3bfc7c99eb172433f38308/pdfs/92b1e54c-e5e8-4b04-8d84-4cbe69d48a2b/Station_code.pdf';

  const outFile =
    process.argv[3] ||
    path.join(__dirname, '..', 'src', 'data', 'stations.json');

  const parser = new PDFParse({ data: fs.readFileSync(inputPdf) });
  const data = await parser.getText();
  const text = data.text || '';

  const stations = [];
  const seen = new Set();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    if (!line) continue;

    // Pattern: STATION NAME [spaces/tab] CODE
    const match = line.match(/^(.+?)\s+([A-Za-z0-9]{2,6})$/);
    if (!match) continue;

    const name = match[1].trim().toUpperCase();
    const code = match[2].trim().toUpperCase();

    // Skip obvious headers/page markers.
    if (
      name.includes('STATION CODE INDEX') ||
      name === 'TAG-13' ||
      /^\d+$/.test(name)
    ) {
      continue;
    }

    const key = `${code}|${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    stations.push({ code, name, label: `${code} - ${name}` });
  }

  stations.sort((a, b) => a.label.localeCompare(b.label));
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(stations, null, 2), 'utf8');

  console.log(`Extracted stations: ${stations.length}`);
  console.log(`Written to: ${outFile}`);
}

main().catch((err) => {
  console.error('Failed to extract stations', err);
  process.exit(1);
});

