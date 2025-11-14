
import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, Modality, ImageFile as GenAIImageFile } from '@google/genai';
import { LoadingSpinner } from './LoadingSpinner';
import { ApiKeySelector } from './ApiKeySelector';
import { UploadIcon } from './icons/UploadIcon';
import { PlusIcon } from './icons/PlusIcon';
import { SendIcon } from './icons/SendIcon';
import { ChatMessage, MessageRole, ReferenceImage, ImageFile } from '../types';
import { Translation } from './Translation';
import { TranslateIcon } from './icons/TranslateIcon';
import { DownloadIcon } from './icons/DownloadIcon';
import { FullScreenIcon } from './icons/FullScreenIcon';
import { ExitFullScreenIcon } from './icons/ExitFullScreenIcon';
import { DraggableResizablePanel } from './DraggableResizablePanel';
import { ArrowRightIcon } from './icons/ArrowRightIcon';
import { UpscaleIcon } from './icons/UpscaleIcon';
import { TaggingModal } from './TaggingModal';
import { PencilIcon } from './icons/PencilIcon';

type GenerationMode = 'image' | 'video';

interface GeneratedImage {
  id: string;
  imageUrl: string;
  prompt: string;
  referenceImages: (ReferenceImage | null)[];
}

interface VideoSession {
    prompts: ChatMessage[];
    referenceImages: (ImageFile | null)[];
    videoData: any | null; // Stores the latest video data for modification
}

interface PanelState {
  position: { x: number; y: number };
  size: { width: number | string; height: number | string };
  zIndex: number;
}


