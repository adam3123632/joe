import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, Modality, ImageFile as GenAIImageFile } from '@google/genai';
import { LoadingSpinner } from './LoadingSpinner';
import { ApiKeySelector } from './ApiKeySelector';
import { UploadIcon } from './icons/UploadIcon';
import { PlusIcon } from './icons/PlusIcon';
import { SendIcon } from './icons/SendIcon';
import { ChatMessage, MessageRole } from '../types';
import { Translation } from './Translation';
import { TranslateIcon } from './icons/TranslateIcon';

type GenerationMode = 'image' | 'video';

interface ImageFile {
    base64: string;
    mimeType: string;
    name: string;
    width: number;
    height: number;
}

interface ReferenceImage {
    id: string;
    file: ImageFile;
    tag: string;
}

interface VideoSession {
    prompts: ChatMessage[];
    referenceImages: (ImageFile | null)[];
    videoData: any | null; // Stores the latest video data for modification
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
    
    // State for video settings
    const [videoResolution, setVideoResolution] = useState<'720p' | '1080p' | null>('720p');
    const [videoAspectRatio, setVideoAspectRatio] = useState<'16:9' | '9:16' | null>('16:9');

    // State for the active video creation session
    const [currentVideoSession, setCurrentVideoSession] = useState<VideoSession | null>(null);
    const [imageResultUrl, setImageResultUrl] = useState<string | null>(null);

