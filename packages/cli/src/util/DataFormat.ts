import Table from "cli-table3";
import { formatWithOptions } from "util";

export type FormatType = "json" | "pjson" | "table" | "yaml";

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
        colors: true,
        depth: Infinity,
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

  format(format: FormatType) {
    if (format === "table") {
      return this.formatToTable();
    } else if (format === "json") {
      return this.formatToJson();
    } else if (format === "pjson") {
      return this.formatToPrettyJson();
    } else if (format === "yaml") {
      return this.formatToYaml();
    }
  }
}