const ImageUploadSlot: React.FC<{
    label: string;
    image: ImageFile | null;
    onUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
    onRemove: () => void;
    inputId: string;
    disabled: boolean;
}> = ({ label, image, onUpload, onRemove, inputId, disabled }) => (
    <div className={`flex flex-col items-center justify-center p-2 border-2 border-dashed border-gray-600 rounded-lg h-36 transition-colors ${disabled ? 'bg-gray-700/50' : ''}`}>
        <p className="text-xs font-semibold text-gray-400 mb-2">{label}</p>
        {image ? (
            <div className="relative">
                <img src={`data:${image.mimeType};base64,${image.base64}`} alt={`${label} preview`} className="h-24 w-auto rounded-md object-cover"/>
                {!disabled && (
                    <button onClick={onRemove} className="absolute top-0 right-0 -mt-2 -mr-2 bg-red-600 hover:bg-red-500 text-white rounded-full p-0 w-5 h-5 flex items-center justify-center text-xs font-bold transition-transform hover:scale-110" aria-label={`Remove ${label}`}>&#x2715;</button>
                )}
            </div>
        ) : (
             <label htmlFor={inputId} className={`cursor-pointer flex flex-col items-center text-gray-400 hover:text-sky-400 transition-colors ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
                <UploadIcon />
                <span className="text-xs mt-1">Upload</span>
            </label>
        )}
        <input id={inputId} type="file" accept="image/*" className="hidden" onChange={onUpload} disabled={disabled} />
    </div>
);


const Generator: React.FC = () => {
    const [mode, setMode] = useState<GenerationMode>('image');
    const [prompt, setPrompt] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [loadingMessage, setLoadingMessage] = useState('');
    const [apiKeySelected, setApiKeySelected] = useState(false);
    const [isTranslatingInput, setIsTranslatingInput] = useState(false);
    
    // Video state
    const [videoResolution, setVideoResolution] = useState<'720p' | '1080p' | null>('720p');
    const [videoAspectRatio, setVideoAspectRatio] = useState<'16:9' | '9:16' | null>('16:9');
    const [targetDuration, setTargetDuration] = useState(4);
    const [currentVideoSession, setCurrentVideoSession] = useState<VideoSession | null>(null);
    const [panels, setPanels] = useState<Record<string, PanelState>>({
        chat: {
            position: { x: 20, y: 0 },
            size: { width: 'calc(65% - 30px)', height: '100%' },
            zIndex: 1,
        },
        controls: {
            position: { x: '65%', y: 0 },
            size: { width: '35%', height: '100%' },
            zIndex: 1,
        }
    });


    // Image state
    const [artboardImage, setArtboardImage] = useState<ImageFile | null>(null);
    const [referenceImages, setReferenceImages] = useState<(ReferenceImage | null)[]>(Array(12).fill(null));
    const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
    const [selectedGeneratedImage, setSelectedGeneratedImage] = useState<GeneratedImage | null>(null);
    const [isFullScreen, setIsFullScreen] = useState(false);
    const [aspectRatio, setAspectRatio] = useState<'1:1' | '16:9' | '9:16' | '4:3' | '3:4'>('1:1');
    const [isDraggingOverArtboard, setIsDraggingOverArtboard] = useState(false);
    const [isUpscaling, setIsUpscaling] = useState(false);
    const [taggingImageIndex, setTaggingImageIndex] = useState<number | null>(null);
    const [savedTags, setSavedTags] = useState<string[]>(['character design', 'style reference', 'background', 'item concept']);
    
    const imageUploadRef = useRef<HTMLInputElement>(null);
    const artboardUploadRef = useRef<HTMLInputElement>(null);
    const dragItemIndex = useRef<number | null>(null);
    const previewContainerRef = useRef<HTMLDivElement>(null);
    
    useEffect(() => {
        if (mode === 'video') {
            handleStartNewVideo(true);
            checkApiKey();
        } else {
            handleStartNewImageSession();
        }
    }, [mode]);
    
    const checkApiKey = async () => {
        // @ts-ignore
        if (window.aistudio && await window.aistudio.hasSelectedApiKey()) {
            setApiKeySelected(true);
        } else {
            setApiKeySelected(false);
        }
    };

    const fileToBase64 = (file: File): Promise<string> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve((reader.result as string).split(',')[1]);
            reader.onerror = (error) => reject(error);
        });
    };
    
    const dataUrlToImageFile = async (dataUrl: string, name: string): Promise<ImageFile> => {
        const [header, base64] = dataUrl.split(',');
        const mimeType = header.match(/:(.*?);/)?.[1] || 'image/png';
        const { width, height } = await getImageDimensions(base64, mimeType);
        return { base64, mimeType, name, width, height };
    };

    const getImageDimensions = (base64: string, mimeType: string): Promise<{ width: number, height: number }> => {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve({ width: img.width, height: img.height });
            img.onerror = (err) => reject(err);
            img.src = `data:${mimeType};base64,${base64}`;
        });
    };

    const handleVideoFileChange = async (event: React.ChangeEvent<HTMLInputElement>, index: 0 | 1 | 2) => {
        const file = event.target.files?.[0];
        if (file) {
            if (!file.type.startsWith('image/')) {
                setError("Please upload a valid image file.");
                return;
            }
            setError(null);
            const base64 = await fileToBase64(file);
            const { width, height } = await getImageDimensions(base64, file.type);
            const imageFile = { base64, mimeType: file.type, name: file.name, width, height };
            
            setCurrentVideoSession(prev => {
                const newImages: (ImageFile | null)[] = [...(prev?.referenceImages || [null, null, null])];
                newImages[index] = imageFile;

                if (index === 0) { // Reference Image
                    newImages[1] = null;
                    newImages[2] = null;
                } else if (index === 1 || index === 2) { // Start/End Frame
                    newImages[0] = null;
                }

                return {
                    prompts: prev?.prompts || [],
                    referenceImages: newImages,
                    videoData: prev?.videoData,
                };
            });
            event.target.value = '';
        }
    };
    
    const handleArtboardFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            if (!file.type.startsWith('image/')) {
                setError("Please upload a valid image file.");
                return;
            }
            setError(null);
            const base64 = await fileToBase64(file);
            const { width, height } = await getImageDimensions(base64, file.type);
            setArtboardImage({ base64, mimeType: file.type, name: file.name, width, height });
            if (artboardUploadRef.current) {
                artboardUploadRef.current.value = '';
            }
        }
    };
    
    const handleImageFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            if (!file.type.startsWith('image/')) {
                setError("Please upload a valid image file.");
                return;
            }
            setError(null);
            const base64 = await fileToBase64(file);
            const { width, height } = await getImageDimensions(base64, file.type);
            const newImage: ReferenceImage = {
                id: `ref-${Date.now()}`,
                file: { base64, mimeType: file.type, name: file.name, width, height },
                tag: '',
            };

            setReferenceImages(prev => {
                const newImages = [...prev];
                const firstEmptyIndex = newImages.findIndex(img => img === null);
                if (firstEmptyIndex !== -1) {
                    newImages[firstEmptyIndex] = newImage;
                } else {
                    setError("All reference image slots are full. Please remove one to add another.");
                }
                return newImages;
            });

            if (imageUploadRef.current) {
                imageUploadRef.current.value = '';
            }
        }
    };
    
    const handleSaveTag = (tag: string) => {
        if (taggingImageIndex === null) return;

        setReferenceImages(prev => {
            const newImages = [...prev];
            const imageToUpdate = newImages[taggingImageIndex];
            if (imageToUpdate) {
                newImages[taggingImageIndex] = { ...imageToUpdate, tag };
            }
            return newImages;
        });

        const trimmedTag = tag.trim();
        if (trimmedTag && !savedTags.includes(trimmedTag)) {
            setSavedTags(prev => [...prev, trimmedTag]);
        }

        setTaggingImageIndex(null);
    };

    const handleRemoveVideoImage = (index: 0 | 1 | 2) => {
        setCurrentVideoSession(prev => {
            if (!prev) return null;
            const newImages = [...prev.referenceImages];
            newImages[index] = null;
            if (index === 1) newImages[2] = null;
            return { ...prev, referenceImages: newImages };
        });
    };
    
    const handleRemoveReferenceImage = (index: number) => {
        setReferenceImages(prev => {
            const newImages = [...prev];
            newImages[index] = null;
            return newImages;
        });
    };
    
    const handlePromptSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        
        const currentPromptText = prompt.trim();
        if (!canSubmit()) return;

        setIsLoading(true);
        setError(null);
        
        if (mode === 'image') {
            const activeReferenceImages = referenceImages.filter((img): img is ReferenceImage => img !== null);
            setPrompt('');

            try {
                await generateImage(currentPromptText, artboardImage, activeReferenceImages);
            } catch (err) {
                handleGenerationError(err as Error);
            } finally {
                setIsLoading(false);
                setLoadingMessage('');
            }

        } else if (mode === 'video') {
            const userPrompt: ChatMessage = { id: `user-${Date.now()}`, role: MessageRole.User, text: currentPromptText };
            setCurrentVideoSession(prev => ({...prev!, prompts: [...(prev?.prompts || []), userPrompt]}));
            setPrompt('');

            try {
                if (!apiKeySelected) throw new Error("API key not selected for video generation.");
                const isModification = !!currentVideoSession?.videoData;
                if (isModification) {
                    await modifyVideo(currentPromptText);
                } else {
                    await generateVideo(currentPromptText);
                }
            } catch (err) {
                handleGenerationError(err as Error);
            } finally {
                setIsLoading(false);
                setLoadingMessage('');
            }
        }
    };
    
    const handleGenerationError = (err: Error) => {
        console.error(`Error generating ${mode}:`, err);
        const errorMessage = `Generation failed: ${err.message}`;
        setError(errorMessage);
        if (mode === 'video') {
            const errorPrompt: ChatMessage = { id: `error-${Date.now()}`, role: MessageRole.Model, text: `Error: ${errorMessage}`};
            setCurrentVideoSession(prev => prev ? { ...prev, prompts: [...prev.prompts, errorPrompt] } : null);
            if (err.message?.includes('Requested entity was not found')) {
                 setError('API Key is invalid. Please select a new one.');
                 setApiKeySelected(false);
            }
        }
    }

    const generateImage = async (promptText: string, artboardImg: ImageFile | null, activeReferenceImages: ReferenceImage[]) => {
        setLoadingMessage('Generating your image...');
        if (!process.env.API_KEY) throw new Error("API_KEY not set.");
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        
        let finalPrompt = promptText.trim();
        const taggedImagesDescription: string[] = [];

        activeReferenceImages.forEach((refImg, index) => {
            if (refImg.tag) {
                taggedImagesDescription.push(`- Reference image ${index + 1} is for: "${refImg.tag}"`);
            }
        });
        
        if (taggedImagesDescription.length > 0) {
            finalPrompt += "\n\nUse the reference images as follows:\n" + taggedImagesDescription.join("\n");
        }

        const parts: (string | GenAIImageFile)[] = [];
        parts.push({ text: `An image with a ${aspectRatio} aspect ratio. ${finalPrompt}` });
        
        if (artboardImg) {
            parts.push({ inlineData: { data: artboardImg.base64, mimeType: artboardImg.mimeType } });
        }

        activeReferenceImages.forEach(refImg => {
            parts.push({ inlineData: { data: refImg.file.base64, mimeType: refImg.file.mimeType } });
        });

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: { parts: parts },
            config: {
                 responseModalities: [Modality.IMAGE],
            },
        });

        for (const part of response.candidates[0].content.parts) {
            if (part.inlineData) {
                const base64ImageBytes: string = part.inlineData.data;
                const imageUrl = `data:image/png;base64,${base64ImageBytes}`;
                const newImage: GeneratedImage = {
                    id: `gen-${Date.now()}`,
                    imageUrl: imageUrl,
                    prompt: promptText,
                    referenceImages: [...referenceImages]
                };
                setGeneratedImages(prev => [...prev, newImage]);
                setSelectedGeneratedImage(newImage);
                return;
            }
        }
        throw new Error("No image data received from API.");
    };

    const handleUpscale = async () => {
        if (!selectedGeneratedImage || isLoading || isUpscaling) return;

        setIsUpscaling(true);
        setLoadingMessage('Upscaling image...');
        setError(null);

        try {
            if (!process.env.API_KEY) throw new Error("API_KEY not set.");
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

            const dataUrl = selectedGeneratedImage.imageUrl;
            const [header, base64Data] = dataUrl.split(',');
            const mimeType = header.match(/:(.*?);/)?.[1] || 'image/png';
            
            const imagePart = { inlineData: { data: base64Data, mimeType: mimeType } };
            const textPart = { text: 'Upscale this image to a higher resolution, enhancing details while maintaining the original style.' };

            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash-image',
                contents: { parts: [imagePart, textPart] },
                config: { responseModalities: [Modality.IMAGE] },
            });

            for (const part of response.candidates[0].content.parts) {
                if (part.inlineData) {
                    const base64ImageBytes: string = part.inlineData.data;
                    const newImageUrl = `data:image/png;base64,${base64ImageBytes}`;
                    
                    const upscaledImage: GeneratedImage = {
                        id: `gen-upscaled-${Date.now()}`,
                        imageUrl: newImageUrl,
                        prompt: `(Upscaled) ${selectedGeneratedImage.prompt}`, 
                        referenceImages: selectedGeneratedImage.referenceImages,
                    };

                    setGeneratedImages(prev => [...prev, upscaledImage]);
                    setSelectedGeneratedImage(upscaledImage);
                    return;
                }
            }
            throw new Error("No upscaled image data received from API.");
        } catch (err) {
            handleGenerationError(err as Error);
        } finally {
            setIsUpscaling(false);
            setLoadingMessage('');
        }
    };

    const generateVideo = async (promptText: string) => {
        if (!process.env.API_KEY) throw new Error("API_KEY not set.");
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        
        setLoadingMessage('Initializing video generation... This may take a few minutes.');
        const refImage = currentVideoSession?.referenceImages?.[0];
        const startFrame = currentVideoSession?.referenceImages?.[1];
        const endFrame = currentVideoSession?.referenceImages?.[2];
        const primaryImage = startFrame || refImage;

        let finalAspectRatio: '16:9' | '9:16' = '16:9';
        if (videoAspectRatio) {
            finalAspectRatio = videoAspectRatio;
        } else if (primaryImage) {
            finalAspectRatio = (primaryImage.width / primaryImage.height) >= 1 ? '16:9' : '9:16';
        }

        const finalResolution: '720p' | '1080p' = videoResolution || '720p';
        const finalPrompt = `${promptText}. The video should be approximately ${targetDuration} seconds long.`;
        
        const payload: any = {
            model: 'veo-3.1-fast-generate-preview',
            prompt: finalPrompt,
            config: { numberOfVideos: 1, resolution: finalResolution, aspectRatio: finalAspectRatio }
        };
        
        if (startFrame) {
            payload.image = { imageBytes: startFrame.base64, mimeType: startFrame.mimeType };
            if (endFrame) payload.config.lastFrame = { imageBytes: endFrame.base64, mimeType: endFrame.mimeType };
        } else if (refImage) {
             payload.image = { imageBytes: refImage.base64, mimeType: refImage.mimeType };
        }

        let operation = await ai.models.generateVideos(payload);

        setLoadingMessage('Video generation in progress... Polling for results.');
        while (!operation.done) {
            await new Promise(resolve => setTimeout(resolve, 10000));
            operation = await ai.operations.getVideosOperation({ operation: operation });
        }
        
        const generatedVideoData = operation.response?.generatedVideos?.[0]?.video;
        if (!generatedVideoData?.uri) throw new Error("Video URI not found in response.");

        setLoadingMessage('Fetching generated video...');
        const videoResponse = await fetch(`${generatedVideoData.uri}&key=${process.env.API_KEY}`);
        if(!videoResponse.ok) throw new Error(`Failed to fetch video: ${videoResponse.statusText}`);

        const videoBlob = await videoResponse.blob();
        const videoUrl = URL.createObjectURL(videoBlob);
        
        const videoMessage: ChatMessage = { id: `model-${Date.now()}`, role: MessageRole.Model, text: 'Generated Video', videoUrl: videoUrl };
        setCurrentVideoSession(prev => ({ ...prev!, videoData: generatedVideoData, prompts: [...(prev?.prompts || []), videoMessage]}));
    };

    const modifyVideo = async (promptText: string) => {
        const lastVideoData = currentVideoSession?.videoData;
        if (!lastVideoData || !process.env.API_KEY) return;
        
        setLoadingMessage('Applying modifications to your video...');
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        
        const finalPrompt = `${promptText} The resulting video should now be approximately ${targetDuration} seconds long.`;
        
        let operation = await ai.models.generateVideos({
          model: 'veo-3.1-generate-preview',
          prompt: finalPrompt, video: lastVideoData,
          config: { numberOfVideos: 1, resolution: '720p', aspectRatio: lastVideoData?.aspectRatio }
        });

        setLoadingMessage('Video modification in progress... Polling for results.');
        while (!operation.done) {
            await new Promise(resolve => setTimeout(resolve, 10000));
            operation = await ai.operations.getVideosOperation({ operation: operation });
        }

        const newVideoData = operation.response?.generatedVideos?.[0]?.video;
        if (!newVideoData?.uri) throw new Error("Video URI not found in response.");

        setLoadingMessage('Fetching modified video...');
        const videoResponse = await fetch(`${newVideoData.uri}&key=${process.env.API_KEY}`);
        if (!videoResponse.ok) throw new Error(`Failed to fetch video: ${videoResponse.statusText}`);

        const videoBlob = await videoResponse.blob();
        const newUrl = URL.createObjectURL(videoBlob);
        
        const videoMessage: ChatMessage = { id: `model-${Date.now()}`, role: MessageRole.Model, text: 'Modified Video', videoUrl: newUrl };
        setCurrentVideoSession(prev => ({ ...prev!, videoData: newVideoData, prompts: [...(prev?.prompts || []), videoMessage] }));
    };
    
    const handleStartNewImageSession = () => {
        setArtboardImage(null);
        setReferenceImages(Array(12).fill(null));
        setGeneratedImages([]);
        setSelectedGeneratedImage(null);
        setPrompt('');
        setError(null);
        setIsLoading(false);
        setIsUpscaling(false);
        setLoadingMessage('');
    };

    const handleStartNewVideo = (isModeChange = false) => {
        if (currentVideoSession) {
            currentVideoSession.prompts.forEach(p => p.videoUrl && URL.revokeObjectURL(p.videoUrl));
        }
        setCurrentVideoSession({ prompts: [], referenceImages: [null, null, null], videoData: null });
        setPrompt('');
        setError(null);
        setIsLoading(false);
        setLoadingMessage('');
        setVideoResolution('720p');
        setVideoAspectRatio('16:9');
        setTargetDuration(4);
    };

    const canSubmit = () => {
        if (isLoading || isUpscaling) return false;
        if (mode === 'video') return prompt.trim().length > 0;
        if (mode === 'image') {
            const hasPrompt = prompt.trim().length > 0;
            const hasRefImages = referenceImages.some(img => img !== null);
            const hasArtboardImage = artboardImage !== null;
            return hasPrompt || hasRefImages || hasArtboardImage;
        }
        return false;
    }
    
    const handleTranslatePrompt = async () => {
        if (!prompt.trim() || isTranslatingInput) return;
        setIsTranslatingInput(true);
        setError(null);
        try {
            if (!process.env.API_KEY) throw new Error("API_KEY not set.");
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const translationPrompt = `Translate the following text into English. Provide only the translated text, without any additional comments or explanations.\n\nText to translate: "${prompt}"`;
            const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: translationPrompt });
            setPrompt(response.text.trim());
        } catch (e) {
            const err = e as Error;
            setError(`Translation failed: ${err.message}`);
        } finally {
            setIsTranslatingInput(false);
        }
    };
    
    const handleDragStart = (index: number) => {
        dragItemIndex.current = index;
    };
    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => e.preventDefault();
    const handleDrop = (targetIndex: number) => {
        const sourceIndex = dragItemIndex.current;
        dragItemIndex.current = null;
        if (sourceIndex === null || sourceIndex === targetIndex) return;

        setReferenceImages(prev => {
            const newImages = [...prev];
            const draggedItemContent = newImages[sourceIndex];
            newImages[sourceIndex] = newImages[targetIndex];
            newImages[targetIndex] = draggedItemContent;
            return newImages;
        });
    };
    
    const handleHistoryDragStart = (e: React.DragEvent, image: GeneratedImage) => {
        e.dataTransfer.setData('application/json', JSON.stringify(image));
    };

    const handleArtboardDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDraggingOverArtboard(true);
    };
    
    const handleArtboardDragLeave = () => {
        setIsDraggingOverArtboard(false);
    };

    const handleArtboardDrop = async (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDraggingOverArtboard(false);
        try {
            const imageDataString = e.dataTransfer.getData('application/json');
            if (imageDataString) {
                const draggedImage: GeneratedImage = JSON.parse(imageDataString);
                const imageFile = await dataUrlToImageFile(draggedImage.imageUrl, `generated-${draggedImage.id}.png`);
                setArtboardImage(imageFile);
            }
        } catch (err) {
            console.error("Failed to handle drop on artboard:", err);
            setError("Could not use the dragged image.");
        }
    };

    const handleFullScreenToggle = () => {
        if (!document.fullscreenElement) {
            previewContainerRef.current?.requestFullscreen().catch(err => {
                console.error(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`);
            });
        } else {
            document.exitFullscreen();
        }
    };
    
    useEffect(() => {
        const onFullScreenChange = () => {
            setIsFullScreen(!!document.fullscreenElement);
        };
        document.addEventListener('fullscreenchange', onFullScreenChange);
        return () => document.removeEventListener('fullscreenchange', onFullScreenChange);
    }, []);

    const handleResolutionToggle = (res: '720p' | '1080p') => setVideoResolution(prev => (prev === res ? null : res));
    const handleAspectRatioToggle = (ratio: '16:9' | '9:16') => setVideoAspectRatio(prev => (prev === ratio ? null : ratio));

    const handlePanelFocus = (id: string) => {
        setPanels(prev => {
            // FIX: Explicitly type `p` as `PanelState` to resolve `p.zIndex` access error.
            const maxZ = Math.max(...Object.values(prev).map((p: PanelState) => p.zIndex));
            if (prev[id].zIndex === maxZ && Object.keys(prev).length > 1) return prev;
            
            return {
                ...prev,
                [id]: { ...prev[id], zIndex: maxZ + 1 },
            };
        });
    };

    const handlePanelDrag = (id: string, newPosition: { x: number, y: number }) => {
        setPanels(prev => ({
            ...prev,
            [id]: { ...prev[id], position: newPosition },
        }));
    };
    
    const handlePanelResize = (id: string, newSize: { width: number, height: number }) => {
        setPanels(prev => ({
            ...prev,
            [id]: { ...prev[id], size: newSize },
        }));
    };


    const renderVideoControlsAndChat = () => (
        <div className="relative w-full h-full">
            <DraggableResizablePanel
                id="chat"
                title="Video Preview & Chat"
                position={panels.chat.position}
                size={panels.chat.size}
                zIndex={panels.chat.zIndex}
                onDrag={handlePanelDrag}
                onResize={handlePanelResize}
                onFocus={handlePanelFocus}
            >
                <div className="h-full flex flex-col overflow-hidden">
                    <div className="flex-grow p-4 flex flex-col space-y-4 overflow-y-auto">
                        {currentVideoSession?.prompts.map(msg => (
                            <div key={msg.id} className={`flex flex-col gap-2 ${msg.role === MessageRole.User ? 'items-end' : 'items-start'}`}>
                                {msg.videoUrl ? (
                                    <div className="p-2 rounded-2xl bg-gray-700 max-w-sm"><video key={msg.videoUrl} controls autoPlay loop className="w-full rounded-lg"><source src={msg.videoUrl} type="video/mp4" /></video></div>
                                ) : (
                                    <div className={`p-3 rounded-xl max-w-sm break-words ${msg.role === MessageRole.User ? 'bg-sky-600 text-white' : msg.text.startsWith('Error:') ? 'bg-red-900/70 text-red-300' : 'bg-gray-700 text-gray-200'}`}>
                                        <p className="whitespace-pre-wrap text-sm">{msg.text.replace('Error: ', '')}</p>
                                        {msg.role === MessageRole.Model && !msg.text.startsWith('Error:') && <Translation text={msg.text} />}
                                    </div>
                                )}
                            </div>
                        ))}
                        {isLoading && <div className="flex items-start"><div className="p-4 rounded-2xl bg-gray-700 flex items-center gap-2"><LoadingSpinner /> <span className="text-sm text-gray-300">{loadingMessage}</span></div></div>}
                        {!isLoading && !currentVideoSession?.prompts.length && <div className="flex-grow flex items-center justify-center"><p className="text-gray-500 text-lg text-center">{((currentVideoSession?.referenceImages || []).filter(Boolean).length > 0) ? 'Describe the video you want to create.' : 'Add reference images or describe the video you want to generate.'}</p></div>}
                    </div>
                </div>
            </DraggableResizablePanel>
            
            <DraggableResizablePanel
                id="controls"
                title="Video Controls"
                position={panels.controls.position}
                size={panels.controls.size}
                zIndex={panels.controls.zIndex}
                onDrag={handlePanelDrag}
                onResize={handlePanelResize}
                onFocus={handlePanelFocus}
            >
                <div className="h-full flex flex-col">
                     <div className="p-4 border-b border-gray-700 flex items-center justify-between flex-shrink-0">
                        <div /> 
                        <button onClick={() => handleStartNewVideo()} disabled={isLoading} className="flex items-center gap-2 text-sm bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-3 rounded-md disabled:bg-gray-600 transition-colors"><PlusIcon /><span>New Video</span></button>
                     </div>
                     <div className="flex-grow p-4 space-y-4 overflow-y-auto">
                        <div className="space-y-2"><p className="text-sm font-medium text-gray-400">Resolution (Optional):</p><div className="flex gap-2"><button onClick={() => handleResolutionToggle('720p')} disabled={isLoading || !!currentVideoSession?.videoData} className={`px-3 py-1 text-sm rounded-md transition-colors ${videoResolution === '720p' ? 'bg-sky-600 text-white' : 'bg-gray-700 hover:bg-gray-600'} disabled:opacity-50 disabled:cursor-not-allowed`}>720p</button><button onClick={() => handleResolutionToggle('1080p')} disabled={isLoading || !!currentVideoSession?.videoData} className={`px-3 py-1 text-sm rounded-md transition-colors ${videoResolution === '1080p' ? 'bg-sky-600 text-white' : 'bg-gray-700 hover:bg-gray-600'} disabled:opacity-50 disabled:cursor-not-allowed`}>1080p</button></div></div>
                        <div className="space-y-2"><p className="text-sm font-medium text-gray-400">Aspect Ratio (Optional):</p><div className="flex flex-wrap gap-2"><button onClick={() => handleAspectRatioToggle('16:9')} disabled={isLoading || !!currentVideoSession?.videoData} className={`px-3 py-1 text-sm rounded-md transition-colors ${videoAspectRatio === '16:9' ? 'bg-sky-600 text-white' : 'bg-gray-700 hover:bg-gray-600'} disabled:opacity-50 disabled:cursor-not-allowed`}>16:9 (Landscape)</button><button onClick={() => handleAspectRatioToggle('9:16')} disabled={isLoading || !!currentVideoSession?.videoData} className={`px-3 py-1 text-sm rounded-md transition-colors ${videoAspectRatio === '9:16' ? 'bg-sky-600 text-white' : 'bg-gray-700 hover:bg-gray-600'} disabled:opacity-50 disabled:cursor-not-allowed`}>9:16 (Portrait)</button></div></div>
                        <div className="space-y-2">
                            <div className="flex justify-between items-center">
                                <p className="text-sm font-medium text-gray-400">Target Duration</p>
                                <p className="px-2 py-0.5 bg-gray-900 text-sky-400 text-xs font-mono rounded">{targetDuration}s</p>
                            </div>
                            <input
                                type="range"
                                min="1"
                                max="15"
                                step="1"
                                value={targetDuration}
                                onChange={(e) => setTargetDuration(Number(e.target.value))}
                                disabled={isLoading}
                                className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-sky-500 disabled:opacity-50 disabled:cursor-not-allowed"
                            />
                            <p className="text-xs text-gray-500 italic">Note: This is a hint to the model; actual duration may vary.</p>
                        </div>
                        <div className="space-y-2"><p className="text-sm font-medium text-gray-400">Reference Images (Optional):</p><div className="space-y-4"><div className="p-3 bg-gray-900/50 rounded-lg"><p className="text-xs font-semibold text-gray-300">Image-to-Video</p><p className="text-xs text-gray-500 mb-2">Provide one image to generate a video from it.</p><ImageUploadSlot label="Reference Image" image={currentVideoSession?.referenceImages?.[0] || null} onUpload={(e) => handleVideoFileChange(e, 0)} onRemove={() => handleRemoveVideoImage(0)} inputId="reference-image-upload" disabled={isLoading || !!currentVideoSession?.videoData || !!currentVideoSession?.referenceImages?.[1] || !!currentVideoSession?.referenceImages?.[2]} /></div><div className="p-3 bg-gray-900/50 rounded-lg"><p className="text-xs font-semibold text-gray-300">Transition Video</p><p className="text-xs text-gray-500 mb-2">Provide a start and end frame to generate a transition.</p><div className="grid grid-cols-2 gap-2"><ImageUploadSlot label="Start Frame" image={currentVideoSession?.referenceImages?.[1] || null} onUpload={(e) => handleVideoFileChange(e, 1)} onRemove={() => handleRemoveVideoImage(1)} inputId="start-frame-upload" disabled={isLoading || !!currentVideoSession?.videoData || !!currentVideoSession?.referenceImages?.[0]} /><ImageUploadSlot label="End Frame" image={currentVideoSession?.referenceImages?.[2] || null} onUpload={(e) => handleVideoFileChange(e, 2)} onRemove={() => handleRemoveVideoImage(2)} inputId="end-frame-upload" disabled={isLoading || !!currentVideoSession?.videoData || !!currentVideoSession?.referenceImages?.[0] || !currentVideoSession?.referenceImages?.[1]} /></div></div></div></div>
                     </div>
                    <form onSubmit={handlePromptSubmit} className="p-4 border-t border-gray-700 space-y-3 flex-shrink-0">
                        <div className="flex items-end bg-gray-700 rounded-lg"><div className="relative w-full"><textarea value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="A video of a running horse..." className="w-full bg-transparent p-3 pr-12 text-gray-200 focus:outline-none resize-none" rows={3} disabled={isLoading || !apiKeySelected} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handlePromptSubmit(e as any); }}} />{prompt.trim().length > 0 && <button type="button" onClick={handleTranslatePrompt} disabled={isTranslatingInput || isLoading} className="absolute bottom-2 right-2 p-1.5 rounded-full text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed" title="Translate prompt to English">{isTranslatingInput ? <LoadingSpinner /> : <TranslateIcon />}</button>}</div><button type="submit" disabled={!canSubmit()} className="p-3 text-sky-400 hover:text-sky-300 disabled:text-gray-500 disabled:cursor-not-allowed transition-colors"><SendIcon /></button></div>
                    </form>
                </div>
            </DraggableResizablePanel>
        </div>
    );
    
    const renderImageUI = () => (
        <>
            <TaggingModal
                image={taggingImageIndex !== null ? referenceImages[taggingImageIndex] : null}
                savedTags={savedTags}
                onClose={() => setTaggingImageIndex(null)}
                onSave={handleSaveTag}
            />
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-full">
                {/* Far Left Column: History */}
                <div className="lg:col-span-2 bg-gray-800 rounded-lg shadow-2xl flex flex-col">
                    <div className="p-4 border-b border-gray-700">
                        <h2 className="text-lg font-semibold text-sky-400">Prompt History</h2>
                    </div>
                    <div className="flex-grow p-4 space-y-2 overflow-y-auto">
                        {generatedImages.length > 0 ? (
                            [...generatedImages].reverse().map((genImage) => (
                                <div key={genImage.id} className="flex items-center justify-between p-2 bg-gray-700/50 rounded-md hover:bg-gray-700 transition-colors">
                                    <p className="text-sm text-gray-300 truncate pr-2 flex-1">{genImage.prompt || "Image Edit"}</p>
                                    <button 
                                        onClick={() => setSelectedGeneratedImage(genImage)}
                                        className="p-1 rounded-full hover:bg-sky-600 text-sky-400 hover:text-white transition-colors"
                                        title="View this generated image"
                                    >
                                        <ArrowRightIcon />
                                    </button>
                                </div>
                            ))
                        ) : (
                            <p className="text-xs text-gray-500 text-center py-4">Your prompt history will appear here.</p>
                        )}
                    </div>
                </div>
                
                {/* Middle Column: Controls */}
                <div className="lg:col-span-3 bg-gray-800 rounded-lg shadow-2xl flex flex-col">
                    <div className="p-4 border-b border-gray-700 flex items-center justify-between">
                        <h2 className="text-lg font-semibold text-sky-400">Image Controls</h2>
                        <button onClick={handleStartNewImageSession} disabled={isLoading || isUpscaling} className="flex items-center gap-2 text-sm bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-3 rounded-md disabled:bg-gray-600 transition-colors"><PlusIcon /><span>New Session</span></button>
                    </div>
                    <div className="flex-grow p-4 space-y-4 overflow-y-auto">
                        <div>
                            <p className="text-sm font-medium text-gray-300 mb-2">Artboard</p>
                            <div 
                                className={`p-3 bg-gray-900/50 rounded-lg transition-colors ${isDraggingOverArtboard ? 'border-2 border-dashed border-sky-500' : 'border-2 border-dashed border-transparent'}`}
                                onDrop={handleArtboardDrop}
                                onDragOver={handleArtboardDragOver}
                                onDragLeave={handleArtboardDragLeave}
                            >
                            <div className="relative aspect-video flex flex-col items-center justify-center bg-gray-700/50 border-2 border-dashed border-gray-600 rounded-md">
                                    {artboardImage ? (
                                        <>
                                            <img src={`data:${artboardImage.mimeType};base64,${artboardImage.base64}`} alt="Artboard content" className="w-full h-full object-contain rounded-md"/>
                                            <button onClick={() => setArtboardImage(null)} className="absolute top-1 right-1 bg-red-600 hover:bg-red-500 text-white rounded-full p-0 w-5 h-5 flex items-center justify-center text-xs font-bold transition-transform hover:scale-110" aria-label="Remove artboard image">&#x2715;</button>
                                        </>
                                    ) : (
                                        <label htmlFor="artboard-upload" className="cursor-pointer text-gray-400 hover:text-sky-400 transition-colors flex flex-col items-center p-4 text-center">
                                            <UploadIcon />
                                            <span className="text-xs mt-1">Upload or Drop from History</span>
                                        </label>
                                    )}
                            </div>
                            <input id="artboard-upload" type="file" accept="image/*" className="hidden" onChange={handleArtboardFileChange} ref={artboardUploadRef}/>
                            </div>
                        </div>
                        <div>
                            <p className="text-sm font-medium text-gray-300 mb-2">Reference Images (Drag to reorder)</p>
                            <div className="p-3 bg-gray-900/50 rounded-lg">
                            <div className="grid grid-cols-4 gap-2">
                                    {referenceImages.map((image, index) => (
                                        <div key={image?.id || index} onDrop={() => handleDrop(index)} onDragOver={handleDragOver} className="relative aspect-square flex flex-col items-center justify-center bg-gray-700/50 border-2 border-dashed border-gray-600 rounded-md transition-colors hover:border-sky-500">
                                            <span className="absolute top-1 left-1 bg-black/50 text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center z-10">{index + 1}</span>
                                            {image ? (
                                                <div draggable onDragStart={() => handleDragStart(index)} className="w-full h-full cursor-grab active:cursor-grabbing group">
                                                    <img src={`data:${image.file.mimeType};base64,${image.file.base64}`} alt={`reference ${index + 1}`} className="w-full h-full object-cover rounded-md"/>
                                                    <button onClick={() => handleRemoveReferenceImage(index)} className="absolute top-0 right-0 -mt-2 -mr-2 bg-red-600 hover:bg-red-500 text-white rounded-full p-0 w-5 h-5 flex items-center justify-center text-xs font-bold transition-transform hover:scale-110 z-20" aria-label={`Remove reference image ${index + 1}`}>&#x2715;</button>
                                                    
                                                    {image.tag && (
                                                        <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-white text-[10px] p-1 text-center truncate pointer-events-none z-10">
                                                            {image.tag}
                                                        </div>
                                                    )}
                                                    <button onClick={() => setTaggingImageIndex(index)} className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center z-10" aria-label={`Edit tag for reference image ${index + 1}`}>
                                                        <PencilIcon />
                                                    </button>
                                                </div>
                                            ) : (
                                                <button 
                                                    type="button" 
                                                    onClick={() => imageUploadRef.current?.click()}
                                                    className="cursor-pointer text-gray-400 hover:text-sky-400 transition-colors flex flex-col items-center"
                                                >
                                                    <PlusIcon />
                                                    <span className="text-xs mt-1">Add Image</span>
                                                </button>
                                            )}
                                        </div>
                                    ))}
                            </div>
                            <input id="image-upload" type="file" accept="image/*" className="hidden" onChange={handleImageFileChange} ref={imageUploadRef}/>
                            </div>
                        </div>
                        <div>
                            <p className="text-sm font-medium text-gray-300 mb-2">Generation Settings</p>
                            <div className="p-3 bg-gray-900/50 rounded-lg space-y-4">
                                <div>
                                    <label className="block text-xs font-semibold text-gray-400 mb-2">Aspect Ratio</label>
                                    <div className="grid grid-cols-5 gap-2">
                                        {(['1:1', '16:9', '9:16', '4:3', '3:4'] as const).map(ratio => (
                                            <button 
                                                key={ratio} 
                                                onClick={() => setAspectRatio(ratio)}
                                                disabled={isLoading || isUpscaling}
                                                className={`py-2 text-xs rounded-md transition-colors disabled:opacity-50 ${aspectRatio === ratio ? 'bg-sky-600 text-white' : 'bg-gray-700 hover:bg-gray-600'}`}
                                            >
                                                {ratio}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <form onSubmit={handlePromptSubmit} className="p-4 border-t border-gray-700 space-y-3">
                        <div className="flex items-end bg-gray-700 rounded-lg">
                        <div className="relative w-full">
                            <textarea value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="A cat in a spacesuit..." className="w-full bg-transparent p-3 pr-12 text-gray-200 focus:outline-none resize-none" rows={3} disabled={isLoading || isUpscaling} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handlePromptSubmit(e as any); }}} />
                            {prompt.trim().length > 0 && <button type="button" onClick={handleTranslatePrompt} disabled={isTranslatingInput || isLoading || isUpscaling} className="absolute bottom-2 right-2 p-1.5 rounded-full text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed" title="Translate prompt to English">{isTranslatingInput ? <LoadingSpinner /> : <TranslateIcon />}</button>}
                        </div>
                        <button type="submit" disabled={!canSubmit()} className="p-3 text-sky-400 hover:text-sky-300 disabled:text-gray-500 disabled:cursor-not-allowed transition-colors"><SendIcon /></button>
                        </div>
                    </form>
                </div>

                {/* Right Column: Preview & History */}
                <div className="lg:col-span-7 bg-gray-900 rounded-lg flex flex-col overflow-hidden p-4 gap-4">
                    {/* Main Preview */}
                    <div ref={previewContainerRef} className="flex-grow bg-black/20 rounded-lg flex items-center justify-center relative min-h-0 group">
                        {isLoading || isUpscaling ? (
                            <div className="flex flex-col items-center gap-4 text-center">
                            <LoadingSpinner />
                            <p className="text-gray-400">{loadingMessage || (isUpscaling ? 'Upscaling...' : 'Generating...')}</p>
                            </div>
                        ) : selectedGeneratedImage ? (
                            <>
                            <img src={selectedGeneratedImage.imageUrl} alt="Generated content" className="max-w-full max-h-full object-contain rounded-md" />
                            <div className="absolute top-2 right-2 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button onClick={handleUpscale} disabled={isLoading || isUpscaling} className="p-2 bg-gray-800/80 hover:bg-sky-600 rounded-full text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed" title="Upscale Image">
                                        {isUpscaling ? <LoadingSpinner /> : <UpscaleIcon />}
                                    </button>
                                    <a href={selectedGeneratedImage.imageUrl} download={`gemini-generated-${Date.now()}.png`} className="p-2 bg-gray-800/80 hover:bg-sky-600 rounded-full text-white transition-colors" title="Download Image"><DownloadIcon /></a>
                                    <button onClick={handleFullScreenToggle} className="p-2 bg-gray-800/80 hover:bg-sky-600 rounded-full text-white transition-colors" title={isFullScreen ? "Exit Fullscreen" : "Fullscreen"}>
                                        {isFullScreen ? <ExitFullScreenIcon /> : <FullScreenIcon />}
                                    </button>
                            </div>
                            </>
                        ) : (
                            <p className="text-gray-500 text-lg text-center">Your generated images will appear here</p>
                        )}
                    </div>
                    {/* History Strip */}
                    <div className="flex-shrink-0 h-28">
                        <h3 className="text-sm font-semibold text-gray-400 mb-2">History</h3>
                        <div className="h-full w-full bg-black/20 rounded-lg p-2 overflow-x-auto overflow-y-hidden flex items-center gap-2">
                            {generatedImages.length > 0 ? (
                                generatedImages.map(image => (
                                    <div 
                                    key={image.id}
                                    onClick={() => setSelectedGeneratedImage(image)} 
                                    draggable
                                    onDragStart={(e) => handleHistoryDragStart(e, image)}
                                    className={`cursor-pointer flex-shrink-0 h-full aspect-square rounded-md overflow-hidden relative transition-all duration-200 ${selectedGeneratedImage?.id === image.id ? 'ring-4 ring-sky-500' : 'ring-2 ring-transparent hover:ring-sky-600'}`}>
                                        <img src={image.imageUrl} alt="Generated history thumbnail" className="w-full h-full object-cover" />
                                    </div>
                                ))
                            ) : (
                                <div className="h-full w-full flex items-center justify-center">
                                    <p className="text-gray-600 text-sm">No images generated yet.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </>
    );

    return (
        <div className="flex flex-col max-w-full mx-auto h-[calc(100vh-100px)]">
            <div className="flex-shrink-0 bg-gray-800 rounded-lg shadow-2xl">
                <div className="p-4 border-b border-gray-700">
                    <div className="flex justify-center bg-gray-900 p-1 rounded-lg max-w-xs mx-auto">
                        <button onClick={() => setMode('image')} className={`w-1/2 py-2 text-center rounded-md transition-colors ${mode === 'image' ? 'bg-sky-600 text-white' : 'hover:bg-gray-700'}`}>Image</button>
                        <button onClick={() => setMode('video')} className={`w-1/2 py-2 text-center rounded-md transition-colors ${mode === 'video' ? 'bg-sky-600 text-white' : 'hover:bg-gray-700'}`}>Video</button>
                    </div>
                </div>
                {mode === 'video' && !apiKeySelected && <div className="p-4"><ApiKeySelector onKeySelected={() => setApiKeySelected(true)} /></div>}
            </div>

            <div className="flex-grow mt-6 relative min-h-0">
                {mode === 'image' ? renderImageUI() : renderVideoControlsAndChat()}
            </div>
            
            {error && !isLoading && (
              <div className="fixed bottom-4 right-4 max-w-md z-[9999] p-4 bg-red-900/50 text-red-300 rounded-lg text-sm">
                <strong>Error:</strong> {error}
              </div>
            )}
        </div>
    );
};

export default Generator;
