import { AppError } from "../Error/AppError";
import {
  clearCommand,
  hideCursorCommand,
  logVars,
  renderProgressBar,
  renderSpinner,
  showCursorCommand,
  truncate,
} from "../utils/cli";
import { createChron } from "../utils/date";
import { Progress, ProgressStats } from "../utils/progress";
import {
  ActionEnum,
  WriteDataType,
  EntityEnum,
  ReadResultType,
  SessionDriverAbstract,
  SessionDriverOptions,
} from "./SessionDriverAbstract";
import bytes from "bytes";
import { cyan, white, red, grey, green } from "chalk";

type BadgeType = {
  name: string;
  value: string;
  color: (input: string) => string;
};

type MessageType = {
  sessionId: number;
  level?: number;
  textPrefix?: string;
  text?: string;
  badges: BadgeType[];
  errorBadge?: BadgeType;
  progress?: Progress;
};

const sep = grey(`|`);

const renderBadge = (badge: BadgeType) =>
  `${badge.color(badge.name)}${grey(`:`)} ${white(badge.value)}`;

const renderBadges = (badges: BadgeType[]) =>
  badges.map(renderBadge).join(` ${sep} `);

type ConsoleSessionDriverOptions = SessionDriverOptions & {
  progress?: "auto" | "tty" | "plain";
};

export class ConsoleSessionDriver extends SessionDriverAbstract<ConsoleSessionDriverOptions> {
  protected lastMessage: MessageType | undefined;
  protected lastMessageText: string | undefined;
  protected prints = 0;
  protected renderInterval!: NodeJS.Timeout;
  protected rendering?: boolean;
  protected lastColumns?: number;
  protected startTime!: number;
  protected chron = createChron();
  protected tty!: boolean;

  override async onInit() {
    this.tty = this.options.verbose
      ? false
      : this.options.progress === "auto"
      ? process.stdout.isTTY
      : this.options.progress === "tty";
    this.chron.start();
    this.renderInterval = setInterval(() => {
      if (this.lastMessage) this.printMessage(this.lastMessage, false);
    }, 100);
  }

  override async onEnd(data?: Record<string, any>) {
    clearInterval(this.renderInterval);
    if (this.tty) process.stdout.write(showCursorCommand);
    logVars({
      ...data,
      elapsed: this.chron.elapsed(true),
    });
  }

  override async onRead(): Promise<ReadResultType[]> {
    throw new AppError("Method not implemented");
  }

  protected printMessage(message: MessageType, endMessage: boolean) {
    const text = this.renderMessage(message);
    if (!this.tty && this.lastMessageText === text) {
      return;
    }
    if (!this.tty) {
      process.stdout.write(`${this.renderSpinner(text)}\n`);
    } else {
      const columns = process.stdout.columns;
      const line = this.renderSpinner(text);
      const [truncatedLine, truncated] = endMessage
        ? [line, false]
        : truncate(line, columns);

      if (this.lastColumns && columns !== this.lastColumns && truncated)
        process.stdout.write(`${clearCommand}\n`);
      process.stdout.write(
        `${clearCommand}${truncatedLine}${hideCursorCommand}`,
      );
      this.lastColumns = columns;
    }
    this.prints++;
    this.lastMessage = message;
    this.lastMessageText = text;
  }

  protected renderSpinner(text: string) {
    return text.replace(
      "{spinner}",
      grey(this.tty ? renderSpinner(this.prints) : "?"),
    );
  }

