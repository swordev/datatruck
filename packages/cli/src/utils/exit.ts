type EventNameType =
  | "exit"
  | "SIGINT"
  | "SIGUSR1"
  | "SIGUSR2"
  | "SIGTERM"
  | "uncaughtException";

const eventNames: EventNameType[] = [
  `exit`,
  `SIGINT`,
  `SIGUSR1`,
  `SIGUSR2`,
  `uncaughtException`,
  `SIGTERM`,
];

type ExitListener = {
  cb: (...args: any) => any;
  priority: number;
};

const listeners = new Set<ExitListener>();
const disableExitDisposes = new Set<() => any>();

export function triggerExitEvent(eventName: EventNameType, ...args: any[]) {
  if (!disableExitDisposes.size) {
    process.emit(eventName as any, ...args);
    return;
  }
  try {
    disableExitEvents();
    const items = [...listeners].sort((a, b) => b.priority - a.priority);
    for (const { cb } of items) {
      try {
        cb(eventName, ...args);
      } catch (_) {}
    }
  } catch (_) {
    process.exit(5);
  }
}

export function enableExitEvents() {
  disableExitEvents();
  for (const eventName of eventNames) {
    const listener = (...args: any[]) => triggerExitEvent(eventName, ...args);
    process.on(eventName, listener);
    disableExitDisposes.add(() => process.off(eventName, listener));
  }
}

export function disableExitEvents() {
  for (const dispose of disableExitDisposes) dispose();
  disableExitDisposes.clear();
}

export function onExit(
  cb: (eventName: EventNameType, ...args: any[]) => void,
  priority?: number,
) {
  if (!disableExitDisposes.size) enableExitEvents();
  const listener: ExitListener = { cb, priority: priority ?? 0 };
  listeners.add(listener);
  return () => listeners.delete(listener);
}
