import type { PublicCalendarItem } from "@/lib/api/calendar-client";

const PROD_ID = "-//DevSignal AI//Calendar Reminder//EN";
const UID_SUFFIX = "@devsignal-ai.local";

function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function formatUtc(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("The calendar item has an invalid scheduled date.");
  }
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function foldLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let byteLimit = 75;
  let byteLength = 0;

  for (const character of line) {
    const characterLength = new TextEncoder().encode(character).length;
    if (byteLength > 0 && byteLength + characterLength > byteLimit) {
      result.push(result.length === 0 ? current : ` ${current}`);
      current = "";
      byteLength = 0;
      byteLimit = 74;
    }
    current += character;
    byteLength += characterLength;
  }

  result.push(result.length === 0 ? current : ` ${current}`);
  return result;
}

function serialize(lines: string[]): string {
  return `${lines.flatMap(foldLine).join("\r\n")}\r\n`;
}

function sanitizeFilename(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

export function buildCalendarReminderIcs(
  item: PublicCalendarItem,
  exportedAt: Date = new Date(),
): string {
  const dtstamp = formatUtc(exportedAt);
  const dtstart = formatUtc(item.scheduledFor);
  const description = [
    "Saved draft:",
    "",
    item.content,
    "",
    "Publishing is manual; this calendar file does not publish automatically.",
  ].join("\n");

  return serialize([
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${escapeText(PROD_ID)}`,
    "BEGIN:VEVENT",
    `UID:${escapeText(`${item.id}${UID_SUFFIX}`)}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${dtstart}`,
    `SUMMARY:${escapeText(`Review and publish: ${item.topic}`)}`,
    `DESCRIPTION:${escapeText(description)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ]);
}

export function downloadCalendarReminder(
  item: PublicCalendarItem,
  exportedAt: Date = new Date(),
): void {
  const ics = buildCalendarReminderIcs(item, exportedAt);
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const topic = sanitizeFilename(item.topic);
  const filename = `${topic || "calendar-reminder"}.ics`;

  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(url);
  }
}
