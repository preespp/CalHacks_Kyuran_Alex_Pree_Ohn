export interface Member {
  id: string;
  name: string;
  household_id: string;
}
export interface Session {
  token: string;
  member: Member;
}
export type Profile = 'alex' | 'pree' | 'kyuran';
export interface Health {
  vision_provider: 'demo' | 'gemini';
  assistant_provider: 'disabled' | 'gemini' | 'muse';
  storage_provider: 'local';
  memory_provider: string;
  auth_mode: string;
  sync_mode: string;
  camera_frame_sink?: 'disabled' | 'spacetimedb';
}
export interface Observation {
  id: string;
  object_id: string;
  room: string;
  location: string;
  image_url: string | null;
  bbox: [number, number, number, number] | null;
  source: 'sample' | 'gemini' | 'reported';
  observed_at: string;
  kind: 'seen' | 'moved' | 'found' | 'correction';
  label?: string;
  actor_name?: string;
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
