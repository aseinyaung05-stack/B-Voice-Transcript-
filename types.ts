
export interface TranscriptionSegment {
  id: string;
  text: string;
  timestamp: number;
  type: 'user' | 'model';
}

export enum AppState {
  IDLE = 'IDLE',
  CONNECTING = 'CONNECTING',
  LISTENING = 'LISTENING',
  ERROR = 'ERROR'
}
