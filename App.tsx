
import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import type { Transcription, AppStatus } from './types';
import { UploadIcon, VideoIcon, SparklesIcon, CopyIcon, SaveIcon, RewindIcon, ForwardIcon, ChevronsLeftIcon, ChevronsRightIcon, CameraIcon, DocumentTextIcon, PencilIcon, SpinnerIcon, FolderOpenIcon } from './components/icons';
import { analyzeVideoForText, processFrameForTextExtraction, editImage } from './services/videoAnalyzer';

const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64String = (reader.result as string).split(',')[1];
            resolve(base64String);
        };
        reader.onerror = (error) => reject(error);
        reader.readAsDataURL(blob);
    });
};

const QUICK_EDIT_PROMPTS = {
    BG1: "From the provided image, extract only the text and numbers, preserving their original colors and positions. Place them on a solid, uniform background with the color rgb(139, 195, 74). If any text or numbers are inside a box, make the background of that box also rgb(139, 195, 74). The final output should contain only the text, numbers, and the new background. Ensure all text and numbers are sharp and clear.",
    BG2: "From the provided image, extract only the text and numbers. Render them in sharp, clear white color. Place them on a solid, uniform background with the color rgb(139, 195, 74). If any text or numbers are inside a box, they must remain within their original boxes. The final output must contain only the white text/numbers and this background.",
    BG3: "From the provided image, extract only the text and numbers. Render them in sharp, clear white color. Place them on a solid, uniform green background. If any text or numbers are inside a box, they must remain within their original boxes. The final output must contain only the white text/numbers and this background.",
    LOGO: "Remove all logos and the specific text 'NotebookLM' from the image. The rest of the image should remain unchanged.",
    TEXT_COLOR: "Change the color of all text and numbers in the image to white. Ensure they are sharp and clear, not blurry. Do not alter any other part of the image.",
    OUTLINE: "Change all text and numbers in the image to be white with a black outline. Ensure they are sharp, clear, and easy to read. Do not alter any other part of the image.",
    DEL_PIC: "Remove all pictorial elements from the image, leaving only text, numbers, and the original background. The text and numbers should retain their original colors and positions."
};

const REWRITE_SIZES = [80, 90, 100, 110, 120, 130, 140, 150, 175, 200];

