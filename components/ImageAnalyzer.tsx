import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI } from '@google/genai';
import { ChatMessage, MessageRole } from '../types';
import { LoadingSpinner } from './LoadingSpinner';
import { SendIcon } from './icons/SendIcon';
import { UploadIcon } from './icons/UploadIcon';
import { Translation } from './Translation';

interface ImageFile {
    base64: string;
    mimeType: string;
    name: string;
}

const ImageAnalyzer: React.FC = () => {
    const [image, setImage] = useState<ImageFile | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

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
            setImage({ base64, mimeType: file.type, name: file.name });
            setMessages([
                { id: `model-${Date.now()}`, role: MessageRole.Model, text: "Image loaded. What would you like to know about it?" }
            ]);
        }
    };
    
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || isLoading || !image) return;

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

            const imagePart = {
                inlineData: {
                    mimeType: image.mimeType,
                    data: image.base64,
                },
            };
            const textPart = { text: input };
            
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: { parts: [imagePart, textPart] },
            });

            const modelResponse: ChatMessage = { id: `model-${Date.now()}`, role: MessageRole.Model, text: response.text };
            setMessages((prev) => [...prev, modelResponse]);

        } catch (e) {
            const error = e as Error;
            console.error("Error analyzing image:", error);
            setError(`Analysis failed: ${error.message}`);
        } finally {
            setIsLoading(false);
        }
    };
    
    const reset = () => {
        setImage(null);
        setMessages([]);
        setInput('');
        setError(null);
    };

    if (!image) {
        return (
            <div className="flex flex-col items-center justify-center h-[calc(100vh-120px)] text-center p-4">
                <div className="max-w-md w-full p-8 bg-gray-800 rounded-xl shadow-2xl">
                    <h2 className="text-2xl font-bold text-sky-400 mb-4">Analyze an Image</h2>
                    <p className="text-gray-400 mb-6">Upload an image to start a conversation with Gemini about its contents.</p>
                    <label htmlFor="file-upload" className="cursor-pointer inline-flex items-center gap-3 bg-sky-600 hover:bg-sky-700 text-white font-bold py-3 px-6 rounded-lg transition-transform transform hover:scale-105">
                        <UploadIcon />
                        <span>Select Image</span>
                    </label>
                    <input id="file-upload" type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
                    {error && <p className="text-red-400 mt-4">{error}</p>}
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-[calc(100vh-120px)] max-w-5xl mx-auto bg-gray-800 rounded-lg shadow-2xl overflow-hidden">
            <div className="relative p-4 border-b border-gray-700 bg-black flex justify-center items-center">
                <img src={`data:${image.mimeType};base64,${image.base64}`} alt="Uploaded preview" className="max-h-64 object-contain rounded-lg shadow-lg"/>
                <button onClick={reset} className="absolute top-4 right-4 bg-red-600 hover:bg-red-700 text-white font-bold py-1 px-3 rounded-full text-xs transition-opacity opacity-70 hover:opacity-100">
                    Change Image
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
                        <div className="p-4 rounded-2xl bg-gray-700">
                           <LoadingSpinner />
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
                        placeholder="Ask about the image..."
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

export default ImageAnalyzer;