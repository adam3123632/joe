
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, ImageFile as GenAIImageFile } from '@google/genai';
import { ChatMessage, MessageRole } from '../types';
import { LoadingSpinner } from './LoadingSpinner';
import { SendIcon } from './icons/SendIcon';
import { UploadIcon } from './icons/UploadIcon';
import { Translation } from './Translation';

const FRAME_COUNT = 10; // Number of frames to extract

const VideoAnalyzer: React.FC = () => {
    const [videoUrl, setVideoUrl] = useState<string | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [loadingMessage, setLoadingMessage] = useState('');
    const [error, setError] = useState<string | null>(null);

    const videoRef = useRef<HTMLVideoElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);
    
    // Clean up blob URL on component unmount
    useEffect(() => {
        return () => {
            if (videoUrl) {
                URL.revokeObjectURL(videoUrl);
            }
        };
    }, [videoUrl]);

    const extractFrames = useCallback(async (videoElement: HTMLVideoElement, frameCount: number): Promise<GenAIImageFile[]> => {
        return new Promise(async (resolve, reject) => {
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            if (!context) {
                return reject(new Error("Failed to get canvas context."));
            }

            const frames: GenAIImageFile[] = [];
            const duration = videoElement.duration;
            const interval = duration / frameCount;
            canvas.width = videoElement.videoWidth;
            canvas.height = videoElement.videoHeight;

            let framesExtracted = 0;

            videoElement.currentTime = 0;
            await new Promise(r => videoElement.onseeked = r);

            for (let i = 0; i < frameCount; i++) {
                const time = i * interval;
                videoElement.currentTime = time;

                await new Promise<void>(r => {
                    const onSeeked = () => {
                        videoElement.removeEventListener('seeked', onSeeked);
                        r();
                    };
                    videoElement.addEventListener('seeked', onSeeked);
                });

                context.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
                const dataUrl = canvas.toDataURL('image/jpeg');
                const base64Data = dataUrl.split(',')[1];
                
                frames.push({
                    inlineData: {
                        data: base64Data,
                        mimeType: 'image/jpeg',
                    }
                });

                framesExtracted++;
                if (framesExtracted === frameCount) {
                    videoElement.currentTime = 0; // Reset video to start
                    resolve(frames);
                }
            }
        });
    }, []);

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            if (!file.type.startsWith('video/')) {
                setError("Please upload a valid video file.");
                return;
            }
            setError(null);
            const url = URL.createObjectURL(file);
            setVideoUrl(url);
            setMessages([
                { id: `model-${Date.now()}`, role: MessageRole.Model, text: "Video loaded. What would you like to know about it?" }
            ]);
        }
    };
    
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || isLoading || !videoRef.current) return;

        const userMessage: ChatMessage = { id: `user-${Date.now()}`, role: MessageRole.User, text: input };
        setMessages((prev) => [...prev, userMessage]);
        setInput('');
        setIsLoading(true);
        setError(null);
        
        try {
            if (!process.env.API_KEY) {
                throw new Error("API_KEY environment variable not set.");
            }
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

            setLoadingMessage('Extracting frames from video...');
            const frames = await extractFrames(videoRef.current, FRAME_COUNT);
            setLoadingMessage('Analyzing video...');

            const textPart = { text: input };
            const contents = { parts: [textPart, ...frames] };
            
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: contents,
            });

            const modelResponse: ChatMessage = { id: `model-${Date.now()}`, role: MessageRole.Model, text: response.text };
            setMessages((prev) => [...prev, modelResponse]);

        } catch (e) {
            const error = e as Error;
            console.error("Error analyzing video:", error);
            setError(`Analysis failed: ${error.message}`);
        } finally {
            setIsLoading(false);
            setLoadingMessage('');
        }
    };
    
    const reset = () => {
        if (videoUrl) URL.revokeObjectURL(videoUrl);
        setVideoUrl(null);
        setMessages([]);
        setInput('');
        setError(null);
    };

    if (!videoUrl) {
        return (
            <div className="flex flex-col items-center justify-center h-[calc(100vh-120px)] text-center p-4">
                <div className="max-w-md w-full p-8 bg-gray-800 rounded-xl shadow-2xl">
                    <h2 className="text-2xl font-bold text-sky-400 mb-4">Analyze a Video</h2>
                    <p className="text-gray-400 mb-6">Upload a video to start a conversation with Gemini about its contents.</p>
                    <label htmlFor="file-upload" className="cursor-pointer inline-flex items-center gap-3 bg-sky-600 hover:bg-sky-700 text-white font-bold py-3 px-6 rounded-lg transition-transform transform hover:scale-105">
                        <UploadIcon />
                        <span>Select Video</span>
                    </label>
                    <input id="file-upload" type="file" accept="video/*" className="hidden" onChange={handleFileChange} />
                    {error && <p className="text-red-400 mt-4">{error}</p>}
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-[calc(100vh-120px)] max-w-5xl mx-auto bg-gray-800 rounded-lg shadow-2xl overflow-hidden">
            <div className="relative p-4 border-b border-gray-700 bg-black flex justify-center items-center">
                <video ref={videoRef} src={videoUrl} controls className="max-h-64 object-contain rounded-lg shadow-lg"/>
                <button onClick={reset} className="absolute top-4 right-4 bg-red-600 hover:bg-red-700 text-white font-bold py-1 px-3 rounded-full text-xs transition-opacity opacity-70 hover:opacity-100">
                    Change Video
                </button>
            </div>
            <div className="flex-grow p-6 overflow-y-auto space-y-6">
                {messages.map((msg) => (
                    <div key={msg.id} className={`flex items-end gap-3 ${msg.role === MessageRole.User ? 'justify-end' : 'justify-start'}`}>
                        <div className={`p-4 rounded-2xl max-w-sm md:max-w-md break-words ${msg.role === MessageRole.User ? 'bg-sky-600 text-white rounded-br-none' : 'bg-gray-700 text-gray-200 rounded-bl-none'}`}>
                            <p className="whitespace-pre-wrap">{msg.text}</p>
                             {msg.role === MessageRole.Model && <Translation text={msg.text} />}
                        </div>
                    </div>
                ))}
                {isLoading && (
                    <div className="flex justify-start">
                        <div className="p-4 rounded-2xl bg-gray-700 flex items-center gap-2">
                           <LoadingSpinner />
                           <span className="text-sm text-gray-300">{loadingMessage}</span>
                        </div>
                    </div>
                )}
                {error && (
                    <div className="flex justify-center">
                       <p className="text-red-400 bg-red-900/50 p-3 rounded-lg">{error}</p>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>
             <form onSubmit={handleSubmit} className="p-4 border-t border-gray-700 bg-gray-900/50">
                <div className="flex items-center bg-gray-700 rounded-full">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Ask about the video..."
                        className="w-full bg-transparent p-4 text-gray-200 focus:outline-none"
                        disabled={isLoading}
                    />
                    <button type="submit" disabled={isLoading || !input.trim()} className="p-3 text-sky-400 hover:text-sky-300 disabled:text-gray-500 disabled:cursor-not-allowed transition-colors">
                        <SendIcon />
                    </button>
                </div>
            </form>
        </div>
    );
};

export default VideoAnalyzer;