const App: React.FC = () => {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [externalImageFile, setExternalImageFile] = useState<File | null>(null);
  const [videoDuration, setVideoDuration] = useState<number | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [capturedFrameUrl, setCapturedFrameUrl] = useState<string | null>(null);
  const [editedFrameUrl, setEditedFrameUrl] = useState<string | null>(null);
  const [videoCurrentTime, setVideoCurrentTime] = useState<number>(0);
  const [capturedTime, setCapturedTime] = useState<number>(0);
  const [status, setStatus] = useState<AppStatus>('idle');
  const [transcriptions, setTranscriptions] = useState<Transcription[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ message: string, percentage?: number }>({ message: '' });
  const [copyButtonText, setCopyButtonText] = useState('Copy');
  const [editableText, setEditableText] = useState('');
  const [isCapturing, setIsCapturing] = useState(false);
  const [isCapturingFrame, setIsCapturingFrame] = useState(false);
  const [isReWriting, setIsReWriting] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editPrompt, setEditPrompt] = useState('');
  const [quickEditLoadingKey, setQuickEditLoadingKey] = useState<string | null>(null);
  const [isImagePreviewVisible, setIsImagePreviewVisible] = useState(false);
  const [isReWritePopupOpen, setIsReWritePopupOpen] = useState(false);
  const [isReWritingFromPopup, setIsReWritingFromPopup] = useState(false);
  
  const [apiKeyInput, setApiKeyInput] = useState('');
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const textFileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const reWritePopupRef = useRef<HTMLDivElement>(null);

  // Initialize API Key from localStorage or process.env
  useEffect(() => {
    const storedKey = localStorage.getItem('user_api_key');
    const envKey = process.env.API_KEY;
    const initialKey = storedKey || (envKey && envKey !== 'undefined' ? envKey : 'no API key');
    
    setApiKeyInput(initialKey);
    
    // Set global API key if we have a stored one
    if (storedKey) {
        (process as any).env.API_KEY = storedKey;
    }
  }, []);

  const handleSendApiKey = () => {
    if (apiKeyInput && apiKeyInput !== 'no API key') {
      localStorage.setItem('user_api_key', apiKeyInput);
      (process as any).env.API_KEY = apiKeyInput;
      alert('API Key updated and saved to localStorage');
    }
  };

  const handleCopyApiKey = () => {
    navigator.clipboard.writeText(apiKeyInput).then(() => {
      alert('API Key copied to clipboard');
    });
  };

  const handleClearApiKey = () => {
    localStorage.removeItem('user_api_key');
    setApiKeyInput('no API key');
    (process as any).env.API_KEY = '';
  };

  useEffect(() => {
    // Cleanup the video object URL when the component unmounts or the video changes
    return () => {
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
      }
    };
  }, [videoUrl]);
  
  useEffect(() => {
    // Cleanup the captured frame object URL when it changes or the component unmounts
    return () => {
        if (capturedFrameUrl) {
            URL.revokeObjectURL(capturedFrameUrl);
        }
    }
  }, [capturedFrameUrl]);

  useEffect(() => {
    // Cleanup the edited frame object URL
    return () => {
        if (editedFrameUrl) {
            URL.revokeObjectURL(editedFrameUrl);
        }
    };
  }, [editedFrameUrl]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
        if (reWritePopupRef.current && !reWritePopupRef.current.contains(event.target as Node)) {
            setIsReWritePopupOpen(false);
        }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
        document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);


  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl); // Clean up previous URL
      }
      
      const newUrl = URL.createObjectURL(file);
      setVideoUrl(newUrl);
      setVideoFile(file);
      setStatus('idle');
      setTranscriptions([]);
      setError(null);
      setVideoDuration(null); // Reset duration while loading new one
      setVideoCurrentTime(0);
      setEditableText('');
      setCapturedFrameUrl(null); // Reset captured frame on new video load
      setEditedFrameUrl(null);
      setEditPrompt('');
      setExternalImageFile(null);
      setIsImagePreviewVisible(false);

      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        window.URL.revokeObjectURL(video.src);
        setVideoDuration(video.duration);
      };
      video.onerror = () => {
        setError("Could not read video metadata.");
        setVideoDuration(null);
      }
      video.src = URL.createObjectURL(file);
    }
  };

  const handleImageFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
        if (capturedFrameUrl) {
            URL.revokeObjectURL(capturedFrameUrl);
        }
        if (editedFrameUrl) {
            URL.revokeObjectURL(editedFrameUrl);
        }
        const newUrl = URL.createObjectURL(file);
        setCapturedFrameUrl(newUrl);
        setEditedFrameUrl(null);
        setCapturedTime(0);
        setExternalImageFile(file);
        setEditPrompt('');
        setIsImagePreviewVisible(true);
    }
  };

  const handleTextFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const text = e.target?.result as string;
            setEditableText(text);
        };
        reader.onerror = (e) => {
            console.error("Failed to read file", e);
            setError("Failed to read the selected text file.");
            setStatus('error');
        }
        reader.readAsText(file);
    }
  };

  const formatDuration = (totalSeconds: number | null): string => {
      if (totalSeconds === null || isNaN(totalSeconds)) return '00:00';
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = Math.floor(totalSeconds % 60);
      return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };

  const handleAnalyzeClick = useCallback(async () => {
    if (!videoFile) return;

    setStatus('processing');
    setError(null);
    setTranscriptions([]);
    setEditableText('');
    setProgress({ message: 'Starting analysis...' });
    
    try {
      const results = await analyzeVideoForText(videoFile, (message, percentage) => {
        setProgress({ message, percentage });
      });
      setTranscriptions(results);
      setStatus('success');
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'An unknown error occurred during analysis.');
      setStatus('error');
    }
  }, [videoFile]);
  
  const triggerFileSelect = () => fileInputRef.current?.click();
  const triggerImageFileSelect = () => imageInputRef.current?.click();
  const triggerTextFileSelect = () => textFileInputRef.current?.click();

  const formattedText = useMemo(() => {
    // Only generate the text output when the analysis has successfully completed.
    if (status !== 'success') {
      return '';
    }
    
    const transcriptionLines = transcriptions.map(item => `${item.timestamp} ${item.text}`).join('\n');
    const durationLine = `clip length ${formatDuration(videoDuration)}`;

    if (transcriptionLines) {
      return `${transcriptionLines}\n${durationLine}`;
    }
    
    // If there's no transcription, still show the clip length as a result.
    return durationLine;
  }, [transcriptions, status, videoDuration]);

  // This effect runs only when the analysis is complete to populate the editable text area.
  // It won't overwrite user edits during re-renders.
  useEffect(() => {
    if (status === 'success') {
      setEditableText(formattedText);
    }
  }, [formattedText, status]);

  const handleCopy = () => {
    if (editableText) {
        navigator.clipboard.writeText(editableText).then(() => {
            setCopyButtonText('Copied!');
            setTimeout(() => setCopyButtonText('Copy'), 2000);
        });
    }
  };

  const handleSave = () => {
      if (!videoFile || !editableText) return;
      const blob = new Blob([editableText], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const baseName = videoFile.name.replace(/\.[^/.]+$/, "");
      const durationStringForFileName = formatDuration(videoDuration).replace(':', '_');
      const fileName = `video script with timestamp - ${baseName} - ${durationStringForFileName}.txt`;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
  };

  const handleSeek = (offset: number) => {
    if (videoRef.current) {
        const newTime = videoRef.current.currentTime + offset;
        const duration = videoRef.current.duration || Infinity;
        videoRef.current.currentTime = Math.max(0, Math.min(duration, newTime));
    }
  };
  
  const handleInsertTimestamp = () => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const cursorPosition = textarea.selectionStart;
      const text = editableText;
      const timeToInsert = formatDuration(videoCurrentTime);

      // Find the start and end of the current line
      const lineStartIndex = text.lastIndexOf('\n', cursorPosition - 1) + 1;
      let lineEndIndex = text.indexOf('\n', cursorPosition);
      if (lineEndIndex === -1) {
          lineEndIndex = text.length;
      }

      const currentLine = text.substring(lineStartIndex, lineEndIndex);
      const timestampRegex = /^\d{2}:\d{2}/; // Matches "mm:ss" at the start of the string

      // If the current line starts with a timestamp, replace it
      if (timestampRegex.test(currentLine)) {
          const newLine = currentLine.replace(timestampRegex, timeToInsert);
          const newText = text.substring(0, lineStartIndex) + newLine + text.substring(lineEndIndex);
          
          setEditableText(newText);
          
          // Set cursor position after the new timestamp on the same line
          const newCursorPosition = lineStartIndex + timeToInsert.length;
          setTimeout(() => {
            if (textareaRef.current) {
              textareaRef.current.focus();
              textareaRef.current.setSelectionRange(newCursorPosition, newCursorPosition);
            }
          }, 0);
      } else {
          // Fallback: insert at cursor or replace selection (original behavior)
          const start = textarea.selectionStart;
          const end = textarea.selectionEnd;
          
          const newText = text.substring(0, start) + timeToInsert + text.substring(end);
          
          setEditableText(newText);

          const newCursorPosition = start + timeToInsert.length;
          setTimeout(() => {
            if (textareaRef.current) {
              textareaRef.current.focus();
              textareaRef.current.setSelectionRange(newCursorPosition, newCursorPosition);
            }
          }, 0);
      }
  };
  
  const formatForFilename = (totalSeconds: number | null): string => {
    if (totalSeconds === null || isNaN(totalSeconds)) return '00_00';
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    return `${String(minutes).padStart(2, '0')}_${String(seconds).padStart(2, '0')}`;
  };

  const handleCaptureFrame = () => {
    const video = videoRef.current;
    if (!video || !videoFile) return;

    setIsCapturingFrame(true);
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        setIsCapturingFrame(false);
        return;
    }

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const timestampText = `${formatDuration(videoCurrentTime)} / ${formatDuration(videoDuration)}`;
    const fontSize = Math.round(canvas.height / 25);
    const padding = fontSize;

    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillText(timestampText, padding + 2, canvas.height - padding + 2);

    ctx.fillStyle = 'white';
    ctx.fillText(timestampText, padding, canvas.height - padding);

    canvas.toBlob((blob) => {
        if (!blob) {
            setIsCapturingFrame(false);
            return;
        }
        
        setCapturedTime(video.currentTime);
        const currentTimeStr = formatForFilename(video.currentTime);
        const totalDurationStr = formatForFilename(videoDuration);
        const baseName = videoFile.name.replace(/\.[^/.]+$/, "");
        const fileName = `[${currentTimeStr}] of [${totalDurationStr}] frame image - ${baseName}.png`;
        
        const url = URL.createObjectURL(blob);
        if (capturedFrameUrl) {
            URL.revokeObjectURL(capturedFrameUrl);
        }
        setCapturedFrameUrl(url); // Set state to display the image
        setIsImagePreviewVisible(true);

        if (editedFrameUrl) {
            URL.revokeObjectURL(editedFrameUrl);
        }
        setEditedFrameUrl(null); // Clear previous edit when capturing a new frame


        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setExternalImageFile(null);
        setIsCapturingFrame(false);
    }, 'image/png');
  };

  const handleCaptureText = async () => {
    const video = videoRef.current;
    if (!video || !videoFile || isCapturing) return;

    setIsCapturing(true);
    setError(null);

    try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error("Could not get canvas context");

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        setCapturedTime(video.currentTime);
        const base64Frame = canvas.toDataURL('image/jpeg').split(',')[1];

        const processedImageBase64 = await processFrameForTextExtraction(base64Frame);

        const blob = await (await fetch(`data:image/png;base64,${processedImageBase64}`)).blob();
        
        const currentTimeStr = formatForFilename(video.currentTime);
        const totalDurationStr = formatForFilename(videoDuration);
        const baseName = videoFile.name.replace(/\.[^/.]+$/, "");
        const fileName = `${currentTimeStr} of ${totalDurationStr} text image - ${baseName}.png`;

        const url = URL.createObjectURL(blob);
        
        if (capturedFrameUrl) {
            URL.revokeObjectURL(capturedFrameUrl);
        }
        setCapturedFrameUrl(url);
        setIsImagePreviewVisible(true);

        if (editedFrameUrl) {
            URL.revokeObjectURL(editedFrameUrl);
        }
        setEditedFrameUrl(null); // Also clear previous edits here
        setExternalImageFile(null);

        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

    } catch (err: any) {
        console.error("Failed to capture text frame:", err);
        setError(err.message || "An error occurred while capturing the text frame.");
    } finally {
        setIsCapturing(false);
    }
  };

  const isAnyTaskRunning = isCapturing || isEditing || isCapturingFrame || isReWriting || isReWritingFromPopup;

  const handleReWriteFrame = async () => {
    const video = videoRef.current;
    if (!video || !videoFile || isAnyTaskRunning) return;

    setIsReWriting(true);
    setError(null);

    try {
        // 1. Capture frame and display in preview
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error("Could not get canvas context");

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        const timestampText = `${formatDuration(videoCurrentTime)} / ${formatDuration(videoDuration)}`;
        const fontSize = Math.round(canvas.height / 25);
        const padding = fontSize;
        ctx.font = `bold ${fontSize}px sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillText(timestampText, padding + 2, canvas.height - padding + 2);
        ctx.fillStyle = 'white';
        ctx.fillText(timestampText, padding, canvas.height - padding);

        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png', 1.0));
        if (!blob) {
            throw new Error("Failed to create blob from canvas.");
        }

        const capturedUrl = URL.createObjectURL(blob);
        if (capturedFrameUrl) URL.revokeObjectURL(capturedFrameUrl);
        setCapturedFrameUrl(capturedUrl);
        setCapturedTime(video.currentTime);
        setIsImagePreviewVisible(true);
        setExternalImageFile(null);

        if (editedFrameUrl) URL.revokeObjectURL(editedFrameUrl);
        setEditedFrameUrl(null);

        // 2. AI Processing
        const base64Data = await blobToBase64(blob);
        const reWritePrompt = `Analyze the provided image and identify only the text and numbers. Ignore all other visual elements like backgrounds, logos, boxes, and colors. Then, create a new image with the following specifications: 1. The background must be a solid, uniform color: rgb(139, 195, 74). 2. Reproduce the text and numbers you identified from the original image. 3. The style for all text and numbers must be: white color with a black outline. 4. Increase the size of all text and numbers to 1.5 times their original size. 5. Position the enlarged text and numbers on the new background in a layout that is similar to the original and is aesthetically pleasing. The final output image must ONLY contain the styled text and numbers on the specified green background. Nothing else.`;
        const editedImageBase64 = await editImage(base64Data, blob.type, reWritePrompt);
        
        // 3. Display and prepare for download
        const newBlob = await (await fetch(`data:image/png;base64,${editedImageBase64}`)).blob();
        const newUrl = URL.createObjectURL(newBlob);
        setEditedFrameUrl(newUrl);

        // 4. Save to device
        const currentTimeStr = formatForFilename(video.currentTime);
        const totalDurationStr = formatForFilename(videoDuration);
        const baseName = videoFile.name.replace(/\.[^/.]+$/, "");
        const fileName = `${currentTimeStr} of ${totalDurationStr} re-write image - ${baseName}.png`;

        const link = document.createElement('a');
        link.href = newUrl;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

    } catch (err: any) {
        console.error("Failed to re-write frame:", err);
        setError(err.message || "An error occurred during the re-write process.");
    } finally {
        setIsReWriting(false);
    }
  };


  const handleEditImage = async () => {
    if (!capturedFrameUrl || !editPrompt.trim() || isEditing) return;
    await performImageEdit(editPrompt);
    setEditPrompt('');
  };

  const handleQuickEdit = async (key: string) => {
    const prompt = QUICK_EDIT_PROMPTS[key as keyof typeof QUICK_EDIT_PROMPTS];
    if (!capturedFrameUrl || !prompt || isEditing) return;
    setQuickEditLoadingKey(key);
    await performImageEdit(prompt);
  };

  const performImageEdit = async (prompt: string) => {
    setIsEditing(true);
    setError(null);
    try {
        const response = await fetch(capturedFrameUrl as string);
        const blob = await response.blob();
        const base64Data = await blobToBase64(blob);

        const editedImageBase64 = await editImage(base64Data, blob.type, prompt);

        const newBlob = await (await fetch(`data:image/png;base64,${editedImageBase64}`)).blob();
        const newUrl = URL.createObjectURL(newBlob);

        if (editedFrameUrl) {
            URL.revokeObjectURL(editedFrameUrl);
        }
        setEditedFrameUrl(newUrl);

    } catch (err: any) {
        console.error("Failed to edit image:", err);
        setError(err.message || "An error occurred while editing the image.");
    } finally {
        setIsEditing(false);
        setQuickEditLoadingKey(null);
    }
  };

  const handleReWriteFromPopup = async (size: number) => {
    if (!capturedFrameUrl || isAnyTaskRunning) return;
    
    setIsReWritePopupOpen(false);
    setIsReWritingFromPopup(true);
    setError(null);

    const reWritePrompt = `Analyze the provided image and identify only the text and numbers. Ignore all other visual elements like backgrounds, logos, boxes, and colors. Then, create a new image with the following specifications: 1. The background must be a solid, uniform color: rgb(139, 195, 74). 2. Reproduce the text and numbers you identified from the original image. 3. The style for all text and numbers must be: white color with a black outline. 4. Change the size of all text and numbers to ${size}% of their original size. 5. Position the resized text and numbers on the new background in a layout that is similar to the original and is aesthetically pleasing. The final output image must ONLY contain the styled text and numbers on the specified green background. Nothing else. Ensure all text from the original image is present and correct.`;

    try {
        const response = await fetch(capturedFrameUrl as string);
        const blob = await response.blob();
        const base64Data = await blobToBase64(blob);

        const editedImageBase64 = await editImage(base64Data, blob.type, reWritePrompt);

        const newBlob = await (await fetch(`data:image/png;base64,${editedImageBase64}`)).blob();
        const newUrl = URL.createObjectURL(newBlob);

        if (editedFrameUrl) {
            URL.revokeObjectURL(editedFrameUrl);
        }
        setEditedFrameUrl(newUrl);

    } catch (err: any) {
        console.error("Failed to re-write image:", err);
        setError(err.message || "An error occurred while re-writing the image.");
    } finally {
        setIsReWritingFromPopup(false);
    }
};

  const handleSavePreviewImage = () => {
    if (!capturedFrameUrl) return;

    let fileName: string;

    if (externalImageFile) {
        const baseName = externalImageFile.name.replace(/\.[^/.]+$/, "");
        fileName = `${baseName}-preview.png`;
    } else if (videoFile) {
        const currentTimeStr = formatForFilename(capturedTime);
        const totalDurationStr = formatForFilename(videoDuration);
        const baseName = videoFile.name.replace(/\.[^/.]+$/, "");
        fileName = `${currentTimeStr} of ${totalDurationStr} text image - ${baseName}.png`;
    } else {
        fileName = 'preview-image.png';
    }

    const link = document.createElement('a');
    link.href = capturedFrameUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };


  const handleSaveEditedImage = () => {
    if (!editedFrameUrl) return;

    let fileName: string;

    if (externalImageFile) {
        const baseName = externalImageFile.name.replace(/\.[^/.]+$/, "");
        fileName = `${baseName}-edited.png`;
    } else if (videoFile) {
        const currentTimeStr = formatForFilename(capturedTime);
        const totalDurationStr = formatForFilename(videoDuration);
        const baseName = videoFile.name.replace(/\.[^/.]+$/, "");
        fileName = `[${currentTimeStr}] of [${totalDurationStr}] edited image - ${baseName}.png`;
    } else {
        fileName = 'edited-image.png';
    }

    const link = document.createElement('a');
    link.href = editedFrameUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleEditAgain = async () => {
    if (!editedFrameUrl) return;

    const response = await fetch(editedFrameUrl);
    const blob = await response.blob();
    const newPreviewUrl = URL.createObjectURL(blob);

    if (capturedFrameUrl) {
        URL.revokeObjectURL(capturedFrameUrl);
    }
    setCapturedFrameUrl(newPreviewUrl);
    setEditedFrameUrl(null);
  };
  
  const handleManualPrompt = () => {
    setEditPrompt("เปลี่ยนพื้นหลังของภาพในกรอบแสดงภาพ Preview​ Image เป็นสี rgb(139, 195, 74) โทนเดียวทั้งภาพ และแก้ไขสีของข้อความ   เป็นตัวหนังสือสีขาว และมี outline สีดำ วางบนพื้นหลังสี rgb(139, 195, 74) โทนเดียวทั้งภาพ");
  };

  const isPromptEditing = isEditing && quickEditLoadingKey === null;

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 flex flex-col items-center font-sans">
      {/* API Key Management Section */}
      <div className="w-full bg-black/40 border-b border-gray-700 p-2 text-xs font-mono sticky top-0 z-50 shadow-md">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-start sm:items-center gap-2">
              <label className="text-gray-400 whitespace-nowrap">API Key :</label>
              <div className="flex-1 w-full overflow-x-auto bg-gray-800 rounded px-2 h-8 flex items-center shadow-inner">
                  <input
                      type="text"
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                      className="bg-transparent border-none outline-none w-full text-gray-300 min-w-[300px] sm:min-w-[600px] py-1"
                      placeholder="Enter API Key here..."
                  />
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                  <button 
                      onClick={handleSendApiKey}
                      className="flex-1 sm:flex-none px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-500 transition-colors font-semibold"
                  >
                      Send
                  </button>
                  <button 
                      onClick={handleCopyApiKey}
                      className="flex-1 sm:flex-none px-3 py-1 bg-gray-600 text-white rounded hover:bg-gray-500 transition-colors font-semibold"
                  >
                      Copy
                  </button>
                  <button 
                      onClick={handleClearApiKey}
                      className="flex-1 sm:flex-none px-3 py-1 bg-red-900 text-white rounded hover:bg-red-800 transition-colors font-semibold"
                  >
                      Clear
                  </button>
              </div>
          </div>
      </div>

      <main className="w-full max-w-4xl mx-auto flex flex-col items-center p-4 sm:p-6 md:p-8">
        <header className="text-center mb-8">
            <div className="flex justify-center items-center gap-4 mb-2">
                <SparklesIcon className="w-10 h-10 text-purple-400" />
                <h1 className="text-4xl sm:text-5xl font-bold tracking-tight bg-gradient-to-r from-purple-400 to-indigo-500 text-transparent bg-clip-text">
                    Video Text Extractor
                </h1>
            </div>
            <p className="text-gray-400 max-w-2xl">
                Upload a video, and Gemini Pro will extract the text from its frames.
                The process can take several minutes depending on video length.
            </p>
        </header>

        <div className="w-full bg-gray-800 border border-gray-700 rounded-lg shadow-lg p-6 mb-8">
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold text-gray-300">
                    Transcribe Text Image from video clip
                </h2>
                <button
                    onClick={triggerImageFileSelect}
                    disabled={isAnyTaskRunning}
                    className="px-3 py-1.5 bg-gray-600 text-white font-semibold rounded-md hover:bg-gray-700 transition-colors text-sm disabled:bg-gray-500 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    title="Open an image file for editing"
                >
                    <FolderOpenIcon className="w-4 h-4" />
                    Open Image
                </button>
            </div>
            <input
                type="file"
                accept="video/*"
                onChange={handleFileChange}
                className="hidden"
                ref={fileInputRef}
            />
            <input
                type="file"
                accept="image/*"
                onChange={handleImageFileChange}
                className="hidden"
                ref={imageInputRef}
            />
            <input
                type="file"
                accept=".txt,text/plain"
                onChange={handleTextFileChange}
                className="hidden"
                ref={textFileInputRef}
            />
            <button
                onClick={triggerFileSelect}
                className="w-full h-32 flex flex-col items-center justify-center border-2 border-dashed border-gray-600 rounded-lg hover:border-purple-400 hover:bg-gray-700/50 transition-colors duration-300"
            >
                <UploadIcon className="w-8 h-8 text-gray-400 mb-2" />
                <span className="text-gray-300">
                    {videoFile ? 'Click to change video' : 'Click to upload a video'}
                </span>
            </button>
            
            {videoFile && (
                <div className="mt-4 p-3 bg-gray-700/50 rounded-lg flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                        <VideoIcon className="w-6 h-6 text-purple-400 flex-shrink-0" />
                        <span className="text-sm font-medium truncate" title={videoFile.name}>{videoFile.name}</span>
                        {videoDuration !== null && (
                            <span className="text-xs text-gray-400 font-mono bg-gray-800 px-2 py-0.5 rounded flex-shrink-0">
                                {formatDuration(videoDuration)}
                            </span>
                        )}
                    </div>
                    <button 
                        onClick={handleAnalyzeClick}
                        disabled={status === 'processing'}
                        className="px-4 py-2 bg-purple-600 text-white font-semibold rounded-lg hover:bg-purple-700 disabled:bg-gray-500 disabled:cursor-not-allowed transition-colors duration-300 flex items-center gap-2 ml-4"
                    >
                         <SparklesIcon className="w-5 h-5" />
                        {status === 'processing' ? 'Analyzing...' : 'Analyze Video'}
                    </button>
                </div>
            )}
        </div>

        <div className="w-full">
            {status === 'processing' && (
                <div className="flex flex-col items-center text-center p-8 bg-gray-800/50 rounded-lg border border-gray-700">
                    <div className="w-16 h-16 border-4 border-purple-400 border-t-transparent rounded-full animate-spin mb-4"></div>
                    <p className="text-lg font-semibold">{progress.message}</p>
                    {progress.percentage !== undefined && (
                        <div className="w-full bg-gray-700 rounded-full h-2.5 mt-2">
                           <div className="bg-purple-600 h-2.5 rounded-full" style={{ width: `${progress.percentage}%` }}></div>
                        </div>
                    )}
                </div>
            )}
            
            {status === 'error' && (
                <div className="bg-red-900/50 border border-red-700 text-red-300 p-4 rounded-lg text-center">
                    <h3 className="font-bold mb-2">Analysis Failed</h3>
                    <p>{error}</p>
                </div>
            )}

            {(status === 'success' || status === 'idle' && videoFile) && (
                <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
                    {videoUrl && (
                        <div className="mb-6">
                            <video
                                ref={videoRef}
                                src={videoUrl}
                                controls
                                onTimeUpdate={(e) => setVideoCurrentTime(e.currentTarget.currentTime)}
                                className="w-full rounded-lg border border-gray-600 shadow-lg"
                            >
                                Your browser does not support the video tag.
                            </video>
                        </div>
                    )}
                    {videoUrl && (
                        <div className="flex justify-center items-start gap-2 sm:gap-4 mb-6">
                            <button
                                onClick={handleCaptureFrame}
                                disabled={isAnyTaskRunning}
                                className="px-3 py-2 sm:px-4 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 transition-colors duration-200 flex items-center justify-center gap-2 disabled:bg-gray-500 disabled:cursor-wait flex-1 sm:flex-none sm:w-40"
                                title="Capture current frame as an image"
                            >
                                {isCapturingFrame ? <SpinnerIcon className="w-5 h-5" /> : <CameraIcon className="w-5 h-5" />}
                                <span className="hidden sm:inline">{isCapturingFrame ? 'Capturing...' : 'Capture Frame'}</span>
                            </button>
                            <button
                                onClick={handleCaptureText}
                                disabled={isAnyTaskRunning}
                                className="px-3 py-2 sm:px-4 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 transition-colors duration-200 flex items-center justify-center gap-2 disabled:bg-gray-500 disabled:cursor-wait flex-1 sm:flex-none sm:w-40"
                                title="Extract text from current frame into a new image"
                            >
                                {isCapturing ? <SpinnerIcon className="w-5 h-5" /> : <DocumentTextIcon className="w-5 h-5" />}
                                <span className="hidden sm:inline">{isCapturing ? 'Processing...' : 'Capture Text'}</span>
                            </button>
                             <button
                                onClick={handleReWriteFrame}
                                disabled={isAnyTaskRunning}
                                className="px-3 py-2 sm:px-4 bg-yellow-500 text-white font-semibold rounded-lg hover:bg-yellow-600 transition-colors duration-200 flex items-center justify-center gap-2 disabled:bg-gray-500 disabled:cursor-wait flex-1 sm:flex-none sm:w-40"
                                title="Re-write text from current frame into a new image"
                            >
                                {isReWriting ? <SpinnerIcon className="w-5 h-5" /> : <PencilIcon className="w-5 h-5" />}
                                <span className="hidden sm:inline">{isReWriting ? 'Re-Writing...' : 'Re-Write'}</span>
                            </button>
                        </div>
                    )}
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-2xl font-bold text-purple-400">Extracted Text</h2>
                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => handleSeek(-3)}
                                    title="Rewind 3s"
                                    className="p-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition-colors duration-200"
                                >
                                    <ChevronsLeftIcon className="w-5 h-5" />
                                </button>
                                <button
                                    onClick={() => handleSeek(-1)}
                                    title="Rewind 1s"
                                    className="p-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition-colors duration-200"
                                >
                                    <RewindIcon className="w-5 h-5" />
                                </button>
                                <button
                                    onClick={handleInsertTimestamp}
                                    title="Insert current time at cursor"
                                    className="font-mono text-lg text-gray-300 bg-gray-900 px-3 py-1 rounded-md border border-gray-600 min-w-[5ch] text-center hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-colors"
                                >
                                    {formatDuration(videoCurrentTime)}
                                </button>
                                <button
                                    onClick={() => handleSeek(1)}
                                    title="Forward 1s"
                                    className="p-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition-colors duration-200"
                                >
                                    <ForwardIcon className="w-5 h-5" />
                                </button>
                                <button
                                    onClick={() => handleSeek(3)}
                                    title="Forward 3s"
                                    className="p-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition-colors duration-200"
                                >
                                    <ChevronsRightIcon className="w-5 h-5" />
                                </button>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={triggerTextFileSelect}
                                    className="px-3 py-2 bg-gray-700 text-gray-300 font-semibold rounded-lg hover:bg-gray-600 transition-colors duration-200 flex items-center gap-2 text-sm"
                                    title="Open a .txt file to edit"
                                >
                                    <FolderOpenIcon className="w-4 h-4" />
                                    Open .txt
                                </button>
                                <button
                                    onClick={handleCopy}
                                    className="px-3 py-2 bg-gray-700 text-gray-300 font-semibold rounded-lg hover:bg-gray-600 transition-colors duration-200 flex items-center gap-2 text-sm"
                                >
                                    <CopyIcon className="w-4 h-4" />
                                    {copyButtonText}
                                </button>
                                <button
                                    onClick={handleSave}
                                    className="px-3 py-2 bg-purple-600 text-white font-semibold rounded-lg hover:bg-purple-700 transition-colors duration-200 flex items-center gap-2 text-sm"
                                >
                                    <SaveIcon className="w-4 h-4" />
                                    Save as .txt
                                </button>
                            </div>
                        </div>
                    </div>
                    {transcriptions.length > 0 || editableText ? (
                        <textarea
                            ref={textareaRef}
                            value={editableText}
                            onChange={(e) => setEditableText(e.target.value)}
                            className="w-full h-96 bg-gray-900 font-mono text-gray-300 p-4 rounded-md border border-gray-600 focus:ring-2 focus:ring-purple-500 focus:outline-none"
                            placeholder="Extracted text will appear here..."
                        />
                    ) : (
                        <p className="text-gray-400 text-center py-8">No text was found in the video.</p>
                    )}
                </div>
            )}

            {status === 'idle' && !videoFile && (
                <div className="text-center text-gray-500 p-8 border-2 border-dashed border-gray-700 rounded-lg">
                    <p>Your analysis results will appear here.</p>
                </div>
            )}
        </div>

        {isImagePreviewVisible && capturedFrameUrl && (
            <div className="w-full bg-gray-800 border border-gray-700 rounded-lg shadow-lg p-6 mt-8 flex flex-col items-center">
                <h3 className="text-xl font-semibold text-center text-purple-400 mb-4">Preview Image</h3>
                <div id="pic1">
                    <img 
                        src={capturedFrameUrl} 
                        alt="Captured video frame" 
                        className="rounded-lg border-2 border-gray-600 shadow-lg max-w-full"
                        style={{ width: '600px' }}
                    />
                </div>
                <div className="w-full max-w-[600px] mt-4 flex flex-wrap justify-center gap-2">
                    <button
                        onClick={triggerImageFileSelect}
                        disabled={isAnyTaskRunning}
                        className="px-3 py-1.5 bg-gray-600 text-white font-semibold rounded-md hover:bg-gray-700 transition-colors text-sm disabled:bg-gray-500 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        title="Open an image file for editing"
                    >
                        <FolderOpenIcon className="w-4 h-4" />
                        Open
                    </button>
                    <button
                        onClick={handleSavePreviewImage}
                        disabled={isAnyTaskRunning}
                        className="px-3 py-1.5 bg-purple-600 text-white font-semibold rounded-md hover:bg-purple-700 transition-colors text-sm disabled:bg-gray-500 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        title="Save preview image"
                    >
                        <SaveIcon className="w-4 h-4" />
                        Save
                    </button>
                    <div className="relative" ref={reWritePopupRef}>
                        <button
                            onClick={() => setIsReWritePopupOpen(prev => !prev)}
                            disabled={isAnyTaskRunning}
                            className="px-3 py-1.5 bg-yellow-500 text-white font-semibold rounded-md hover:bg-yellow-600 transition-colors text-sm disabled:bg-gray-500 disabled:cursor-not-allowed flex items-center justify-center gap-2 min-w-[95px]"
                            title="Re-write text from image with options"
                        >
                            {isReWritingFromPopup ? (
                                <SpinnerIcon className="w-4 h-4" />
                            ) : (
                                <PencilIcon className="w-4 h-4" />
                            )}
                            Re-Write
                        </button>
                        {isReWritePopupOpen && (
                            <div className="absolute bottom-full mb-2 w-28 origin-bottom rounded-md bg-gray-700 shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none z-10">
                                <div className="py-1">
                                    <p className="px-3 py-1 text-xs font-semibold text-gray-400">Size (100% is original)</p>
                                    {REWRITE_SIZES.map((size) => (
                                        <button
                                            key={size}
                                            onClick={() => handleReWriteFromPopup(size)}
                                            className="text-gray-200 block w-full px-3 py-1.5 text-sm text-left hover:bg-gray-600 transition-colors"
                                        >
                                            {size}%
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                    {Object.keys(QUICK_EDIT_PROMPTS).map((key) => (
                        <button
                            key={key}
                            onClick={() => handleQuickEdit(key)}
                            disabled={isAnyTaskRunning}
                            className="px-3 py-1.5 bg-gray-600 text-white font-semibold rounded-md hover:bg-gray-700 transition-colors text-sm disabled:bg-gray-500 disabled:cursor-not-allowed flex items-center justify-center min-w-[80px]"
                        >
                            {isEditing && quickEditLoadingKey === key ? (
                                <SpinnerIcon className="w-4 h-4" />
                            ) : (
                                key.replace('_', ' ')
                            )}
                        </button>
                    ))}
                    <button
                        onClick={handleManualPrompt}
                        disabled={isAnyTaskRunning}
                        className="px-3 py-1.5 bg-gray-600 text-white font-semibold rounded-md hover:bg-gray-700 transition-colors text-sm disabled:bg-gray-500 disabled:cursor-not-allowed flex items-center justify-center min-w-[80px]"
                    >
                        Manual
                    </button>
                </div>
                <div className="w-full max-w-[600px] mt-4">
                    <textarea
                        value={editPrompt}
                        onChange={(e) => setEditPrompt(e.target.value)}
                        rows={3}
                        className="w-full bg-gray-900 font-sans text-gray-300 p-3 rounded-md border border-gray-600 focus:ring-2 focus:ring-indigo-500 focus:outline-none transition-shadow"
                        placeholder="Describe changes to the image... e.g., 'add a birthday hat on the person'"
                        disabled={isAnyTaskRunning}
                    />
                    <button
                        onClick={handleEditImage}
                        disabled={!editPrompt.trim() || isAnyTaskRunning}
                        className="w-full mt-2 px-4 py-2 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 transition-colors duration-200 flex items-center justify-center gap-2 disabled:bg-gray-500 disabled:cursor-not-allowed"
                    >
                        {isPromptEditing ? (
                            <SpinnerIcon className="w-5 h-5" />
                        ) : (
                            <SparklesIcon className="w-5 h-5" />
                        )}
                        {isPromptEditing ? 'Applying Edit...' : 'Apply Edit'}
                    </button>
                </div>
                {editedFrameUrl && (
                    <div id="pic2" className="mt-8">
                        <h3 className="text-xl font-semibold text-center text-indigo-400 mb-4">Edited Image</h3>
                        <img 
                            src={editedFrameUrl} 
                            alt="Edited video frame" 
                            className="rounded-lg border-2 border-indigo-500 shadow-lg max-w-full mx-auto"
                            style={{ width: '600px' }}
                        />
                        <div className="flex justify-center gap-4 mt-4">
                            <button
                                onClick={handleSaveEditedImage}
                                className="px-4 py-2 bg-purple-600 text-white font-semibold rounded-lg hover:bg-purple-700 transition-colors duration-200 flex items-center gap-2"
                                title="Save edited image"
                            >
                                <SaveIcon className="w-5 h-5" />
                                Save
                            </button>
                            <button
                                onClick={handleEditAgain}
                                className="px-4 py-2 bg-gray-600 text-white font-semibold rounded-lg hover:bg-gray-700 transition-colors duration-200 flex items-center gap-2"
                                title="Use this image for the next edit"
                            >
                                <PencilIcon className="w-5 h-5" />
                                Edit
                            </button>
                        </div>
                    </div>
                )}
            </div>
        )}
      </main>
    </div>
  );
};

export default App;
