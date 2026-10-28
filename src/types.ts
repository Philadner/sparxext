export type ExtensionApi = typeof browser;

export type AnswerSource = "react" | "dom" | "pending" | "mixed";

export interface CaptureAnswer {
  id: string;
  value: string;
  kind: "number" | "text" | "choice" | "card" | "image" | "unknown";
}

export interface CaptureResult {
  code: string;
  questionId: string;
  questionText: string;
  answers: CaptureAnswer[];
  selectedAnswer: string;
  selectedAnswerHtml: string;
  answerPageHtml: string;
  source: AnswerSource;
}

export interface HistoryEntry {
  code: string;
  questionId?: string;
  questionText?: string;
  answers?: CaptureAnswer[];
  answerSource?: AnswerSource;
  selectedAnswer: string;
  selectedAnswerHtml: string;
  answerPageHtml: string;
  pageTitle: string;
  url: string;
  questionContext: string;
  detectedAt: string;
}

export interface Settings {
  themeEnabled?: boolean;
  aiProvider?: "gauth" | "chatgpt" | "claude";
}
