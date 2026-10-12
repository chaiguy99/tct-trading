import {
  importedJournalTradeSchema,
  type ImportJournalTradeInput,
} from "./types";

const maxCsvBytes = 1_000_000;
const maxRows = 500;
const requiredColumns = ["instrument", "side", "quantity", "price"];
const supportedColumns = new Set([
  ...requiredColumns,
  "fee",
  "riskamount",
  "funding",
  "setup",
  "marketcondition",
  "thesis",
  "notes",
  "filledat",
  "exitquantity",
  "exitprice",
  "exitfee",
  "exitat",
]);

export type CsvImportIssue = { row: number; message: string };
export type CsvImportPreview = {
  trades: ImportJournalTradeInput[];
  issues: CsvImportIssue[];
  rowCount: number;
};

function parseRows(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let afterQuote = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (afterQuote && character !== "," && character !== "\n" && character !== "\r") {
      throw new Error("CSV has unexpected text after a quoted field.");
    }
    if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === '"') {
      throw new Error("CSV contains a quote inside an unquoted field.");
    } else if (character === ",") {
      row.push(field);
      field = "";
      afterQuote = false;
    } else if (character === "\n" || character === "\r") {
      row.push(field);
      field = "";
      afterQuote = false;
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
      if (character === "\r" && source[index + 1] === "\n") index += 1;
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error("CSV contains an unterminated quoted field.");
  row.push(field);
  if (row.some((value) => value.trim() !== "")) rows.push(row);
  return rows;
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function parseJournalCsv(source: string): CsvImportPreview {
  if (new TextEncoder().encode(source).byteLength > maxCsvBytes) {
    throw new Error("CSV file must be 1 MB or smaller.");
  }
  const rows = parseRows(source.replace(/^\uFEFF/, ""));
  if (rows.length < 2) {
    throw new Error("CSV must include a header and at least one trade row.");
  }

  const headers = rows[0].map((header) => header.trim().toLowerCase());
  const duplicate = headers.find((header, index) => headers.indexOf(header) !== index);
  if (duplicate) throw new Error(`CSV contains a duplicate "${duplicate}" column.`);
  const unknown = headers.find((header) => !supportedColumns.has(header));
  if (unknown) throw new Error(`CSV contains an unsupported "${unknown}" column.`);
  const missing = requiredColumns.filter((column) => !headers.includes(column));
  if (missing.length) {
    throw new Error(`CSV is missing required columns: ${missing.join(", ")}.`);
  }

  const trades: ImportJournalTradeInput[] = [];
  const issues: CsvImportIssue[] = [];
  const dataRows = rows.slice(1);
  if (dataRows.length > maxRows) {
    throw new Error(`CSV can contain at most ${maxRows} trade rows.`);
  }

  dataRows.forEach((values, index) => {
    const rowNumber = index + 2;
    if (values.length !== headers.length) {
      issues.push({ row: rowNumber, message: "Column count does not match the header." });
      return;
    }
    const record = Object.fromEntries(headers.map((header, column) => [header, values[column]]));
    const hasAnyExitData = ["exitquantity", "exitprice", "exitfee", "exitat"].some(
      (column) => Boolean(record[column]?.trim()),
    );
    const hasExitData = Boolean(
      record.exitquantity?.trim() && record.exitprice?.trim(),
    );
    const hasPartialExitData = hasAnyExitData && !hasExitData;
    if (hasPartialExitData) {
      issues.push({
        row: rowNumber,
        message: "An exit requires both exitQuantity and exitPrice.",
      });
      return;
    }
    const rawTrade = {
      instrument: record.instrument?.trim().toUpperCase(),
      side: record.side?.trim().toLowerCase(),
      mode: "journal",
      quantity: Number(record.quantity),
      price: Number(record.price),
      fee: parseOptionalNumber(record.fee),
      riskAmount: parseOptionalNumber(record.riskamount) ?? null,
      funding: parseOptionalNumber(record.funding),
      setup: record.setup ?? "",
      marketCondition: record.marketcondition ?? "",
      thesis: record.thesis ?? "",
      notes: record.notes ?? "",
      filledAt: record.filledat?.trim() || undefined,
      ...(hasExitData
        ? {
            exit: {
              quantity: Number(record.exitquantity),
              price: Number(record.exitprice),
              fee: parseOptionalNumber(record.exitfee) ?? 0,
              filledAt: record.exitat?.trim() || undefined,
            },
          }
        : {}),
    };
    const result = importedJournalTradeSchema.safeParse(rawTrade);
    if (!result.success) {
      issues.push({
        row: rowNumber,
        message: result.error.issues
          .map((issue) => `${issue.path.join(".") || "row"}: ${issue.message}`)
          .join(" "),
      });
      return;
    }
    trades.push(result.data);
  });

  return { trades, issues, rowCount: dataRows.length };
}
