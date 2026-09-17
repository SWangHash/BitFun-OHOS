import React from 'react';
import { OverflowText, Icon, ScrollArea } from '@bitfun/ui';
import { FolderOpen } from 'lucide-react';
import type { MiniAppBubbleCustomization } from '@/app/scenes/miniapps/miniAppStore';
import { renderMiniAppIcon } from '@/app/scenes/miniapps/utils/miniAppIcons';
import { useChatInputState } from '@/flow_chat/store/chatInputStateStore';
import { computeFlowChatInputStackFooterPx } from '@/flow_chat/utils/flowChatScrollLayout';

interface MiniAppBubbleWelcomeProps {
  appName: string;
  appDescription?: string;
  appIcon?: string;
  customization?: MiniAppBubbleCustomization;
  workspacePath?: string;
  onSuggestion: (prompt: string) => void;
}

/** Keep aligned with the block padding on `.bitfun-fmc__miniapp-welcome-content`. */
const WELCOME_CONTENT_BLOCK_PADDING_PX = 36;

/**
 * Host-rendered empty state for an Agentic MiniApp session. MiniApps provide a
 * bounded declarative model through app.chat.claimComposer; they never inject
 * markup into the shared conversation surface.
 */
export const MiniAppBubbleWelcome: React.FC<MiniAppBubbleWelcomeProps> = ({
  appName,
  appDescription,
  appIcon = 'Box',
  customization,
  workspacePath,
  onSuggestion,
}) => {
  const welcome = customization?.welcome;
  const title = welcome?.title || appName;
  const description = welcome?.description || appDescription;
  const workspaceLabel = welcome?.workspaceLabel || (workspacePath ? appName : '');
  const suggestions = welcome?.suggestions || [];
  const inputHeight = useChatInputState(state => state.inputHeight);
  const inputClearance = computeFlowChatInputStackFooterPx(inputHeight);

  return (
    <ScrollArea className="bitfun-fmc__miniapp-welcome" data-bitfun-component="miniapp-bubble-welcome" data-bitfun-part="root">
      <div
        className="bitfun-fmc__miniapp-welcome-content"
        style={{
          paddingBottom: `${WELCOME_CONTENT_BLOCK_PADDING_PX + inputClearance}px`,
        }}
      >
        <div
          className="bitfun-fmc__miniapp-welcome-icon"
          data-bitfun-component="miniapp-bubble-welcome"
          data-bitfun-part="icon"
          aria-hidden="true"
        >
          {renderMiniAppIcon(appIcon, 28)}
        </div>

        {title !== appName && (
          <div className="bitfun-fmc__miniapp-welcome-eyebrow" data-bitfun-component="miniapp-bubble-welcome" data-bitfun-part="eyebrow">{appName}</div>
        )}
        <h2 data-bitfun-component="miniapp-bubble-welcome" data-bitfun-part="title">{title}</h2>
        {description && <p className="bitfun-fmc__miniapp-welcome-description" data-bitfun-component="miniapp-bubble-welcome" data-bitfun-part="description">{description}</p>}

        {workspaceLabel && workspacePath && (
          <div
            className="bitfun-fmc__miniapp-workspace"
            data-bitfun-component="miniapp-bubble-welcome"
            data-bitfun-part="workspace"
            title={workspacePath}
            data-workspace-path={workspacePath}
          >
            <FolderOpen size={13} aria-hidden="true" />
            <OverflowText>{workspaceLabel}</OverflowText>
          </div>
        )}

        {suggestions.length > 0 && (
          <div className="bitfun-fmc__miniapp-suggestions" data-bitfun-component="miniapp-bubble-welcome" data-bitfun-part="suggestions">
            {welcome?.suggestionsLabel && (
              <div className="bitfun-fmc__miniapp-suggestions-label" data-bitfun-component="miniapp-bubble-welcome" data-bitfun-part="suggestionsLabel">
                {welcome.suggestionsLabel}
              </div>
            )}
            <div className="bitfun-fmc__miniapp-suggestions-list" data-bitfun-component="miniapp-bubble-welcome" data-bitfun-part="suggestionsList">
              {suggestions.map((suggestion, index) => (
                <button
                  key={`${suggestion.label}:${index}`}
                  type="button"
                  className="bitfun-fmc__miniapp-suggestion"
                  data-bitfun-component="miniapp-bubble-welcome"
                  data-bitfun-part="suggestion"
                  title={suggestion.prompt}
                  onClick={() => onSuggestion(suggestion.prompt)}
                >
                  <span>{suggestion.label}</span>
                  <Icon name="arrow-up-right" size="xs" aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  );
};

export default MiniAppBubbleWelcome;