  protected renderMessage(message: MessageType) {
    const badges = renderBadges([
      ...message.badges,
      ...(message.errorBadge ? [message.errorBadge] : []),
    ]);

    const padding = "   ".repeat(message.level ?? 0);
    const sessionId = message.sessionId.toString().padStart(2, "0");
    let parts = [
      `${padding}${message.textPrefix} [${grey(sessionId)}] ${message.text}`,
      badges,
    ];

    const progress = message.progress;
    const absolute = progress?.absolute || {};
    const relative = progress?.relative || {};

    if (
      typeof absolute.percent === "number" ||
      typeof relative.percent === "number"
    ) {
      parts.push(
        renderProgressBar(
          absolute.percent ?? 0,
          10,
          relative.percent ?? undefined,
        ),
      );
    }

    const createProgressParts = (p: ProgressStats) => {
      const result: string[] = [];
      if (typeof p.percent === "number")
        result.push(`${p.percent.toFixed(2)}%`);
      if (typeof p.current === "number" || typeof p.total === "number") {
        const format = (value: number) =>
          p.format === "size" ? bytes(value) : value;
        if (typeof p.current === "number" && typeof p.total === "number") {
          result.push(`${format(p.current)}/${format(p.total)}`);
        } else if (typeof p.current === "number") {
          result.push(`${format(p.current)}`);
        } else if (typeof p.total === "number") {
          result.push(`?/${format(p.total)}`);
        }
      }
      if (p.description && p.payload) {
        result.push(`${p.description}: ${p.payload}`);
      } else if (p.description) {
        result.push(p.description);
      } else if (p.payload) {
        result.push(p.payload);
      }
      return result;
    };

    if (progress?.absolute)
      parts.push(...createProgressParts(progress?.absolute));
    if (progress?.relative) {
      const relativeParts = createProgressParts(progress?.relative);
      if (relativeParts.length) {
        return (
          parts.join(` ${sep} `) +
          `  ${cyan("▷")}  ` +
          relativeParts.join(` ${sep} `)
        );
      }
    }

    return parts.join(` ${sep} `);
  }

  override async onWrite(data: WriteDataType) {
    if (data.action === ActionEnum.Init) return;

    const message: MessageType = {
      sessionId: "sessionId" in data.data ? data.data.sessionId : data.data.id,
      badges: [],
    };

    const isHeader =
      data.entity === EntityEnum.BackupSession ||
      data.entity === EntityEnum.RestoreSession;

    const hasProgress =
      isHeader ||
      data.entity === EntityEnum.BackupSessionTask ||
      data.entity === EntityEnum.BackupSessionRepository ||
      data.entity === EntityEnum.RestoreSessionTask ||
      data.entity === EntityEnum.RestoreSessionRepository;

    if (data.action === ActionEnum.Start) {
      if (isHeader) {
        message.textPrefix = data.data.error ? red("⨉") : green("✓");
      } else {
        message.textPrefix = hasProgress ? "{spinner}" : grey("?");
      }
    } else if (data.action === ActionEnum.End) {
      message.textPrefix = data.data.error ? red("⨉") : green("✓");
      if (data.data.error)
        message.errorBadge = {
          name: "error",
          value:
            this.tty && data.data.error.startsWith(`${AppError.name} :`)
              ? data.data.error.split("\n")[0]
              : data.data.error,
          color: red,
        };
    } else if (data.action === ActionEnum.Progress) {
      message.textPrefix = "{spinner}";
    }

    if (hasProgress) {
      message.progress = data.data.progress;
    }

    if (
      data.entity === EntityEnum.BackupSession ||
      data.entity === EntityEnum.RestoreSession
    ) {
      message.text = data.data.packageName;
      message.badges.push({
        name: "snap",
        value: data.data.snapshotId.slice(0, 8),
        color: cyan,
      });
    } else if (
      data.entity === EntityEnum.BackupSessionTask ||
      data.entity === EntityEnum.RestoreSessionTask
    ) {
      message.text = data.sessionData.packageName;
      message.badges.push({
        name: "task",
        value: data.data.taskName,
        color: cyan,
      });
    } else if (
      data.entity === EntityEnum.BackupSessionRepository ||
      data.entity === EntityEnum.RestoreSessionRepository
    ) {
      message.text = data.sessionData.packageName;
      message.badges.push({
        name: "repo",
        value: data.data.repositoryName,
        color: cyan,
      });
    }

    if (isHeader && data.action === ActionEnum.End) {
      return;
    }

    const endMessage =
      this.tty && (!hasProgress || data.action === ActionEnum.End || isHeader);

    this.printMessage(message, endMessage);

    if (endMessage) process.stdout.write("\n");
  }
}
