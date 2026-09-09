export const TOPIC_MIN_LENGTH = 5;
export const TOPIC_MAX_LENGTH = 120;
export const LEARNING_NOTES_MIN_LENGTH = 30;
export const LEARNING_NOTES_MAX_LENGTH = 4000;

export const CONTENT_TYPES = [
  "Project update",
  "Learning",
  "Technical insight",
  "Build in public",
] as const;

export const PRIMARY_AUDIENCES = [
  "Recruiters & hiring teams",
  "Developers & engineers",
  "Founders & product teams",
  "AI community",
] as const;

export type ContentType = (typeof CONTENT_TYPES)[number];
export type PrimaryAudience = (typeof PRIMARY_AUDIENCES)[number];

export interface SignalFormValues {
  topic: string;
  learningNotes: string;
  contentType: ContentType;
  primaryAudience: PrimaryAudience;
}

export interface SignalValidationErrors {
  topic?: string;
  learningNotes?: string;
  contentType?: string;
  primaryAudience?: string;
}

export function validateSignalForm(values: SignalFormValues): SignalValidationErrors {
  const errors: SignalValidationErrors = {};
  const topic = values.topic.trim();
  const learningNotes = values.learningNotes.trim();

  if (!topic) {
    errors.topic = "Add a topic or feature.";
  } else if (topic.length < TOPIC_MIN_LENGTH) {
    errors.topic = `Use at least ${TOPIC_MIN_LENGTH} characters.`;
  } else if (topic.length > TOPIC_MAX_LENGTH) {
    errors.topic = `Use no more than ${TOPIC_MAX_LENGTH} characters.`;
  }

  if (!learningNotes) {
    errors.learningNotes = "Add some learning notes.";
  } else if (learningNotes.length < LEARNING_NOTES_MIN_LENGTH) {
    errors.learningNotes = `Use at least ${LEARNING_NOTES_MIN_LENGTH} characters.`;
  } else if (learningNotes.length > LEARNING_NOTES_MAX_LENGTH) {
    errors.learningNotes = `Use no more than ${LEARNING_NOTES_MAX_LENGTH.toLocaleString()} characters.`;
  }

  if (!CONTENT_TYPES.includes(values.contentType)) {
    errors.contentType = "Choose a content type.";
  }

  if (!PRIMARY_AUDIENCES.includes(values.primaryAudience)) {
    errors.primaryAudience = "Choose a primary audience.";
  }

  return errors;
}
