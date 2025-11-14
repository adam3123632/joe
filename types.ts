export enum AppMode {
  Chat = 'Chat',
  Analyze = 'Analyze',
  Generate = 'Generate',
  AnalyzeVideo = 'Analyze Video',
}

export enum MessageRole {
  User = 'user',
  Model = 'model',
}

export interface ImageFile {
  base64: string;
  mimeType: string;
  name: string;
  width: number;
  height: number;
}

export interface ReferenceImage {
  id: string;
  file: ImageFile;
  tag: string;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  text: string;
  videoUrl?: string;
  imageUrl?: string;
  referenceImages?: ReferenceImage[];
}
