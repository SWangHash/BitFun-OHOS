/**
 * FileViewerScene — standalone file viewing scene.
 *
 * Uses ContentCanvas in project mode so file tabs are managed independently
 * from the AI Agent AuxPane tab set.
 */

import React from 'react';
import { ContentCanvas } from '../../components/panels/content-canvas';
import { CanvasStoreModeContext } from '../../components/panels/content-canvas/stores';
import './FileViewerScene.scss';

interface FileViewerSceneProps {
  workspacePath?: string;
  isActive?: boolean;
}

const FileViewerScene: React.FC<FileViewerSceneProps> = ({ workspacePath, isActive = false }) => {
  return (
    <CanvasStoreModeContext.Provider value="project">
      <div className="bitfun-file-viewer-scene" data-bf-scene="file-viewer" data-bf-part="root">
        <ContentCanvas workspacePath={workspacePath} mode="project" isSceneActive={isActive} />
      </div>
    </CanvasStoreModeContext.Provider>
  );
};

export default FileViewerScene;
