
import React, { useState } from 'react';
import Chatbot from './components/Chatbot';
import ImageAnalyzer from './components/ImageAnalyzer';
import Generator from './components/Generator';
import { Header } from './components/Header';
import { AppMode } from './types';
import VideoAnalyzer from './components/VideoAnalyzer';

const App: React.FC = () => {
  const [mode, setMode] = useState<AppMode>(AppMode.Chat);

  const renderContent = () => {
    switch (mode) {
      case AppMode.Chat:
        return <Chatbot />;
      case AppMode.Analyze:
        return <ImageAnalyzer />;
      case AppMode.Generate:
        return <Generator />;
      case AppMode.AnalyzeVideo:
        return <VideoAnalyzer />;
      default:
        return <Chatbot />;
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 flex flex-col">
      <Header currentMode={mode} setMode={setMode} />
      <main className="flex-grow container mx-auto p-4 md:p-6">
        {renderContent()}
      </main>
    </div>
  );
};

export default App;
