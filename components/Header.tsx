
import React from 'react';
import { AppMode } from '../types';
import { VoiceChatIcon } from './icons/VoiceChatIcon';
import { ImageIcon } from './icons/ImageIcon';
import { PaletteIcon } from './icons/PaletteIcon';
import { VideoIcon } from './icons/VideoIcon';

interface HeaderProps {
  currentMode: AppMode;
  setMode: (mode: AppMode) => void;
}

const NavButton: React.FC<{
  label: AppMode;
  icon: React.ReactNode;
  currentMode: AppMode;
  onClick: () => void;
}> = ({ label, icon, currentMode, onClick }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-2 px-3 py-2 text-sm md:text-base font-medium rounded-md transition-colors duration-200 ${
      currentMode === label
        ? 'bg-sky-600 text-white shadow-md'
        : 'text-gray-300 hover:bg-gray-700 hover:text-white'
    }`}
  >
    {icon}
    <span>{label}</span>
  </button>
);

export const Header: React.FC<HeaderProps> = ({ currentMode, setMode }) => {
  return (
    <header className="bg-gray-800 shadow-lg sticky top-0 z-10">
      <nav className="container mx-auto px-4 py-3 flex justify-between items-center">
        <div className="flex items-center space-x-2">
           <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-sky-400" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5a.75.75 0 01.75.75v.518a9.713 9.713 0 017.93 7.93h.518a.75.75 0 010 1.5h-.518a9.713 9.713 0 01-7.93 7.93v.518a.75.75 0 01-1.5 0v-.518a9.713 9.713 0 01-7.93-7.93H2.5a.75.75 0 010-1.5h.518A9.713 9.713 0 0110.95 3.768V3.25a.75.75 0 01.75-.75.25.25 0 000 0zM12 5.5A6.5 6.5 0 1012 18.5 6.5 6.5 0 0012 5.5z"/><path d="M12 8.5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5a.75.75 0 01.75-.75z"/></svg>
           <h1 className="text-xl font-bold text-white hidden sm:block">Gemini Multi-Modal Studio</h1>
        </div>
        <div className="flex items-center space-x-2 md:space-x-4 bg-gray-900 p-1 rounded-lg">
          <NavButton icon={<VoiceChatIcon />} label={AppMode.Chat} currentMode={currentMode} onClick={() => setMode(AppMode.Chat)} />
          <NavButton icon={<ImageIcon />} label={AppMode.Analyze} currentMode={currentMode} onClick={() => setMode(AppMode.Analyze)} />
          <NavButton icon={<VideoIcon />} label={AppMode.AnalyzeVideo} currentMode={currentMode} onClick={() => setMode(AppMode.AnalyzeVideo)} />
          <NavButton icon={<PaletteIcon />} label={AppMode.Generate} currentMode={currentMode} onClick={() => setMode(AppMode.Generate)} />
        </div>
      </nav>
    </header>
  );
};
