export type SheetRow = Record<string, string | number | boolean | null | undefined>;

export function normalizeHeader(value: string) {
  return value
    .toLowerCase()
    .replace(/\uFEFF/g, "")
    .replace(/[\s()[\]_\-:：,，.。/\\（）]/g, "");
}

export function readColumn(row: SheetRow, candidates: string[]) {
  const entries = Object.entries(row).filter(([key]) => !key.startsWith("__"));
  const normalizedEntries = entries.map(([key, value]) => [normalizeHeader(key), value] as const);

  for (const candidate of candidates.map(normalizeHeader)) {
    const exactEntry = normalizedEntries.find(([key]) => key === candidate);

    if (exactEntry) {
      const value = exactEntry[1];
      return value === null || value === undefined ? "" : String(value).trim();
    }
  }

  for (const candidate of candidates.map(normalizeHeader)) {
    const fuzzyEntry = normalizedEntries.find(([key]) => key.includes(candidate) || candidate.includes(key));

    if (fuzzyEntry) {
      const value = fuzzyEntry[1];
      return value === null || value === undefined ? "" : String(value).trim();
    }
  }

  return "";
}

export function readNumber(row: SheetRow, candidates: string[]) {
  const value = readColumn(row, candidates).replace(/[$,%￥,]/g, "");
  const numericValue = Number(value);

  return Number.isFinite(numericValue) ? numericValue : 0;
}

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"' && quoted && nextChar === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  cells.push(current);
  return cells.map((cell) => cell.trim());
}

export function parseCsv(text: string): SheetRow[] {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "");
  const headers = parseCsvLine(lines[0] ?? "");

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);

    return headers.reduce<SheetRow>((row, header, index) => {
      row[header] = values[index] ?? "";
      return row;
    }, {});
  });
}
