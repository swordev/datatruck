import { setTimeout } from "timers/promises";
import { Agent, fetch } from "undici";

export class Ntfy {
  protected agent: Agent | undefined;
  constructor(
    readonly options: {
      token?: string;
      titlePrefix?: string;
      delay?: number;
    },
  ) {
    this.agent = new Agent({
      keepAliveTimeout: 60_000,
      keepAliveMaxTimeout: 60_000,
      connections: 1,
    });
  }
  async send(
    inTitle: string,
    message: any[] | string | Record<string, any>,
    error?: Error | boolean,
  ) {
    const title = this.options.titlePrefix
      ? `${this.options.titlePrefix}${inTitle}`
      : inTitle;
    const body = Array.isArray(message)
      ? message
          .filter((v) => typeof v === "string" || typeof v === "number")
          .join("\n")
      : typeof message === "object" && !!message
        ? Object.entries(message)
            .filter(([, value]) => value !== undefined)
            .map(([name, value]) => `${name}: ${value}`)
            .join("\n")
        : message;

    const lines = [title, body].filter((v) => v.length);

    if (lines.length) console.info([...lines, ""].join("\n"));

    const options = {
      priority: error ? "high" : "default",
      tags: [error ? "red_circle" : "green_circle"],
    };
    try {
      if (this.options.token)
        await fetch(`https://ntfy.sh/${this.options.token}`, {
          dispatcher: this.agent,
          method: "POST",
          body,
          headers: {
            Markdown: "yes",
            Title: title,
            Priority: options.priority ?? "default",
            ...(options.tags && {
              Tags: options.tags?.join(","),
            }),
          },
        });
      await setTimeout(this.options.delay ?? 800);
    } catch (error) {
      console.error("Ntfy error", error);
    }
  }
}
