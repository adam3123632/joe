
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, Chat } from '@google/genai';
import { ChatMessage, MessageRole } from '../types';
import { LoadingSpinner } from './LoadingSpinner';
import { SendIcon } from './icons/SendIcon';

const Chatbot: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: MessageRole.Model, text: "Hello! How can I help you today?" }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chatRef = useRef<Chat | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);
  
  const initializeChat = useCallback(() => {
    try {
      if (!process.env.API_KEY) {
        throw new Error("API_KEY environment variable not set.");
      }
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      chatRef.current = ai.chats.create({
        model: 'gemini-2.5-flash',
        config: {
          systemInstruction: 'You are a friendly and helpful AI assistant.',
        },
      });
    } catch (e) {
        const error = e as Error;
        console.error("Failed to initialize chat:", error);
        setError(`Initialization failed: ${error.message}`);
    }
  }, []);

  useEffect(() => {
    initializeChat();
  }, [initializeChat]);


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: ChatMessage = { role: MessageRole.User, text: input };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setError(null);

    try {
      if (!chatRef.current) {
        throw new Error("Chat is not initialized.");
      }
      
      const result = await chatRef.current.sendMessage({ message: input });
      const modelResponse: ChatMessage = { role: MessageRole.Model, text: result.text };
      setMessages((prev) => [...prev, modelResponse]);
    } catch (e) {
        const error = e as Error;
        console.error("Error sending message:", error);
        setError(`Failed to get response: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-120px)] max-w-3xl mx-auto bg-gray-800 rounded-lg shadow-2xl overflow-hidden">
      <div className="flex-grow p-6 overflow-y-auto space-y-6">
        {messages.map((msg, index) => (
          <div key={index} className={`flex items-end gap-3 ${msg.role === MessageRole.User ? 'justify-end' : 'justify-start'}`}>
            <div className={`p-4 rounded-2xl max-w-sm md:max-w-md break-words ${msg.role === MessageRole.User ? 'bg-sky-600 text-white rounded-br-none' : 'bg-gray-700 text-gray-200 rounded-bl-none'}`}>
              <p className="whitespace-pre-wrap">{msg.text}</p>
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
            placeholder="Ask Gemini anything..."
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

export default Chatbot;
