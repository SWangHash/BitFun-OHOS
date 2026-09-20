/**
 * GraphView — Wraps GitGraphView for the Git scene graph tab.
 */

import React from 'react';
import { GitGraphView } from '@/tools/git/components/GitGraphView';
import './GraphView.scss';

interface GraphViewProps {
  workspacePath?: string;
  workspaceId?: string;
}

const GraphView: React.FC<GraphViewProps> = ({ workspacePath = '', workspaceId }) => {
  if (!workspacePath) {
    return (
      <div data-bitfun-component="git-graph-view" data-bitfun-part="root" data-bitfun-state="empty" className="bitfun-git-scene-graph bitfun-git-scene-graph--empty">
        <p>Open a workspace to see the commit graph.</p>
      </div>
    );
  }

  return (
    <div data-bitfun-component="git-graph-view" data-bitfun-part="root" className="bitfun-git-scene-graph">
      <GitGraphView repositoryPath={{ workspaceId: workspaceId ?? '', repositoryPath: workspacePath }} />
    </div>
  );
};

export default GraphView;
