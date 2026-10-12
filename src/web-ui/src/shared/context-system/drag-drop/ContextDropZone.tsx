

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
  /** Ref applied to the drop zone root div; use with useNativeFileDrop for native drag bridging. */
  rootRef?: React.RefObject<HTMLDivElement>;
  onContextAdded?: (context: ContextItem) => void;
  /** Async resolver for HTML5 File[] drops (browser/WebView2). Returns ContextItem[]. */
  resolveExternalFiles?: (files: File[]) => Promise<ContextItem[]>;
  disabled?: boolean;
  /**
   * @deprecated Use `rootRef` + `resolveExternalFiles` + `useNativeFileDrop` instead.
   * Legacy callback for HTML5 external file drops.
   */
  onExternalFilesDrop?: (files: File[]) => void;
  /**
   * @deprecated Use `rootRef` with `useNativeFileDrop` for native drag state management.
   * Legacy extended-surface drop target.
   */
  extendedTargetRef?: React.RefObject<HTMLElement | null>;
  /** @deprecated Use `useNativeFileDrop`'s `onDragOver` callback instead. */
  onDragStateChange?: (canDrop: boolean) => void;
}

type DropEvent = React.DragEvent | DragEvent;
const nativeDragEvent = (event: DropEvent): DragEvent =>
  'nativeEvent' in event ? event.nativeEvent : event;