    // State for image generation
    const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);
    const [editingTag, setEditingTag] = useState<{ id: string; currentTag: string } | null>(null);
    const imageUploadRef = useRef<HTMLInputElement>(null);
    
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (mode === 'video') {
            handleStartNewVideo(true); // Start fresh
            checkApiKey();
        } else {
            handleStartNewImage();
        }
    }, [mode]);
    
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [currentVideoSession?.prompts]);

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

    const getImageDimensions = (base64: string, mimeType: string): Promise<{ width: number, height: number }> => {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve({ width: img.width, height: img.height });
            img.onerror = (err) => reject(err);
            img.src = `data:${mimeType};base64,${base64}`;
        });
    };

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>, index: 0 | 1 | 2) => {
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

                // Enforce mutual exclusivity
                if (index === 0) { // Reference Image was set
                    newImages[1] = null;
                    newImages[2] = null;
                } else if (index === 1 || index === 2) { // Start/End Frame was set
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
            setReferenceImages(prev => [...prev, newImage]);
            if (imageUploadRef.current) {
                imageUploadRef.current.value = '';
            }
        }
    };

    const handleRemoveImage = (index: 0 | 1 | 2) => {
        setCurrentVideoSession(prev => {
            if (!prev) return null;
            const newImages = [...prev.referenceImages];
            newImages[index] = null;
            
            if (index === 1) {
                newImages[2] = null;
            }

            return {
                ...prev,
                referenceImages: newImages,
            };
        });
    };
    
    const handleRemoveReferenceImage = (id: string) => {
        setReferenceImages(prev => prev.filter(img => img.id !== id));
    };
    
    const handleUpdateTag = (id: string, newTag: string) => {
        setReferenceImages(prev => prev.map(img => img.id === id ? { ...img, tag: newTag } : img));
        setEditingTag(null);
    };

    const handlePromptSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        
        const currentPromptText = prompt;

        if (mode === 'image' && (referenceImages.length === 0 && !prompt.trim())) return;
        if (isLoading) return;

        if (mode === 'video') {
             if (!prompt.trim()) return;
            const userPrompt: ChatMessage = { id: `user-${Date.now()}`, role: MessageRole.User, text: currentPromptText };
             setCurrentVideoSession(prev => ({
                ...prev!,
                prompts: [...(prev?.prompts || []), userPrompt],
            }));
        }

        setPrompt('');
        setIsLoading(true);
        setError(null);

        try {
            if (mode === 'image') {
                await generateImage(currentPromptText);
            } else if (mode === 'video') {
                if (!apiKeySelected) throw new Error("API key not selected for video generation.");
                
                let isModification = false;
                setCurrentVideoSession(prev => {
                    isModification = !!prev?.videoData;
                    return prev;
                })

                if (isModification) {
                    await modifyVideo(currentPromptText);
                } else {
                    await generateVideo(currentPromptText);
                }
            }
        } catch (e) {
            const err = e as Error;
            console.error(`Error generating ${mode}:`, err);
            const errorMessage = `Generation failed: ${err.message}`;
            setError(errorMessage);
            if (mode === 'video') {
                const errorPrompt: ChatMessage = { id: `error-${Date.now()}`, role: MessageRole.Model, text: `Error: ${errorMessage}`};
                setCurrentVideoSession(prev => prev ? { ...prev, prompts: [...prev.prompts, errorPrompt] } : null);
            }

            if (mode === 'video' && err.message?.includes('Requested entity was not found')) {
                setError('API Key is invalid. Please select a new one.');
                setApiKeySelected(false);
            }
        } finally {
            setIsLoading(false);
            setLoadingMessage('');
        }
    };

    const generateImage = async (promptText: string) => {
        setLoadingMessage('Generating your image...');
        if (!process.env.API_KEY) throw new Error("API_KEY not set.");
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        
        const parts: (string | GenAIImageFile)[] = [];

        const tagDescriptions = referenceImages
            .map((img, index) => {
                if(img.tag) {
                    return `Use reference image ${index + 1} for the ${img.tag}.`;
                }
                return `Use reference image ${index + 1}.`;
            })
            .join(' ');
            
        const finalPrompt = [tagDescriptions, promptText].filter(Boolean).join('\n');
        
        parts.push({text: finalPrompt});

        referenceImages.forEach(refImg => {
            parts.push({
                inlineData: {
                    data: refImg.file.base64,
                    mimeType: refImg.file.mimeType
                }
            });
        });

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: { parts: parts },
            config: { responseModalities: [Modality.IMAGE] },
        });
        
        for (const part of response.candidates[0].content.parts) {
            if (part.inlineData) {
                const base64ImageBytes: string = part.inlineData.data;
                const imageUrl = `data:image/png;base64,${base64ImageBytes}`;
                setImageResultUrl(imageUrl);
                return;
            }
        }
        throw new Error("No image data received from API.");
    };

    const generateVideo = async (promptText: string) => {
        if (!process.env.API_KEY) throw new Error("API_KEY not set.");
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        
        setLoadingMessage('Initializing video generation... This may take a few minutes.');
        const refImage = currentVideoSession?.referenceImages?.[0];
        const startFrame = currentVideoSession?.referenceImages?.[1];
        const endFrame = currentVideoSession?.referenceImages?.[2];
        const primaryImage = startFrame || refImage;

        let finalAspectRatio: '16:9' | '9:16' = '16:9'; // Default
        if (videoAspectRatio) {
            finalAspectRatio = videoAspectRatio;
        } else if (primaryImage) {
            const imageRatio = primaryImage.width / primaryImage.height;
            finalAspectRatio = imageRatio >= 1 ? '16:9' : '9:16'; // Landscape or square -> 16:9, Portrait -> 9:16
        }

        const finalResolution: '720p' | '1080p' = videoResolution || '720p'; // Default to 720p if null
        
        const payload: any = {
            model: 'veo-3.1-fast-generate-preview',
            prompt: promptText,
            config: { 
                numberOfVideos: 1, 
                resolution: finalResolution, 
                aspectRatio: finalAspectRatio 
            }
        };
        
        if (startFrame) {
            payload.image = { imageBytes: startFrame.base64, mimeType: startFrame.mimeType };
            if (endFrame) {
                 payload.config.lastFrame = {
                    imageBytes: endFrame.base64,
                    mimeType: endFrame.mimeType,
                };
            }
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
        const downloadLink = generatedVideoData?.uri;
        if (!downloadLink) throw new Error("Video URI not found in response.");

        setLoadingMessage('Fetching generated video...');
        const videoResponse = await fetch(`${downloadLink}&key=${process.env.API_KEY}`);
        if(!videoResponse.ok) throw new Error(`Failed to fetch video: ${videoResponse.statusText}`);

        const videoBlob = await videoResponse.blob();
        const videoUrl = URL.createObjectURL(videoBlob);
        
        const videoMessage: ChatMessage = {
            id: `model-${Date.now()}`,
            role: MessageRole.Model,
            text: 'Generated Video',
            videoUrl: videoUrl,
        };
        
        setCurrentVideoSession(prev => ({
            ...prev!,
            videoData: generatedVideoData,
            prompts: [...(prev?.prompts || []), videoMessage]
        }));
    };

    const modifyVideo = async (promptText: string) => {
        const lastVideoData = currentVideoSession?.videoData;
        if (!lastVideoData) return;
        
        setLoadingMessage('Applying modifications to your video...');
        if (!process.env.API_KEY) throw new Error("API_KEY not set.");
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        
        let operation = await ai.models.generateVideos({
          model: 'veo-3.1-generate-preview',
          prompt: promptText,
          video: lastVideoData,
          config: {
            numberOfVideos: 1,
            resolution: '720p',
            aspectRatio: lastVideoData?.aspectRatio,
          }
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
        
        const videoMessage: ChatMessage = {
            id: `model-${Date.now()}`,
            role: MessageRole.Model,
            text: 'Modified Video',
            videoUrl: newUrl,
        };

        setCurrentVideoSession(prev => ({
            ...prev!,
            videoData: newVideoData,
            prompts: [...(prev?.prompts || []), videoMessage]
        }));
    };
    
    const handleStartNewImage = () => {
        setReferenceImages([]);
        setImageResultUrl(null);
        setPrompt('');
        setError(null);
        setIsLoading(false);
        setLoadingMessage('');
        setEditingTag(null);
    };

    const handleStartNewVideo = (isModeChange = false) => {
        if (currentVideoSession) {
            currentVideoSession.prompts.forEach(p => {
                if (p.videoUrl) URL.revokeObjectURL(p.videoUrl);
            });
        }
        setCurrentVideoSession({
            prompts: [],
            referenceImages: [null, null, null],
            videoData: null,
        });
        setImageResultUrl(null);
        setPrompt('');
        setError(null);
        setIsLoading(false);
        setLoadingMessage('');
        setVideoResolution('720p');
        setVideoAspectRatio('16:9');
    };

    const canSubmitVideo = () => {
        if (isLoading || !prompt.trim()) return false;
        if (mode === 'video' && !apiKeySelected) return false;
        return true;
    };
    
    const canSubmitImage = () => {
        if (isLoading) return false;
        return prompt.trim().length > 0 || referenceImages.length > 0;
    }

    const handleTranslatePrompt = async () => {
        if (!prompt.trim() || isTranslatingInput) return;

        setIsTranslatingInput(true);
        setError(null);

        try {
            if (!process.env.API_KEY) throw new Error("API_KEY not set.");
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const translationPrompt = `Translate the following text into English. Provide only the translated text, without any additional comments or explanations.\n\nText to translate: "${prompt}"`;

            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: translationPrompt,
            });

            const translatedText = response.text.trim();
            setPrompt(translatedText);
        } catch (e) {
            const err = e as Error;
            console.error("Input translation failed:", err);
            setError(`Translation failed: ${err.message}`);
        } finally {
            setIsTranslatingInput(false);
        }
    };

    const getVideoPlaceholderText = () => {
        if (currentVideoSession?.videoData) return 'Describe your modifications...';
        
        const images = currentVideoSession?.referenceImages || [];
        const hasRefImage = !!images[0];
        const hasStartFrame = !!images[1];
        const hasEndFrame = !!images[2];

        if (hasStartFrame && hasEndFrame) return 'Describe the transition between the frames...';
        if (hasStartFrame) return 'Add an end frame, or describe the video...';
        if (hasRefImage) return 'Describe the video to create from this image...';

        return 'A video of a running horse...';
    };

    const handleResolutionToggle = (res: '720p' | '1080p') => {
        setVideoResolution(prev => (prev === res ? null : res));
    };

    const handleAspectRatioToggle = (ratio: '16:9' | '9:16') => {
        setVideoAspectRatio(prev => (prev === ratio ? null : ratio));
    };

    const ImageTagEditor: React.FC<{
        image: ReferenceImage;
        onSave: (id: string, newTag: string) => void;
        onClose: () => void;
    }> = ({ image, onSave, onClose }) => {
        const [tagValue, setTagValue] = useState(image.tag);
        const presets = ['角色 (Character)', '场景 (Scene)', '道具 (Prop)'];

        const handleSave = () => {
            onSave(image.id, tagValue);
        };

        return (
            <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
                <div className="bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
                    <h3 className="text-lg font-semibold text-sky-400 mb-4">Edit Image Tag</h3>
                    <img src={`data:${image.file.mimeType};base64,${image.file.base64}`} alt="tag editing preview" className="w-full max-h-64 object-contain rounded-md mb-4"/>
                    <div className="space-y-2 mb-4">
                        <label htmlFor="tag-input" className="text-sm font-medium text-gray-300">Tag:</label>
                        <input
                            id="tag-input"
                            type="text"
                            value={tagValue}
                            onChange={(e) => setTagValue(e.target.value)}
                            placeholder="e.g., Character, Scene..."
                            className="w-full bg-gray-700 p-2 rounded-md text-white focus:ring-2 focus:ring-sky-500 focus:outline-none"
                        />
                    </div>
                    <div className="flex flex-wrap gap-2 mb-6">
                        {presets.map(preset => (
                            <button key={preset} onClick={() => setTagValue(preset)} className="px-3 py-1 text-xs bg-gray-600 hover:bg-sky-600 rounded-full transition-colors">
                                {preset}
                            </button>
                        ))}
                    </div>
                    <div className="flex justify-end gap-3">
                        <button onClick={onClose} className="px-4 py-2 text-sm bg-gray-600 hover:bg-gray-500 rounded-md transition-colors">Cancel</button>
                        <button onClick={handleSave} className="px-4 py-2 text-sm bg-sky-600 hover:bg-sky-700 rounded-md transition-colors">Save</button>
                    </div>
                </div>
            </div>
        );
    };
    
    const renderVideoControlsAndChat = () => (
        <>
            {/* CHAT/RESULT PANE */}
            <div className="lg:col-span-3 bg-gray-900 rounded-lg flex flex-col overflow-hidden">
                <div className="flex-grow p-4 flex flex-col space-y-4 overflow-y-auto">
                    {currentVideoSession?.prompts.map(msg => (
                        <div key={msg.id} className={`flex flex-col gap-2 ${msg.role === MessageRole.User ? 'items-end' : 'items-start'}`}>
                            {msg.videoUrl ? (
                                <div className="p-2 rounded-2xl bg-gray-700 max-w-sm">
                                    <video key={msg.videoUrl} controls autoPlay loop className="w-full rounded-lg">
                                        <source src={msg.videoUrl} type="video/mp4" />
                                    </video>
                                </div>
                            ) : (
                                <div className={`p-3 rounded-xl max-w-sm break-words ${
                                    msg.role === MessageRole.User 
                                        ? 'bg-sky-600 text-white' 
                                        : msg.text.startsWith('Error:') ? 'bg-red-900/70 text-red-300' : 'bg-gray-700 text-gray-200'
                                }`}>
                                    <p className="whitespace-pre-wrap text-sm">{msg.text.replace('Error: ', '')}</p>
                                    {msg.role === MessageRole.User && <Translation text={msg.text} />}
                                </div>
                            )}
                        </div>
                    ))}
                    
                    {isLoading && (
                        <div className="flex items-start">
                             <div className="p-4 rounded-2xl bg-gray-700">
                                <LoadingSpinner />
                             </div>
                        </div>
                    )}

                    {!isLoading && !currentVideoSession?.prompts.length && (
                         <div className="flex-grow flex items-center justify-center">
                            <p className="text-gray-500 text-lg text-center">
                                {((currentVideoSession?.referenceImages || []).filter(Boolean).length > 0) ? 'Describe the video you want to create.' : 'Add reference images or describe the video you want to generate.'}
                            </p>
                        </div>
                    )}
                    
                    <div ref={messagesEndRef} />
                </div>
            </div>

             {/* CONTROLS PANE */}
            <div className="lg:col-span-2 bg-gray-800 rounded-lg shadow-2xl flex flex-col">
                 <div className="p-4 border-b border-gray-700 flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-sky-400">Video Controls</h2>
                    <button onClick={() => handleStartNewVideo()} disabled={isLoading} className="flex items-center gap-2 text-sm bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-3 rounded-md disabled:bg-gray-600 transition-colors">
                        <PlusIcon />
                        <span>New Video</span>
                    </button>
                 </div>
                 <div className="flex-grow p-4 space-y-4 overflow-y-auto">
                    <div className="space-y-2">
                        <p className="text-sm font-medium text-gray-400">Resolution (Optional):</p>
                        <div className="flex gap-2">
                            <button 
                                onClick={() => handleResolutionToggle('720p')}
                                disabled={isLoading || !!currentVideoSession?.videoData}
                                className={`px-3 py-1 text-sm rounded-md transition-colors ${videoResolution === '720p' ? 'bg-sky-600 text-white' : 'bg-gray-700 hover:bg-gray-600'} disabled:opacity-50 disabled:cursor-not-allowed`}
                            >
                                720p
                            </button>
                            <button 
                                onClick={() => handleResolutionToggle('1080p')}
                                disabled={isLoading || !!currentVideoSession?.videoData}
                                className={`px-3 py-1 text-sm rounded-md transition-colors ${videoResolution === '1080p' ? 'bg-sky-600 text-white' : 'bg-gray-700 hover:bg-gray-600'} disabled:opacity-50 disabled:cursor-not-allowed`}
                            >
                                1080p
                            </button>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <p className="text-sm font-medium text-gray-400">Aspect Ratio (Optional):</p>
                        <div className="flex flex-wrap gap-2">
                            <button 
                                onClick={() => handleAspectRatioToggle('16:9')}
                                disabled={isLoading || !!currentVideoSession?.videoData}
                                className={`px-3 py-1 text-sm rounded-md transition-colors ${videoAspectRatio === '16:9' ? 'bg-sky-600 text-white' : 'bg-gray-700 hover:bg-gray-600'} disabled:opacity-50 disabled:cursor-not-allowed`}
                            >
                                16:9 (Landscape)
                            </button>
                            <button 
                                onClick={() => handleAspectRatioToggle('9:16')}
                                disabled={isLoading || !!currentVideoSession?.videoData}
                                className={`px-3 py-1 text-sm rounded-md transition-colors ${videoAspectRatio === '9:16' ? 'bg-sky-600 text-white' : 'bg-gray-700 hover:bg-gray-600'} disabled:opacity-50 disabled:cursor-not-allowed`}
                            >
                                9:16 (Portrait)
                            </button>
                        </div>
                    </div>
                     <div className="space-y-2">
                        <p className="text-sm font-medium text-gray-400">Reference Images (Optional):</p>
                         <div className="space-y-4">
                            <div className="p-3 bg-gray-900/50 rounded-lg">
                                <p className="text-xs font-semibold text-gray-300">Image-to-Video</p>
                                <p className="text-xs text-gray-500 mb-2">Provide one image to generate a video from it.</p>
                                <ImageUploadSlot
                                    label="Reference Image"
                                    image={currentVideoSession?.referenceImages?.[0] || null}
                                    onUpload={(e) => handleFileChange(e, 0)}
                                    onRemove={() => handleRemoveImage(0)}
                                    inputId="reference-image-upload"
                                    disabled={isLoading || !!currentVideoSession?.videoData || !!currentVideoSession?.referenceImages?.[1] || !!currentVideoSession?.referenceImages?.[2]}
                                />
                            </div>
                            <div className="p-3 bg-gray-900/50 rounded-lg">
                                <p className="text-xs font-semibold text-gray-300">Transition Video</p>
                                <p className="text-xs text-gray-500 mb-2">Provide a start and end frame to generate a transition.</p>
                                <div className="grid grid-cols-2 gap-2">
                                    <ImageUploadSlot
                                        label="Start Frame"
                                        image={currentVideoSession?.referenceImages?.[1] || null}
                                        onUpload={(e) => handleFileChange(e, 1)}
                                        onRemove={() => handleRemoveImage(1)}
                                        inputId="start-frame-upload"
                                        disabled={isLoading || !!currentVideoSession?.videoData || !!currentVideoSession?.referenceImages?.[0]}
                                    />
                                    <ImageUploadSlot
                                        label="End Frame"
                                        image={currentVideoSession?.referenceImages?.[2] || null}
                                        onUpload={(e) => handleFileChange(e, 2)}
                                        onRemove={() => handleRemoveImage(2)}
                                        inputId="end-frame-upload"
                                        disabled={isLoading || !!currentVideoSession?.videoData || !!currentVideoSession?.referenceImages?.[0] || !currentVideoSession?.referenceImages?.[1]}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                 </div>
                <form onSubmit={handlePromptSubmit} className="p-4 border-t border-gray-700 space-y-3">
                    <div className="flex items-end bg-gray-700 rounded-lg">
                        <div className="relative w-full">
                            <textarea
                                value={prompt}
                                onChange={e => setPrompt(e.target.value)}
                                placeholder={getVideoPlaceholderText()}
                                className="w-full bg-transparent p-3 pr-12 text-gray-200 focus:outline-none resize-none"
                                rows={3}
                                disabled={isLoading || !apiKeySelected}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        handlePromptSubmit(e as any);
                                    }
                                }}
                            />
                             {prompt.trim().length > 0 && (
                                <button
                                    type="button"
                                    onClick={handleTranslatePrompt}
                                    disabled={isTranslatingInput || isLoading}
                                    className="absolute bottom-2 right-2 p-1.5 rounded-full text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    title="Translate prompt to English"
                                >
                                    {isTranslatingInput ? <LoadingSpinner /> : <TranslateIcon />}
                                </button>
                            )}
                        </div>
                        <button type="submit" disabled={!canSubmitVideo()} className="p-3 text-sky-400 hover:text-sky-300 disabled:text-gray-500 disabled:cursor-not-allowed transition-colors">
                            <SendIcon />
                        </button>
                    </div>
                </form>
            </div>
        </>
    );
    
    const renderImageControlsAndResult = () => (
        <>
            {editingTag && (
                <ImageTagEditor 
                    image={referenceImages.find(img => img.id === editingTag.id)!}
                    onSave={handleUpdateTag}
                    onClose={() => setEditingTag(null)}
                />
            )}
            {/* CONTROLS PANE */}
            <div className="lg:col-span-2 bg-gray-800 rounded-lg shadow-2xl flex flex-col p-4">
                <div className="flex-grow flex flex-col space-y-4">
                    <div className="flex items-center justify-between">
                         <h3 className="text-xl font-bold text-sky-400">Image Generation</h3>
                         <button onClick={handleStartNewImage} disabled={isLoading} className="flex items-center gap-2 text-sm bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-3 rounded-md disabled:bg-gray-600 transition-colors">
                            <span>Clear All</span>
                        </button>
                    </div>
                   
                    <div>
                        <p className="text-sm font-medium text-gray-300 mb-2">Reference Images</p>
                        <div className="p-3 bg-gray-900/50 rounded-lg min-h-[120px]">
                            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                                {referenceImages.map(image => (
                                    <div key={image.id} className="relative group">
                                        <img 
                                            src={`data:${image.file.mimeType};base64,${image.file.base64}`} 
                                            alt="reference thumbnail" 
                                            className="w-full h-24 object-cover rounded-md cursor-pointer transition-transform group-hover:scale-105"
                                            onClick={() => setEditingTag({ id: image.id, currentTag: image.tag })}
                                        />
                                        <div 
                                            className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity rounded-md cursor-pointer"
                                            onClick={() => setEditingTag({ id: image.id, currentTag: image.tag })}
                                        >
                                            <p className="text-white text-xs text-center font-bold">{image.tag || 'Add Tag'}</p>
                                        </div>
                                        <button 
                                            onClick={() => handleRemoveReferenceImage(image.id)}
                                            className="absolute top-0 right-0 -mt-2 -mr-2 bg-red-600 hover:bg-red-500 text-white rounded-full p-0 w-5 h-5 flex items-center justify-center text-xs font-bold transition-transform hover:scale-110"
                                        >
                                            &#x2715;
                                        </button>
                                    </div>
                                ))}
                                <label htmlFor="image-upload" className="w-full h-24 bg-gray-700/50 border-2 border-dashed border-gray-600 rounded-md flex flex-col items-center justify-center cursor-pointer hover:bg-gray-700 hover:border-sky-500 transition-colors">
                                    <PlusIcon />
                                    <span className="text-xs mt-1 text-gray-400">Add Image</span>
                                </label>
                                <input id="image-upload" type="file" accept="image/*" className="hidden" onChange={handleImageFileChange} ref={imageUploadRef}/>
                            </div>
                        </div>
                    </div>
                    
                    <form onSubmit={handlePromptSubmit} className="space-y-3">
                         <div>
                            <p className="text-sm font-medium text-gray-300 mb-2">Prompt</p>
                            <div className="relative">
                               <textarea
                                    value={prompt}
                                    onChange={e => setPrompt(e.target.value)}
                                    placeholder="A photorealistic image of..."
                                    className="w-full p-3 pr-12 bg-gray-700 rounded-md h-28 resize-y focus:ring-2 focus:ring-sky-500 focus:outline-none transition"
                                    disabled={isLoading}
                                />
                                {prompt.trim().length > 0 && (
                                    <button
                                        type="button"
                                        onClick={handleTranslatePrompt}
                                        disabled={isTranslatingInput || isLoading}
                                        className="absolute top-2 right-2 p-1.5 rounded-full text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        title="Translate prompt to English"
                                    >
                                        {isTranslatingInput ? <LoadingSpinner /> : <TranslateIcon />}
                                    </button>
                                )}
                            </div>
                        </div>
                        <button type="submit" disabled={!canSubmitImage()} className="w-full bg-sky-600 hover:bg-sky-700 text-white font-bold py-3 px-4 rounded-md disabled:bg-gray-600 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2">
                            {isLoading ? <LoadingSpinner /> : 'Generate'}
                        </button>
                    </form>
                </div>
            </div>

            {/* RESULT PANE */}
            <div className="lg:col-span-3 bg-gray-900 rounded-lg flex items-center justify-center p-4">
                {error && !isLoading && <div className="p-4 bg-red-900/50 text-red-300 rounded-md">{error}</div>}
                {!error && (isLoading ? (
                    <div className="text-center">
                        <LoadingSpinner />
                        <p className="mt-4 text-gray-400">{loadingMessage || `Generating ${mode}...`}</p>
                    </div>
                ) : imageResultUrl ? (
                    <img src={imageResultUrl} alt="Generated content" className="max-w-full max-h-[70vh] rounded-md object-contain" />
                ) : (
                    <p className="text-gray-500 text-lg text-center px-6">Your generated image will appear here. <br/> Add reference images or a prompt to begin.</p>
                ))}
            </div>
        </>
    );

    return (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 max-w-7xl mx-auto h-[calc(100vh-100px)]">
            <div className="lg:col-span-5 bg-gray-800 rounded-lg shadow-2xl flex flex-col">
                <div className="p-4 border-b border-gray-700">
                    <div className="flex justify-center bg-gray-900 p-1 rounded-lg max-w-xs mx-auto">
                        <button onClick={() => setMode('image')} className={`w-1/2 py-2 text-center rounded-md transition-colors ${mode === 'image' ? 'bg-sky-600 text-white' : 'hover:bg-gray-700'}`}>Image</button>
                        <button onClick={() => setMode('video')} className={`w-1/2 py-2 text-center rounded-md transition-colors ${mode === 'video' ? 'bg-sky-600 text-white' : 'hover:bg-gray-700'}`}>Video</button>
                    </div>
                </div>
                
                 {mode === 'video' && !apiKeySelected && <div className="p-4"><ApiKeySelector onKeySelected={() => setApiKeySelected(true)} /></div>}
            </div>

            {mode === 'video' ? renderVideoControlsAndChat() : renderImageControlsAndResult()}
        </div>
    );
};

export default Generator;
