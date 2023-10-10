import { AppError } from "../Error/AppError";
import TtyTable, { Header } from "tty-table";
import { formatWithOptions } from "util";

export type FormatType = "json" | "pjson" | "table" | "yaml" | "custom" | "tpl";

const customPrefix = "custom=";
const tplPrefix = "tpl=";

export class DataFormat {
  constructor(
    readonly options: {
      json: any;
      table?: {
        headers: Header[];
        rows: () => (string | number | null | undefined)[][];
      };
    },
  ) {}

  protected getJson() {
    return this.options.json;
  }
  protected formatToJson() {
    return JSON.stringify(this.getJson());
  }

  protected formatToPrettyJson() {
    return formatWithOptions(
      {
        depth: Infinity,
        colors: true,
        maxArrayLength: Infinity,
        maxStringLength: Infinity,
        breakLength: Infinity,
        compact: false,
      },
      this.getJson(),
    );
  }

  protected formatToYaml() {
    return require("yaml").stringify(this.getJson());
  }

  protected formatToTable() {
    if (!this.options.table) throw new Error(`Table format incompatible`);
    const table = TtyTable(
      this.options.table.headers,
      this.options.table.rows(),
      {},
    );
    return table.render();
  }

  format(
    format: FormatType,
    options?: {
      tpl?: Record<string, () => string>;
    },
  ) {
    if (format === "table") {
      return this.formatToTable();
    } else if (format === "json") {
      return this.formatToJson();
    } else if (format === "pjson") {
      return this.formatToPrettyJson();
    } else if (format === "yaml") {
      return this.formatToYaml();
    } else if (format.startsWith(customPrefix)) {
      const code = format.slice(customPrefix.length);
      return runCustomCode(this.getJson(), code);
    } else if (format.startsWith(tplPrefix)) {
      const name = format.slice(tplPrefix.length);
      const tpl = options?.tpl || {};
      if (!(name in tpl)) {
        const tplNames = Object.keys(tpl).join(", ");
        throw new AppError(
          `Template name not found: ${name} (valid names: ${tplNames})`,
        );
      }
      return tpl[name]();
    } else {
      throw new AppError(`Invalid output format: ${format}`);
    }
  }
}

function runCustomCode($: Record<string, unknown>[], __code: string) {
  return eval(__code);
}
