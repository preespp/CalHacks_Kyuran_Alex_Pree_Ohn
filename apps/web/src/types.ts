export type Profile = 'alex' | 'pree' | 'kyuran';
export interface Member {
  id: Profile;
  name: string;
  household_id: string;
}
export interface Session {
  token: string;
  member: Member;
}
export interface Health {
  vision_provider: 'demo' | 'gemini';
  assistant_provider: 'disabled' | 'gemini' | 'muse';
  storage_provider: 'local' | 'azure';
  memory_provider: string;
  auth_mode: string;
  sync_mode: string;
}
export interface Observation {
  id: string;
  object_id: string;
  room: string;
  location: string;
  image_url: string | null;
  bbox: [number, number, number, number] | null;
  source: 'sample' | 'gemini' | 'reported';
  actor_name: string;
  observed_at: string;
  kind: 'seen' | 'moved' | 'found' | 'correction';
  label?: string;
}
export interface MemoryObject {
  id: string;
  label: string;
  appearance: string;
  aliases: string[];
  latest: Observation;
  last_visual: Observation | null;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}
export interface ChatResponse {
  provider: 'gemini' | 'muse';
  answer: string;
  query: string;
  matches: MemoryObject[];
  total_matches: number;
  needs_disambiguation: boolean;
}

export interface PlainChatResponse {
  provider: 'muse';
  answer: string;
}
