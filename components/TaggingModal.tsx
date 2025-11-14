import React, { useState, useEffect, useRef } from 'react';
import { ReferenceImage } from '../types';

interface TaggingModalProps {
  image: ReferenceImage | null;
  savedTags: string[];
  onClose: () => void;
  onSave: (tag: string) => void;
}

export const TaggingModal: React.FC<TaggingModalProps> = ({ image, savedTags, onClose, onSave }) => {
    const [currentTag, setCurrentTag] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (image) {
            setCurrentTag(image.tag || '');
            // Focus input when modal opens
            setTimeout(() => inputRef.current?.focus(), 100);
        }
    }, [image]);

    if (!image) return null;

    const handleSave = () => {
        onSave(currentTag);
    };

    const handleRemove = () => {
        onSave('');
    };
    
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleSave();
        } else if (e.key === 'Escape') {
            onClose();
        }
    };
    
    // Prevent clicks inside the modal from closing it
    const handleModalContentClick = (e: React.MouseEvent) => {
        e.stopPropagation();
    };


    return (
        <div 
            className="fixed inset-0 bg-black/70 z-[100] flex items-center justify-center p-4 backdrop-blur-sm"
            onClick={onClose}
            onKeyDown={handleKeyDown}
        >
            <div 
                className="bg-gray-800 rounded-lg shadow-2xl w-full max-w-md border border-gray-700 flex flex-col"
                onClick={handleModalContentClick}
            >
                <div className="p-4 border-b border-gray-700">
                    <h2 className="text-lg font-semibold text-sky-400">Tag Reference Image</h2>
                    <p className="text-xs text-gray-400">Describe how the AI should use this image.</p>
                </div>

                <div className="p-4 space-y-4">
                    <div className="flex items-start gap-4">
                        <img 
                            src={`data:${image.file.mimeType};base64,${image.file.base64}`} 
                            alt="Image to tag"
                            className="w-24 h-24 object-cover rounded-md border-2 border-gray-600"
                        />
                        <div className="flex-grow">
                             <label htmlFor="tag-input" className="block text-sm font-medium text-gray-300 mb-2">Image Tag</label>
                             <input
                                ref={inputRef}
                                id="tag-input"
                                type="text"
                                value={currentTag}
                                onChange={(e) => setCurrentTag(e.target.value)}
                                placeholder="e.g., character design, style reference"
                                className="w-full bg-gray-900/50 p-2 border border-gray-600 rounded-md text-gray-200 focus:outline-none focus:ring-2 focus:ring-sky-500"
                            />
                        </div>
                    </div>
                    {savedTags.length > 0 && (
                        <div>
                            <p className="text-sm font-medium text-gray-300 mb-2">Saved Tags</p>
                            <div className="flex flex-wrap gap-2">
                                {savedTags.map(tag => (
                                    <button
                                        key={tag}
                                        onClick={() => setCurrentTag(tag)}
                                        className="px-3 py-1 bg-gray-700 hover:bg-sky-600 text-gray-300 hover:text-white text-xs rounded-full transition-colors"
                                    >
                                        {tag}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                <div className="p-4 border-t border-gray-700 flex justify-between items-center bg-gray-900/30 rounded-b-lg">
                    <button 
                        onClick={handleRemove}
                        className="text-sm text-red-500 hover:text-red-400 hover:underline"
                    >
                       Remove Tag
                    </button>
                    <div className="flex gap-2">
                        <button 
                            onClick={onClose}
                            className="px-4 py-2 text-sm bg-gray-600 hover:bg-gray-500 text-white font-bold rounded-md transition-colors"
                        >
                            Cancel
                        </button>
                        <button 
                            onClick={handleSave}
                            className="px-4 py-2 text-sm bg-sky-600 hover:bg-sky-700 text-white font-bold rounded-md transition-colors"
                        >
                            Save
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
