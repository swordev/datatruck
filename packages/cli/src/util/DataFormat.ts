import { AppError } from "../Error/AppError";
import Table from "cli-table3";
import { formatWithOptions } from "util";

export type FormatType = "json" | "pjson" | "table" | "yaml" | "custom" | "tpl";

const customPrefix = "custom=";
const tplPrefix = "tpl=";

export class DataFormat<TItem extends Record<string, unknown>> {
  constructor(
    readonly options: {
      items: TItem[];
      json?: (item: TItem) => any;
      table: {
        labels: string[];
        handler: (item: TItem) => (string | number | null | undefined)[];
      };
    }
  ) {}

  protected formatToJson() {
    return JSON.stringify(
      this.options.json
        ? this.options.items.map(this.options.json)
        : this.options.items
    );
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
      this.options.items
    );
  }

  protected formatToYaml() {
    return require("yaml").stringify(this.options.items);
  }

  protected formatToTable() {
    const table = new Table({
      head: this.options.table.labels,
    });
    for (const item of this.options.items)
      table.push(this.options.table.handler(item));
    return table.toString();
  }

  format(
    format: FormatType,
    options?: {
      tpl?: Record<string, () => string>;
    }
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
      return runCustomCode(this.options.items, code);
    } else if (format.startsWith(tplPrefix)) {
      const name = format.slice(tplPrefix.length);
      const tpl = options?.tpl || {};
      if (!(name in tpl)) {
        const tplNames = Object.keys(tpl).join(", ");
        throw new AppError(
          `Template name not found: ${name} (valid names: ${tplNames})`
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
