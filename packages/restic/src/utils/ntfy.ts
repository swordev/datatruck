import { unstyle } from "./string.js";
import { setTimeout } from "timers/promises";
import { Agent, fetch } from "undici";
import { styleText } from "util";

interface MessageObject {
  [key: string]:
    | string
    | number
    | undefined
    | ({ key: string; value: string | number; level?: number } | false)[];
}

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

  private formatTitle(title: string) {
    const text = styleText("cyan", title);
    const prefix = this.options.titlePrefix;
    return prefix ? `[${styleText("magenta", prefix)}] ${text}` : text;
  }

  private formatMessage(name: string, value: string, level = 0) {
    const pad = "  ".repeat(level);
    return `${pad}- ${name}: ${styleText("gray", value!.toString())}`;
  }

  private formatMessageObject(object: MessageObject, level = 0) {
    return Object.entries(object)
      .filter(([, value]) => value !== undefined)
      .map(([name, value]) => {
        if (Array.isArray(value)) {
          return value
            .filter((item) => item !== false)
            .map((item) =>
              this.formatMessage(item.key, item.value.toString(), item.level),
            )
            .join("\n");
        } else {
          return this.formatMessage(name, value!.toString(), level);
        }
      })
      .join("\n");
  }

  async send(inTitle: string, message: MessageObject, error?: Error | boolean) {
    const title = this.formatTitle(inTitle);
    const body = this.formatMessageObject(message);
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
          body: unstyle(body),
          headers: {
            Markdown: "yes",
            Title: unstyle(title),
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
