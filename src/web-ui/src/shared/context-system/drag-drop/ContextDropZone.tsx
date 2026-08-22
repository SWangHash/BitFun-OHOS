 

import React, { useCallback, useState, useRef, useEffect } from 'react';
import { dragManager } from '../../services/DragManager';
import { contextRegistry } from '../../services/ContextRegistry';
import { useContextStore } from '../../stores/contextStore';
import type { IDropTarget } from '../../types/drag';
import type { DragPayload } from '../../types/drag';
import type { ContextItem, ContextType } from '../../types/context';
import { createLogger } from '../../utils/logger';
import './ContextDropZone.scss';

const log = createLogger('ContextDropZone');

export interface ContextDropZoneProps {
  acceptedTypes?: ContextType[];
  children?: React.ReactNode;
  className?: string;
  rootRef?: React.RefObject<HTMLDivElement>;
  onContextAdded?: (context: ContextItem) => void;
  resolveExternalFiles?: (files: File[]) => Promise<ContextItem[]>;
  disabled?: boolean;
}

export const ContextDropZone: React.FC<ContextDropZoneProps> = ({
  acceptedTypes,
  children,
  className = '',
  rootRef,
  onContextAdded,
  resolveExternalFiles,
  disabled = false,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [canAccept, setCanAccept] = useState(false);
  const dragCounterRef = useRef(0); 
  const addContext = useContextStore(state => state.addContext);
  const updateValidation = useContextStore(state => state.updateValidation);
  
  
  const acceptedTypesArray = React.useMemo(() => 
    acceptedTypes || contextRegistry.getAllTypes(), 
    [acceptedTypes]
  );
  
  
  const dropTarget = React.useMemo<IDropTarget>(() => ({
    targetId: 'context-drop-zone',
    acceptedTypes: acceptedTypesArray,
    
    canAccept: (payload: DragPayload<ContextItem>) => {
      return !disabled && acceptedTypesArray.includes(payload.dataType);
    },
    
    onDrop: async (payload: DragPayload<ContextItem>) => {
      if (disabled) return;
      const context = payload.data;
      
      
      addContext(context);
      
      
      
      updateValidation(context.id, { valid: true });
      
      
      onContextAdded?.(context);
      
      
      setIsDragOver(false);
      setCanAccept(false);
    },
    
    onDragEnter: (payload: DragPayload<ContextItem>) => {
      setIsDragOver(true);
      const accepted = dropTarget.canAccept(payload);
      setCanAccept(accepted);
    },
    
    onDragLeave: () => {
      setIsDragOver(false);
      setCanAccept(false);
    },
    
    onDragOver: () => {
      
    }
  }), [acceptedTypesArray, addContext, disabled, updateValidation, onContextAdded]);
  
  
  const dropTargetRef = useRef(dropTarget);
  const resolveExternalFilesRef = useRef(resolveExternalFiles);
  const onContextAddedRef = useRef(onContextAdded);

  useEffect(() => {
    dropTargetRef.current = dropTarget;
  }, [dropTarget]);

  useEffect(() => {
    resolveExternalFilesRef.current = resolveExternalFiles;
    onContextAddedRef.current = onContextAdded;
  }, [resolveExternalFiles, onContextAdded]);

  
  React.useEffect(() => {
    const unregister = dragManager.registerTarget(dropTarget);
    
    return () => {
      unregister();
    };
  }, [dropTarget]);
  
   
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    log.info('dragenter', { types: [...e.dataTransfer.types], hasResolver: !!resolveExternalFilesRef.current });

    dragCounterRef.current++;
    
    if (dragCounterRef.current === 1) {
      
      const payload = dragManager.getCurrentPayload();
      if (payload) {
        const accepted = dropTargetRef.current.canAccept(payload);
        setIsDragOver(true);
        setCanAccept(accepted);
        dragManager.handleDragEnter(dropTargetRef.current, e.nativeEvent);
        return;
      }
      if (e.dataTransfer.types.includes('Files') && resolveExternalFilesRef.current) {
        setIsDragOver(true);
        setCanAccept(true);
      }
    }
  }, []);
  
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    
    const payload = dragManager.getCurrentPayload();
    if (payload && dropTargetRef.current.canAccept(payload)) {
      e.dataTransfer.dropEffect = 'copy';
      dragManager.handleDragOver(dropTargetRef.current, e.nativeEvent);
      return;
    }
    if (e.dataTransfer.types.includes('Files') && resolveExternalFilesRef.current) {
      e.dataTransfer.dropEffect = 'copy';
      return;
    }
    e.dataTransfer.dropEffect = 'none';
  }, []);
  
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    dragCounterRef.current--;
    
    if (dragCounterRef.current === 0) {
      
      setIsDragOver(false);
      setCanAccept(false);
      dragManager.handleDragLeave(dropTargetRef.current, e.nativeEvent);
    }
  }, []);
  
  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    log.info('drop', { fileCount: e.dataTransfer.files?.length ?? 0, types: [...e.dataTransfer.types], hasResolver: !!resolveExternalFilesRef.current, hasPayload: !!dragManager.getCurrentPayload() });

    
    dragCounterRef.current = 0;
    setIsDragOver(false);
    setCanAccept(false);
    
    const payload = dragManager.getCurrentPayload();
    if (payload) {
      dragManager.handleDrop(dropTargetRef.current, e.nativeEvent);
      return;
    }

    const files = Array.from(e.dataTransfer.files ?? []);
    const resolver = resolveExternalFilesRef.current;
    if (files.length === 0 || !resolver) {
      dragManager.handleDrop(dropTargetRef.current, e.nativeEvent);
      return;
    }

    try {
      const contexts = await resolver(files);
      for (const ctx of contexts) {
        addContext(ctx);
        updateValidation(ctx.id, { valid: true });
        onContextAddedRef.current?.(ctx);
      }
    } catch (error) {
      log.error('Failed to resolve external dropped files', error);
    }
  }, [addContext, updateValidation]);
  
  return (
    <div
      ref={rootRef}
      className={`
        bitfun-context-drop-zone
        ${isDragOver ? 'bitfun-context-drop-zone--drag-over' : ''}
        ${canAccept ? 'bitfun-context-drop-zone--can-accept' : ''}
        ${!canAccept && isDragOver ? 'bitfun-context-drop-zone--cannot-accept' : ''}
        ${className}
      `.trim()}
      
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      data-dropzone="context-drop-zone"
      data-bf-component="context-list"
      data-bf-part="dropZone"
      data-bf-state={`${isDragOver ? 'drag-over ' : ''}${canAccept ? 'can-accept' : ''}`.trim() || undefined}
    >
      {children}
    </div>
  );
};

export default ContextDropZone;
