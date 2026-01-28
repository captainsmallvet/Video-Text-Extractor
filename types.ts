
export interface VideoFrame {
  timestamp: number;
  imageData: string; // base64 encoded image
}

export interface Transcription {
  timestamp: string; // Formatted as mm:ss
  text: string;
}

export type AppStatus = 'idle' | 'processing' | 'success' | 'error';
