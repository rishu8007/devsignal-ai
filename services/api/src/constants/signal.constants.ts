export const SIGNAL_TOPIC_MIN_LENGTH = 5;
export const SIGNAL_TOPIC_MAX_LENGTH = 120;
export const SIGNAL_NOTES_MIN_LENGTH = 30;
export const SIGNAL_NOTES_MAX_LENGTH = 4000;

export const SIGNAL_PRIMARY_AUDIENCES = [
  "Recruiters & hiring teams",
  "Developers & engineers",
  "Founders & product teams",
  "AI community",
] as const;

export const SIGNAL_CONTENT_TYPES = [
  "Project update",
  "Learning",
  "Technical insight",
  "Build in public",
] as const;

export type SignalPrimaryAudience = (typeof SIGNAL_PRIMARY_AUDIENCES)[number];
export type SignalContentType = (typeof SIGNAL_CONTENT_TYPES)[number];
