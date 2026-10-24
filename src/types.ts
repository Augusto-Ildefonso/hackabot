export type FilterField = 'organizer' | 'theme' | 'location';
export type FilterMode = 'allow' | 'block';

export interface Filter {
  field: FilterField;
  value: string;
  mode: FilterMode;
}

export interface Hackathon {
  id: number;
  title: string;
  url: string;
  organizer: string;
  themes: string[];
  location: string;
  prize: string;
  dates: string;
  timeLeft: string;
  inviteOnly: boolean;
}

export interface QueueMessage {
  chatId: number;
  text: string;
}

export interface Env {
  DB: D1Database;
  MESSAGES: Queue<QueueMessage>;
  BOT_TOKEN: string;
  WEBHOOK_SECRET: string;
  ADMIN_CHAT_ID?: string;
}
