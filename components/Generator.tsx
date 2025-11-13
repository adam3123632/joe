
import React, { useState, useEffect } from 'react';
import { GoogleGenAI, Modality } from '@google/genai';
import { LoadingSpinner } from './LoadingSpinner';
import { ApiKeySelector } from './ApiKeySelector';
import { UploadIcon } from './icons/UploadIcon';

type GenerationMode = 'image' | 'video';

interface ImageFile {
    base64: string;
    mimeType: string;
    name: string;
}

const Generator: React.FC = () => {
    const [mode, setMode] = useState<GenerationMode>('image');
    const [prompt, setPrompt] = useState('');
    const [referenceImage, setReferenceImage] = useState<ImageFile | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<string | null>(null);
    const [loadingMessage, setLoadingMessage] = useState('');
    const [apiKeySelected, setApiKeySelected] = useState(false);

    useEffect(() => {
        if (mode === 'video') {
            checkApiKey();
        }
        setReferenceImage(null); // Reset reference image when switching modes
        setResult(null);
        setError(null);
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

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            if (!file.type.startsWith('image/')) {
                setError("Please upload a valid image file.");
                return;
            }
            setError(null);
            const base64 = await fileToBase64(file);
            setReferenceImage({ base64, mimeType: file.type, name: file.name });
            event.target.value = ''; // Allow re-uploading the same file
        }
    };

    const handleGenerate = async () => {
        setIsLoading(true);
        setError(null);
        setResult(null);

        try {
            if (mode === 'image') {
                await generateImage();
            } else {
                if (!apiKeySelected) {
                    throw new Error("API key not selected for video generation.");
                }
                await generateVideo();
            }
        } catch(e) {
            const err = e as Error;
            console.error(`Error generating ${mode}:`, err);
            setError(`Generation failed: ${err.message}`);
             if (mode === 'video' && err.message?.includes('Requested entity was not found')) {
                setError('API Key is invalid. Please select a new one.');
                setApiKeySelected(false);
            }
        } finally {
            setIsLoading(false);
            setLoadingMessage('');
        }
    };

    const generateImage = async () => {
        setLoadingMessage('Generating your image...');
        if (!process.env.API_KEY) throw new Error("API_KEY not set.");
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image', // nano banana
            contents: { parts: [{ text: prompt }] },
            config: {
                responseModalities: [Modality.IMAGE],
            },
        });
        
        for (const part of response.candidates[0].content.parts) {
            if (part.inlineData) {
                const base64ImageBytes: string = part.inlineData.data;
                const imageUrl = `data:image/png;base64,${base64ImageBytes}`;
                setResult(imageUrl);
                return;
            }
        }
        throw new Error("No image data received from API.");
    };

    const generateVideo = async () => {
        if (!process.env.API_KEY) throw new Error("API_KEY not set.");
        // Re-create instance to ensure latest key is used
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        
        setLoadingMessage('Initializing video generation... This may take a few minutes.');
        
        const payload: any = {
            model: 'veo-3.1-fast-generate-preview',
            prompt: prompt,
            config: { numberOfVideos: 1, resolution: '720p', aspectRatio: '16:9' }
        };

        if (referenceImage) {
            payload.image = {
                imageBytes: referenceImage.base64,
                mimeType: referenceImage.mimeType,
            };
        }

        let operation = await ai.models.generateVideos(payload);

        setLoadingMessage('Video generation in progress... Polling for results.');
        while (!operation.done) {
            await new Promise(resolve => setTimeout(resolve, 10000)); // Poll every 10 seconds
            operation = await ai.operations.getVideosOperation({ operation: operation });
        }

        const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
        if (!downloadLink) throw new Error("Video URI not found in response.");
        
        setLoadingMessage('Fetching generated video...');
        const videoResponse = await fetch(`${downloadLink}&key=${process.env.API_KEY}`);
        if(!videoResponse.ok) throw new Error(`Failed to fetch video: ${videoResponse.statusText}`);

        const videoBlob = await videoResponse.blob();
        setResult(URL.createObjectURL(videoBlob));
    };
    
    const canGenerate = () => {
        if (isLoading) return false;
        if (mode === 'image') return !!prompt.trim();
        if (mode === 'video') {
            if (!apiKeySelected) return false;
            return !!prompt.trim() || !!referenceImage;
        }
        return false;
    };

    return (
        <div className="max-w-4xl mx-auto p-6 bg-gray-800 rounded-lg shadow-2xl">
            <div className="flex justify-center mb-6 bg-gray-900 p-1 rounded-lg">
                <button onClick={() => setMode('image')} className={`w-1/2 py-2 text-center rounded-md transition-colors ${mode === 'image' ? 'bg-sky-600 text-white' : 'hover:bg-gray-700'}`}>Image</button>
                <button onClick={() => setMode('video')} className={`w-1/2 py-2 text-center rounded-md transition-colors ${mode === 'video' ? 'bg-sky-600 text-white' : 'hover:bg-gray-700'}`}>Video</button>
            </div>

            {mode === 'video' && !apiKeySelected && <ApiKeySelector onKeySelected={() => setApiKeySelected(true)} />}

            {mode === 'video' && (
                <div className="mb-4">
                    {referenceImage ? (
                        <div className="relative inline-block border-2 border-sky-500 rounded-lg p-1 bg-gray-900/50">
                            <img src={`data:${referenceImage.mimeType};base64,${referenceImage.base64}`} alt="Reference preview" className="h-28 rounded-md"/>
                            <button 
                                onClick={() => setReferenceImage(null)} 
                                className="absolute top-0 right-0 -mt-2 -mr-2 bg-red-600 hover:bg-red-500 text-white rounded-full p-0 w-6 h-6 flex items-center justify-center text-xs font-bold transition-transform hover:scale-110"
                                aria-label="Remove reference image"
                            >
                                &#x2715;
                            </button>
                        </div>
                    ) : (
                        <div>
                             <label htmlFor="ref-image-upload" className={`cursor-pointer inline-flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-white font-medium py-2 px-4 rounded-lg transition-colors ${isLoading || !apiKeySelected ? 'opacity-50 cursor-not-allowed' : ''}`}>
                                <UploadIcon />
                                <span>Add Reference Image (Optional)</span>
                            </label>
                            <input id="ref-image-upload" type="file" accept="image/*" className="hidden" onChange={handleFileChange} disabled={isLoading || !apiKeySelected} />
                        </div>
                    )}
                </div>
            )}

            <div className="space-y-4">
                <textarea
                    value={prompt}
                    onChange={e => setPrompt(e.target.value)}
                    placeholder={
                        mode === 'image'
                            ? 'Enter a prompt to generate an image...'
                            : referenceImage
                                ? 'Add a prompt to guide the video generation (optional)...'
                                : 'Enter a prompt to generate a video...'
                    }
                    className="w-full p-3 bg-gray-700 rounded-md h-24 focus:ring-2 focus:ring-sky-500 focus:outline-none transition"
                    disabled={isLoading || (mode === 'video' && !apiKeySelected)}
                />
                <button
                    onClick={handleGenerate}
                    disabled={!canGenerate()}
                    className="w-full bg-sky-600 hover:bg-sky-700 text-white font-bold py-3 px-4 rounded-md disabled:bg-gray-600 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
                >
                    {isLoading ? <LoadingSpinner /> : 'Generate'}
                </button>
            </div>

            {error && <div className="mt-6 p-4 bg-red-900/50 text-red-300 rounded-md">{error}</div>}

            <div className="mt-6 p-4 bg-gray-900 rounded-lg min-h-[300px] flex items-center justify-center">
                {isLoading ? (
                    <div className="text-center">
                        <LoadingSpinner />
                        <p className="mt-4 text-gray-400">{loadingMessage || `Generating ${mode}...`}</p>
                    </div>
                ) : result ? (
                    mode === 'image' ? (
                        <img src={result} alt="Generated content" className="max-w-full max-h-[500px] rounded-md object-contain" />
                    ) : (
                        <video src={result} controls className="max-w-full rounded-md" />
                    )
                ) : (
                    <p className="text-gray-500">Your generated content will appear here.</p>
                )}
            </div>
        </div>
    );
};

export default Generator;
