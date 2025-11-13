
import React, { useState } from 'react';

interface ApiKeySelectorProps {
  onKeySelected: () => void;
}

export const ApiKeySelector: React.FC<ApiKeySelectorProps> = ({ onKeySelected }) => {
  const [isOpening, setIsOpening] = useState(false);

  const handleSelectKey = async () => {
    setIsOpening(true);
    try {
      // @ts-ignore
      if (window.aistudio && typeof window.aistudio.openSelectKey === 'function') {
        // @ts-ignore
        await window.aistudio.openSelectKey();
        // Assume success and let the parent component re-check.
        onKeySelected();
      } else {
        console.error("aistudio.openSelectKey is not available.");
      }
    } catch (error) {
      console.error("Error opening API key selection:", error);
    } finally {
      setIsOpening(false);
    }
  };

  return (
    <div className="bg-yellow-900/30 border border-yellow-600 text-yellow-200 px-4 py-3 rounded-lg relative mb-4" role="alert">
      <strong className="font-bold">Action Required: </strong>
      <span className="block sm:inline">An API key is required for video generation.</span>
      <p className="text-sm mt-1 text-yellow-300">
        Please select an API key to proceed. For more information on billing, visit{' '}
        <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noopener noreferrer" className="underline hover:text-yellow-100">
          ai.google.dev
        </a>.
      </p>
      <button
        onClick={handleSelectKey}
        disabled={isOpening}
        className="mt-3 bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-2 px-4 rounded-md disabled:bg-yellow-800 transition-colors"
      >
        {isOpening ? 'Opening...' : 'Select API Key'}
      </button>
    </div>
  );
};
