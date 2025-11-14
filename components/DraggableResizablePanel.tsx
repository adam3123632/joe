import React, { useRef, useCallback, ReactNode } from 'react';
import { DragHandleIcon } from './icons/DragHandleIcon';

interface PanelProps {
  id: string;
  title: string;
  children: ReactNode;
  position: { x: number | string; y: number | string };
  size: { width: number | string; height: number | string };
  zIndex: number;
  onDrag: (id: string, newPosition: { x: number; y: number }) => void;
  onResize: (id: string, newSize: { width: number; height: number }) => void;
  onFocus: (id: string) => void;
}

export const DraggableResizablePanel: React.FC<PanelProps> = ({
  id,
  title,
  children,
  position,
  size,
  zIndex,
  onDrag,
  onResize,
  onFocus,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

  const handleDragMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    onFocus(id);
    if (!panelRef.current) return;

    const panelRect = panelRef.current.getBoundingClientRect();
    const parentRect = panelRef.current.parentElement!.getBoundingClientRect();

    const startInfo = {
      x: e.clientX,
      y: e.clientY,
      panelX: panelRect.left - parentRect.left,
      panelY: panelRect.top - parentRect.top,
    };
    
    isDraggingRef.current = false;

    const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!isDraggingRef.current) {
            const dx = Math.abs(moveEvent.clientX - startInfo.x);
            const dy = Math.abs(moveEvent.clientY - startInfo.y);
            // Only start dragging if the mouse has moved more than a small threshold
            if (dx > 5 || dy > 5) { 
                isDraggingRef.current = true;
            } else {
                return; // Don't drag for minor movements
            }
        }
        
        const dx = moveEvent.clientX - startInfo.x;
        const dy = moveEvent.clientY - startInfo.y;
        onDrag(id, { x: startInfo.panelX + dx, y: startInfo.panelY + dy });
    };

    const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [id, onFocus, onDrag]);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    onFocus(id);
    if (!panelRef.current) return;

    const panelRect = panelRef.current.getBoundingClientRect();
    const startInfo = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      width: panelRect.width,
      height: panelRect.height,
    };
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
        const dx = moveEvent.clientX - startInfo.mouseX;
        const dy = moveEvent.clientY - startInfo.mouseY;
        const newWidth = Math.max(350, startInfo.width + dx);
        const newHeight = Math.max(300, startInfo.height + dy);
        onResize(id, { width: newWidth, height: newHeight });
    };

    const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [id, onFocus, onResize]);


  const positionStyles = {
    left: typeof position.x === 'string' ? position.x : `${position.x}px`,
    top: typeof position.y === 'string' ? position.y : `${position.y}px`,
  };

  return (
    <div
      ref={panelRef}
      className="absolute bg-gray-800 rounded-lg shadow-2xl flex flex-col border border-gray-700/50"
      style={{
        ...positionStyles,
        width: typeof size.width === 'string' ? size.width : `${size.width}px`,
        height: typeof size.height === 'string' ? size.height : `${size.height}px`,
        zIndex: zIndex,
        minWidth: '350px',
        minHeight: '300px',
      }}
      onMouseDown={() => onFocus(id)}
    >
      <div
        className="p-3 border-b border-gray-700 flex items-center justify-between cursor-move touch-none"
        onMouseDown={handleDragMouseDown}
      >
        <div className="flex items-center gap-2">
           <DragHandleIcon />
           <h2 className="font-semibold text-sky-400 select-none">{title}</h2>
        </div>
      </div>
      <div className="flex-grow overflow-hidden relative bg-gray-900/30">
        {children}
      </div>
       <div
        className="absolute bottom-0 right-0 w-5 h-5 cursor-se-resize touch-none"
        onMouseDown={handleResizeMouseDown}
      >
        <svg className="w-full h-full text-gray-600 hover:text-sky-400 transition-colors" fill="currentColor" viewBox="0 0 20 20">
            <path d="M15.293 15.293a1 1 0 011.414 0l2 2a1 1 0 01-1.414 1.414l-2-2a1 1 0 010-1.414zM8 12a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
        </svg>
      </div>
    </div>
  );
};