export const ContextDropZone: React.FC<ContextDropZoneProps> = ({
  acceptedTypes,
  children,
  className = '',
  rootRef,
  onContextAdded,
  resolveExternalFiles,
  disabled = false,
  onExternalFilesDrop,
  extendedTargetRef,
  onDragStateChange,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [canAccept, setCanAccept] = useState(false);
  const dropZoneRef = useRef<HTMLDivElement | null>(null);
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
  const onExternalFilesDropRef = useRef(onExternalFilesDrop);
  const onContextAddedRef = useRef(onContextAdded);

  useEffect(() => {
    dropTargetRef.current = dropTarget;
  }, [dropTarget]);

  useEffect(() => {
    resolveExternalFilesRef.current = resolveExternalFiles;
    onExternalFilesDropRef.current = onExternalFilesDrop;
    onContextAddedRef.current = onContextAdded;
  }, [resolveExternalFiles, onExternalFilesDrop, onContextAdded]);

  useEffect(() => {
    onDragStateChange?.(isDragOver && canAccept && !disabled);
  }, [isDragOver, canAccept, disabled, onDragStateChange]);

  useEffect(() => {
    const reset = () => {
      dragCounterRef.current = 0;
      setIsDragOver(false);
      setCanAccept(false);
    };
    window.addEventListener('dragend', reset);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('dragend', reset);
      window.removeEventListener('blur', reset);
    };
  }, []);
  
  
  React.useEffect(() => {
    const unregister = dragManager.registerTarget(dropTarget);
    return () => {
      unregister();
    };
  }, [dropTarget]);
  
   
  const handleDragEnter = useCallback((e: DropEvent) => {
    if (!e.dataTransfer) return;
    e.preventDefault();
    e.stopPropagation();

    dragCounterRef.current++;
    
    const hasExternalFiles = Array.from(e.dataTransfer.types).includes('Files');
    const hasResolver = Boolean(resolveExternalFilesRef.current || onExternalFilesDropRef.current);

    if (hasExternalFiles && hasResolver) {
      setIsDragOver(true);
      setCanAccept(!disabled);
      return;
    }
    
    if (dragCounterRef.current === 1) {
      const payload = dragManager.getCurrentPayload();
      if (payload) {
        const accepted = dropTargetRef.current.canAccept(payload);
        setIsDragOver(true);
        setCanAccept(accepted);
        dragManager.handleDragEnter(dropTargetRef.current, nativeDragEvent(e));
      }
    }
  }, [disabled]);
  
  const handleDragOver = useCallback((e: DropEvent) => {
    if (!e.dataTransfer) return;
    e.preventDefault();
    e.stopPropagation();

    const hasExternalFiles = Array.from(e.dataTransfer.types).includes('Files');
    const hasResolver = Boolean(resolveExternalFilesRef.current || onExternalFilesDropRef.current);

    if (hasExternalFiles && hasResolver) {
      e.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
      return;
    }
    
    const payload = dragManager.getCurrentPayload();
    if (payload && dropTargetRef.current.canAccept(payload)) {
      e.dataTransfer.dropEffect = 'copy';
      dragManager.handleDragOver(dropTargetRef.current, nativeDragEvent(e));
    } else {
      e.dataTransfer.dropEffect = 'none';
    }
  }, [disabled]);
  
  const handleDragLeave = useCallback((e: DropEvent) => {
    if (!e.dataTransfer) return;
    e.preventDefault();
    e.stopPropagation();
    const containsExternalFiles = Array.from(e.dataTransfer.types).includes('Files');
    
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    
    if (dragCounterRef.current === 0) {
      setIsDragOver(false);
      setCanAccept(false);
      if (!containsExternalFiles) {
        dragManager.handleDragLeave(dropTargetRef.current, nativeDragEvent(e));
      }
    }
  }, []);
  
  const handleDrop = useCallback(async (e: DropEvent) => {
    if (!e.dataTransfer) return;
    e.preventDefault();
    e.stopPropagation();
    
    dragCounterRef.current = 0;
    setIsDragOver(false);
    setCanAccept(false);

    const hasExternalFiles = Array.from(e.dataTransfer.types).includes('Files');

    // Try the new async resolver first
    if (hasExternalFiles && resolveExternalFilesRef.current && !disabled) {
      const files = Array.from(e.dataTransfer.files ?? []);
      if (files.length > 0) {
        try {
          const contexts = await resolveExternalFilesRef.current(files);
          for (const ctx of contexts) {
            addContext(ctx);
            updateValidation(ctx.id, { valid: true });
            onContextAddedRef.current?.(ctx);
          }
        } catch (error) {
          log.error('Failed to resolve external dropped files', error);
        }
        return;
      }
    }

    // Fall back to legacy imperative callback
    if (hasExternalFiles && onExternalFilesDropRef.current && !disabled) {
      onExternalFilesDropRef.current(Array.from(e.dataTransfer.files));
      return;
    }

    dragManager.handleDrop(dropTargetRef.current, nativeDragEvent(e));
  }, [disabled, addContext, updateValidation]);

  // Legacy extended-surface drop support
  useEffect(() => {
    const target = extendedTargetRef?.current;
    if (!target) return;
    const outsideComposer = (handler: (event: DropEvent) => void) => (event: DragEvent) => {
      if (event.target instanceof Node && dropZoneRef.current?.contains(event.target)) return;
      if (!event.dataTransfer?.types.includes('Files') && !dragManager.getCurrentPayload()) return;
      handler(event);
    };
    const enter = outsideComposer(handleDragEnter);
    const over = outsideComposer(handleDragOver);
    const leave = outsideComposer(handleDragLeave);
    const drop = outsideComposer(handleDrop);
    target.addEventListener('dragenter', enter);
    target.addEventListener('dragover', over);
    target.addEventListener('dragleave', leave);
    target.addEventListener('drop', drop);
    return () => {
      target.removeEventListener('dragenter', enter);
      target.removeEventListener('dragover', over);
      target.removeEventListener('dragleave', leave);
      target.removeEventListener('drop', drop);
    };
  }, [extendedTargetRef, handleDragEnter, handleDragOver, handleDragLeave, handleDrop]);

  // Merge rootRef with internal dropZoneRef
  const setRef = useCallback((node: HTMLDivElement | null) => {
    dropZoneRef.current = node;
    if (rootRef) {
      (rootRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
    }
  }, [rootRef]);
  
  return (
    <div
      ref={setRef}
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
      data-bitfun-component="context-list"
      data-bitfun-part="dropZone"
      data-bitfun-state={`${isDragOver ? 'drag-over ' : ''}${canAccept ? 'can-accept' : ''}`.trim() || undefined}
    >
      {children}
    </div>
  );
};

export default ContextDropZone;
