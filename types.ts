
export enum AppMode {
  Chat = 'Chat',
  Analyze = 'Analyze',
  Generate = 'Generate',
}

export enum MessageRole {
  User = 'user',
  Model = 'model',
}

export interface ChatMessage {
  role: MessageRole;
  text: string;
}
