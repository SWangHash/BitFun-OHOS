import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@bitfun/ui/styles.css';
import '@bitfun/design-tokens/tokens.css';
import '@bitfun/theme-bitfun/default.css';
import '../../src/app/styles/index.scss';
import { I18nProvider, i18nService } from '../../src/infrastructure/i18n';
import { BitFunDesignSystemProvider } from '../../src/infrastructure/design-system';
import { appearanceRuntime, buildBuiltinAppearance, bitFunDarkPalette } from '../../src/infrastructure/appearance';
import { workspaceAPI } from '../../src/infrastructure/api';
import MarkdownEditor from '../../src/tools/editor/components/MarkdownEditor';
import { Preview } from './preview-reference';

// Only the filesystem boundary is replaced. The production file editor, parser,
// renderer, dirty tracking, disk polling and save/conflict flow all run normally.
const endpoint = 'http://127.0.0.1:1450';
workspaceAPI.readFileContent = async () => (await fetch(`${endpoint}/file`)).text();
workspaceAPI.getFileMetadata = async () => (await fetch(`${endpoint}/metadata`)).json();
workspaceAPI.writeFileContent = async (_workspace, _file, content) => {
  const response = await fetch(`${endpoint}/file`, { method: 'PUT', body: content });
  if (!response.ok) throw new Error('Fixture file write failed');
};
await i18nService.initialize();
await appearanceRuntime.initialize(buildBuiltinAppearance(bitFunDarkPalette));

const showReference = new URLSearchParams(location.search).has('reference');
const referenceContent = showReference ? await workspaceAPI.readFileContent('/workspace/test.md') : '';

function Fixture() {
  const [dirty, setDirty] = useState(false);
  const [readonly, setReadonly] = useState(false);
  return <I18nProvider><BitFunDesignSystemProvider>
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', maxWidth: 960, margin: 'auto' }}>
      <div><button data-testid="readonly" onClick={() => setReadonly(!readonly)}>Toggle readonly</button>
        <output data-testid="dirty">{dirty ? 'Unsaved' : 'Saved'}</output></div>
      {showReference ? <Preview value={referenceContent} /> : <MarkdownEditor filePath="/workspace/test.md" workspacePath="/workspace" readOnly={readonly}
        onContentChange={(_content, changed) => setDirty(changed)} />}
    </div>
  </BitFunDesignSystemProvider></I18nProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
