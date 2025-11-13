import React, { useState } from 'react';
import { GoogleGenAI } from '@google/genai';
import { LoadingSpinner } from './LoadingSpinner';
import { TranslateIcon } from './icons/TranslateIcon';

interface TranslationProps {
  text: string;
}

export const Translation: React.FC<TranslationProps> = ({ text }) => {
  const [translatedText, setTranslatedText] = useState<string | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTranslation, setShowTranslation] = useState(false);

  const handleTranslate = async () => {
    if (translatedText) {
      setShowTranslation(!showTranslation);
      return;
    }

    setIsTranslating(true);
    setError(null);

    try {
      if (!process.env.API_KEY) throw new Error("API_KEY not set.");
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const prompt = `Detect the language of the following text. If it is English, translate it to Chinese (Simplified). If it is Chinese, translate it to English. Provide only the translated text, without any additional comments or explanations.\n\nText to translate: "${text}"`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });

      const translation = response.text.trim();
      setTranslatedText(translation);
      setShowTranslation(true);
    } catch (e) {
      const err = e as Error;
      console.error("Translation failed:", err);
      setError(`Translation failed: ${err.message}`);
    } finally {
      setIsTranslating(false);
    }
  };

  return (
    <div className="mt-2">
      <button
        onClick={handleTranslate}
        disabled={isTranslating}
        className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-sky-400 disabled:text-gray-600 disabled:cursor-not-allowed transition-colors"
      >
        {isTranslating ? (
          <>
            <LoadingSpinner />
            <span>Translating...</span>
          </>
        ) : (
          <>
            <TranslateIcon />
            <span>{showTranslation && translatedText ? 'Hide Translation' : 'Translate'}</span>
          </>
        )}
      </button>
      {showTranslation && translatedText && (
        <div className="mt-2 p-3 bg-gray-600/50 rounded-lg border border-gray-500">
          <p className="text-sm text-gray-300 whitespace-pre-wrap">{translatedText}</p>
        </div>
      )}
      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
    </div>
  );
};
