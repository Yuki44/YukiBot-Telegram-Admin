type Level = "INFO" | "WARN" | "ERROR";

interface LogFields {
  action: string;
  userId?: number;
  username?: string;
  chatId?: number;
  [key: string]: unknown;
}

function log(level: Level, fields: LogFields): void {
  const entry = { ts: new Date().toISOString(), level, ...fields };
  if (level === "ERROR") {
    console.error(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

export const logger = {
  info: (fields: LogFields) => log("INFO", fields),
  warn: (fields: LogFields) => log("WARN", fields),
  error: (fields: LogFields) => log("ERROR", fields),
};
