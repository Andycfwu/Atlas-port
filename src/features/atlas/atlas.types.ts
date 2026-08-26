export type AtlasRole = 'user' | 'assistant';

export interface AtlasMessage {
  id: string;
  role: AtlasRole;
  content: string;
  createdAt: string;
}

export interface AtlasConversation {
  id: string;
  messages: AtlasMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface AtlasRequest {
  conversationId?: string;
  message: string;
}

export interface AtlasResponse {
  conversationId: string;
  message: AtlasMessage;
}
