import { GoogleGenAI, Type, Modality } from "@google/genai";
import type { VideoFrame, Transcription } from '../types';

const FRAME_EXTRACTION_INTERVAL = 2; // seconds

const extractFramesFromVideo = (
  videoFile: File,
  onProgress: (progress: number) => void
): Promise<VideoFrame[]> => {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    const frames: VideoFrame[] = [];

    if (!context) {
      return reject(new Error('Canvas context is not available.'));
    }

    // Reverted to 'metadata' for better performance and lower resource usage,
    // as 'auto' did not provide sufficient accuracy improvements.
    video.preload = 'metadata';
    video.src = URL.createObjectURL(videoFile);

    video.onloadedmetadata = () => {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const duration = video.duration;
      let currentTime = 0;

      const captureFrame = () => {
        if (currentTime > duration) {
          URL.revokeObjectURL(video.src);
          resolve(frames);
          return;
        }

        video.currentTime = currentTime;
      };

      video.onseeked = () => {
        context.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
        const imageData = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
        // Use the video's actual current time after seeking for better accuracy
        frames.push({ timestamp: Math.round(video.currentTime), imageData });
        
        const progress = Math.min(100, Math.round((currentTime / duration) * 100));
        onProgress(progress);
        
        currentTime += FRAME_EXTRACTION_INTERVAL;
        captureFrame();
      };
      
      video.onerror = (e) => {
        URL.revokeObjectURL(video.src);
        reject(new Error('Error processing video file.'));
      }

      captureFrame();
    };
  });
};

const formatTimestamp = (totalSeconds: number): string => {
    const flooredSeconds = Math.floor(totalSeconds);
    const minutes = Math.floor(flooredSeconds / 60);
    const seconds = flooredSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

export const analyzeVideoForText = async (
    videoFile: File,
    onProgress: (message: string, progress?: number) => void
): Promise<Transcription[]> => {
    onProgress('Extracting frames from video...', 0);
    const frames = await extractFramesFromVideo(videoFile, (progress) => {
        onProgress('Extracting frames from video...', progress);
    });

    if (frames.length === 0) {
        throw new Error('Could not extract any frames from the video.');
    }

    onProgress('Analyzing frames with Gemini...', undefined);
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });

    const prompt = `Your task is to extract text from a sequence of video frames.
- Focus ONLY on the text visible in the images. Ignore any audio.
- Transcribe the text exactly as it appears, in its original language. Do not translate it.
- Do not perform any analysis, summarization, or interpretation of the text. Provide only the raw, original text.
- Absolutely do not include the term "NotebookLM" anywhere in your response.
- Your output MUST be a valid JSON array of objects. Each object must have two keys: "timestamp" (an integer representing the time in seconds of the frame) and "text" (a string of the extracted text).
- If no text is found in a frame, do not include an entry for that frame.
- If the exact same text appears in consecutive frames, only include it for the first frame where it appears.
Here are the frames:`;

    const imageParts = frames.map(frame => ({
        inlineData: {
            mimeType: 'image/jpeg',
            data: frame.imageData,
        },
    }));

    const textPart = { text: prompt };

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-pro',
        contents: { parts: [textPart, ...imageParts] },
        config: {
            responseMimeType: 'application/json',
            responseSchema: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        timestamp: { type: Type.INTEGER },
                        text: { type: Type.STRING },
                    },
                    required: ['timestamp', 'text'],
                }
            }
        }
    });

    onProgress('Processing results...', undefined);

    const jsonText = response.text.trim();
    const rawResults: { timestamp: number, text: string }[] = JSON.parse(jsonText);

    const formattedResults: Transcription[] = rawResults.map(result => ({
        timestamp: formatTimestamp(result.timestamp),
        text: result.text
    }));

    return formattedResults;
};

export const processFrameForTextExtraction = async (base64FrameData: string): Promise<string> => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });

    const imagePart = {
        inlineData: {
            mimeType: 'image/jpeg',
            data: base64FrameData,
        },
    };
    
    const textPart = {
        text: `From this image, extract ONLY text and numbers.
- Render the extracted text and numbers in white color. The text must be sharp and clear, not blurry.
- Place them on a solid, uniform green background.
- Remove ALL other visual elements, including the original background, logos, UI elements, etc.
- Specifically ensure the term "NotebookLM" is removed if present.
- The final output image must ONLY contain the white text/numbers on the solid green background.`
    };

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
            parts: [imagePart, textPart],
        },
        config: {
            responseModalities: [Modality.IMAGE],
        },
    });

    // Safely access the response to prevent crashes on blocked content
    if (response.candidates && response.candidates.length > 0 && response.candidates[0].content && response.candidates[0].content.parts) {
      for (const part of response.candidates[0].content.parts) {
          if (part.inlineData && part.inlineData.mimeType.startsWith('image/')) {
              return part.inlineData.data;
          }
      }
    }

    throw new Error("Could not find generated image in the API response. The request may have been blocked due to safety policies.");
};

export const editImage = async (
    base64ImageData: string,
    mimeType: string,
    prompt: string
): Promise<string> => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });

    const imagePart = {
        inlineData: {
            mimeType,
            data: base64ImageData,
        },
    };

    const textPart = {
        text: prompt,
    };

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
            parts: [imagePart, textPart],
        },
        config: {
            responseModalities: [Modality.IMAGE],
        },
    });

    // Safely access the response to prevent crashes on blocked content
    if (response.candidates && response.candidates.length > 0 && response.candidates[0].content && response.candidates[0].content.parts) {
      for (const part of response.candidates[0].content.parts) {
          if (part.inlineData && part.inlineData.mimeType.startsWith('image/')) {
              return part.inlineData.data;
          }
      }
    }

    throw new Error("Could not find edited image in the API response. The request may have been blocked due to safety policies.");
};