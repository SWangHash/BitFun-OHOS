/* Component registry */
import React from 'react';
import type { ComponentCategory } from '../types';
import { Button } from '@components/Button';
import { IconButton } from '@components/IconButton';
import { WindowControls } from '@components/WindowControls';
import { Input } from '@components/Input';
import { Search } from '@components/Search';
import { Checkbox } from '@components/Checkbox';
import { Switch } from '@components/Switch';
import { Textarea } from '@components/Textarea';
import { Modal } from '@components/Modal';
import { CubeLoading } from '@components/CubeLoading';
import { Alert } from '@components/Alert';
import { Tooltip } from '@components/Tooltip';
import { Tabs, TabPane } from '@components/Tabs';
import { Tag } from '@components/Tag';
import { Avatar, AvatarGroup } from '@components/Avatar';
import { Empty } from '@components/Empty';
import { Markdown } from '@components/Markdown';
import { CodeEditor } from '@components/CodeEditor';
import { StreamText } from '@components/StreamText';
import { TodoWriteDisplay } from '@/flow_chat/tool-cards/TodoWriteDisplay';
import { TaskToolDisplay } from '@/flow_chat/tool-cards/TaskToolDisplay';
import { WebSearchCard as RealWebSearchCard } from '@/flow_chat/tool-cards/WebSearchCard';
import { ReadFileDisplay } from '@/flow_chat/tool-cards/ReadFileDisplay';
import { GrepSearchDisplay } from '@/flow_chat/tool-cards/GrepSearchDisplay';
import { GlobSearchDisplay } from '@/flow_chat/tool-cards/GlobSearchDisplay';
import { FileOperationToolCard } from '@/flow_chat/tool-cards/FileOperationToolCard';
import { LSDisplay } from '@/flow_chat/tool-cards/LSDisplay';
import { MCPToolDisplay } from '@/flow_chat/tool-cards/MCPToolDisplay';
import { ContextCompressionDisplay } from '@/flow_chat/tool-cards/ContextCompressionDisplay';
import { SkillDisplay } from '@/flow_chat/tool-cards/SkillDisplay';
import { AskUserQuestionCard } from '@/flow_chat/tool-cards/AskUserQuestionCard';
import { GitToolDisplay } from '@/flow_chat/tool-cards/GitToolDisplay';
import { CreatePlanDisplay } from '@/flow_chat/tool-cards/CreatePlanDisplay';
import { InitMiniAppDisplay } from '@/flow_chat/tool-cards/MiniAppToolDisplay';
import type { FlowToolItem, FlowThinkingItem } from '@/flow_chat/types/flow-chat';
import { TOOL_CARD_CONFIGS } from '@/flow_chat/tool-cards/toolCardMetadata';
import { ModelThinkingDisplay } from '@/flow_chat/tool-cards/ModelThinkingDisplay';
import { ReproductionStepsBlock } from '@components/Markdown/ReproductionStepsBlock';

const previewTextSubtle = 'color-mix(in srgb, var(--bf-appearance-token-color-static-white) 60%, var(--bf-appearance-token-color-static-black))';
const previewTextDisabled = 'color-mix(in srgb, var(--bf-appearance-token-color-static-white) 40%, var(--bf-appearance-token-color-static-black))';

function createMockToolItem(
  toolName: string,
  input: any,
  result?: any,
  status: 'pending' | 'preparing' | 'streaming' | 'running' | 'completed' | 'error' = 'completed'
): FlowToolItem {
  const config = TOOL_CARD_CONFIGS[toolName];
  return {
    id: `mock-${toolName}-${Date.now()}`,
    type: 'tool',
    status,
    timestamp: Date.now(),
    toolName,
    toolCall: {
      id: `call-${toolName}`,
      input
    },
    toolResult: result ? {
      result,
      success: status === 'completed',
      error: status === 'error' ? 'Execution failed' : undefined
    } : undefined,
    config: config || {
      toolName,
      displayName: toolName,
      icon: '🔧',
      requiresConfirmation: false,
      resultDisplayType: 'summary',
      description: '',
      displayMode: 'compact',
      primaryColor: 'var(--bf-appearance-token-color-text-muted)'
    }
  } as FlowToolItem;
}


export const componentRegistry: ComponentCategory[] = [
  {
    id: 'basic',
    name: 'Basic Components',
    description: 'Common basic UI components',
    layoutType: 'grid-4',
    components: [
      {
        id: 'button-primary',
        name: 'Button - Primary',
        description: 'Primary button',
        category: 'basic',
        component: () => <Button variant="primary">Primary Button</Button>,
      },
      {
        id: 'button-secondary',
        name: 'Button - Secondary',
        description: 'Secondary button',
        category: 'basic',
        component: () => <Button variant="secondary">Secondary Button</Button>,
      },
      {
        id: 'button-ghost',
        name: 'Button - Ghost',
        description: 'Ghost button',
        category: 'basic',
        component: () => <Button variant="ghost">Ghost Button</Button>,
      },
      {
        id: 'button-sizes',
        name: 'Button - Sizes',
        description: 'Demo',
        category: 'basic',
        component: () => (
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <Button size="small">Small</Button>
            <Button size="medium">Medium</Button>
            <Button size="large">Large</Button>
          </div>
        ),
      },
      {
        id: 'tag-demo',
        name: 'Tag - Demo',
        description: 'Demo',
        category: 'basic',
        component: () => (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <Tag color="blue">Blue</Tag>
              <Tag color="green">Green</Tag>
              <Tag color="red">Red</Tag>
              <Tag color="yellow">Yellow</Tag>
              <Tag color="purple">Purple</Tag>
              <Tag color="gray">Gray</Tag>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <Tag size="small">Small</Tag>
              <Tag size="medium">Medium</Tag>
              <Tag size="large">Large</Tag>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <Tag color="blue" rounded>Rounded</Tag>
              <Tag color="green" closable onClose={() => alert('Closed!')}>Closable</Tag>
            </div>
          </div>
        ),
      },
      {
        id: 'icon-button-variants',
        name: 'IconButton - Variants',
        description: 'Demo',
        category: 'basic',
        component: () => (
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <IconButton variant="default" aria-label="Search">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="2"/>
                <path d="M11 11L15 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </IconButton>
            <IconButton variant="primary" aria-label="Star">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M8 2L10 6L14 6.5L11 9.5L12 14L8 11.5L4 14L5 9.5L2 6.5L6 6L8 2Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
              </svg>
            </IconButton>
            <IconButton variant="ghost" aria-label="Settings">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="2"/>
                <path d="M8 1V3M8 13V15M15 8H13M3 8H1M13.5 2.5L12 4M4 12L2.5 13.5M13.5 13.5L12 12M4 4L2.5 2.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </IconButton>
            <IconButton variant="danger" aria-label="Delete">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M3 4H13M5 4V3C5 2.5 5.5 2 6 2H10C10.5 2 11 2.5 11 3V4M6 7V12M10 7V12M4 4L5 14H11L12 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </IconButton>
            <IconButton variant="success" aria-label="Check">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M3 8L6 11L13 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </IconButton>
            <IconButton variant="warning" aria-label="Warning">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M8 2L14 14H2L8 2Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
                <path d="M8 6V9M8 11V11.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </IconButton>
          </div>
        ),
      },
      {
        id: 'icon-button-sizes',
        name: 'IconButton - Sizes',
        description: 'Demo',
        category: 'basic',
        component: () => (
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <IconButton size="small" variant="primary" aria-label="Small">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M8 2L10 6L14 6.5L11 9.5L12 14L8 11.5L4 14L5 9.5L2 6.5L6 6L8 2Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
              </svg>
            </IconButton>
            <IconButton size="medium" variant="primary" aria-label="Medium">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M8 2L10 6L14 6.5L11 9.5L12 14L8 11.5L4 14L5 9.5L2 6.5L6 6L8 2Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
              </svg>
            </IconButton>
            <IconButton size="large" variant="primary" aria-label="Large">
              <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
                <path d="M8 2L10 6L14 6.5L11 9.5L12 14L8 11.5L4 14L5 9.5L2 6.5L6 6L8 2Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
              </svg>
            </IconButton>
          </div>
        ),
      },
      {
        id: 'icon-button-shapes',
        name: 'IconButton - Shapes',
        description: 'Demo',
        category: 'basic',
        component: () => (
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <IconButton shape="square" variant="primary" aria-label="Square">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <rect x="3" y="3" width="10" height="10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </IconButton>
            <IconButton shape="circle" variant="primary" aria-label="Circle">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="5" stroke="currentColor" strokeWidth="2"/>
              </svg>
            </IconButton>
          </div>
        ),
      },
      {
        id: 'window-controls-demo',
        name: 'WindowControls - Window controls',
        description: 'Demo',
        category: 'basic',
        component: () => (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <WindowControls
                onMinimize={() => {}}
                onMaximize={() => {}}
                onClose={() => {}}
              />
            </div>
            <div>
              <WindowControls
                showMinimize={false}
                onMaximize={() => {}}
                onClose={() => {}}
              />
            </div>
            <div>
              <WindowControls
                showMaximize={false}
                onMinimize={() => {}}
                onClose={() => {}}
              />
            </div>
          </div>
        ),
      },
    ],
  },
  {
    id: 'feedback',
    name: 'Feedback Components',
    description: 'Demo',
    layoutType: 'demo',
    components: [
      {
        id: 'cube-loading-variants',
        name: 'CubeLoading - All variants',
        description: '3x3x3 cube loading animation demo',
        category: 'feedback',
        component: () => (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '32px', padding: '20px' }}>
            {}
            <div>
              <div style={{ fontSize: '12px', color: previewTextDisabled, marginBottom: '16px', fontWeight: 500 }}>Size</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '48px', alignItems: 'flex-end' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                  <CubeLoading size="small" />
                  <span style={{ fontSize: '12px', color: previewTextSubtle }}>Small</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                  <CubeLoading size="medium" />
                  <span style={{ fontSize: '12px', color: previewTextSubtle }}>Medium</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                  <CubeLoading size="large" />
                  <span style={{ fontSize: '12px', color: previewTextSubtle }}>Large</span>
                </div>
              </div>
            </div>
            {}
            <div>
              <div style={{ fontSize: '12px', color: previewTextDisabled, marginBottom: '16px', fontWeight: 500 }}>With text</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '48px', alignItems: 'flex-start' }}>
                <CubeLoading text="Loading.." />
                <CubeLoading size="large" text="Loading.." />
              </div>
            </div>
          </div>
        ),
      },
      {
        id: 'modal-basic',
        name: 'Modal - Basic',
        description: 'Basic modal',
        category: 'feedback',
        component: () => {
          const [isOpen, setIsOpen] = React.useState(false);
          return (
            <>
              <Button onClick={() => setIsOpen(true)}>Open modal</Button>
              <Modal
                isOpen={isOpen}
                onClose={() => setIsOpen(false)}
                title="Basic modal"
              >
                <div style={{ padding: '16px' }}>
                  <p>Modal body content</p>
                </div>
              </Modal>
            </>
          );
        },
      },
      {
        id: 'alert-demo',
        name: 'Alert - Four types',
        description: 'Demo',
        category: 'feedback',
        component: () => (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <Alert type="success" title="Success" message="Operation completed" closable />
            <Alert type="error" title="Error" message="Something went wrong" closable />
            <Alert type="warning" message="Warning message" />
            <Alert type="info" message="Info message" showIcon />
          </div>
        ),
      },
      {
        id: 'stream-text-demo',
        name: 'StreamText - Streaming text demo',
        description: 'AI streaming typewriter effect',
        category: 'feedback',
        component: () => {
          const [key, setKey] = React.useState(0);

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '20px' }}>
              <div style={{
                fontSize: '15px',
                lineHeight: '1.8',
                minHeight: '120px',
                padding: '20px',
                background: 'var(--bf-appearance-token-color-overlay-white-04)',
                borderRadius: '8px',
                border: '1px solid var(--bf-appearance-token-color-overlay-white-12)',
                maxWidth: '700px'
              }}>
                <StreamText
                  key={key}
                  text="Streaming AI demo text."
                  effect="smooth"
                  speed={30}
                  showCursor={true}
                />
              </div>
              <Button
                size="small"
                variant="secondary"
                onClick={() => setKey(prev => prev + 1)}
              >
                Replay
              </Button>
            </div>
          );
        },
      },
    ],
  },
  {
    id: 'form',
    name: 'Form Components',
    description: 'Input form components',
    layoutType: 'grid-2',
    components: [
      {
        id: 'input-demo',
name: 'Input - Demo',
        description: 'Demo',
        category: 'form',
        component: () => (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '400px' }}>
            <Input placeholder="Enter text" />
            <Input label="Label" placeholder="Placeholder" />
            <Input
              label="Email"
              type="email"
              placeholder="example@email.com"
              prefix="@"
            />
            <Input
              label="Password"
              type="password"
              placeholder="Enter password"
              error
              errorMessage="Error message"
            />
            <Input variant="filled" placeholder="Filled variant" />
            <Input variant="outlined" placeholder="Outlined variant" />
          </div>
        ),
      },
      {
        id: 'search-demo',
name: 'Search - Demo',
        description: 'Demo',
        category: 'form',
        component: () => {
          const [value, setValue] = React.useState('');
          const [loading, setLoading] = React.useState(false);
          const [searchOptions, setSearchOptions] = React.useState({
            caseSensitive: false,
            useRegex: false,
          });

          const handleSearch = (val: string) => {
            setLoading(true);
            setTimeout(() => {
              setLoading(false);
            }, 1500);
          };

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '500px' }}>
              <Search
                placeholder="Search keywords.."
                onChange={(val) => setValue(val)}
              />
              <Search
                placeholder="Search"
                showSearchButton
                onSearch={handleSearch}
                loading={loading}
              />
              <Search
                placeholder="With suffix"
                suffixContent={
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button
                      style={{
                        padding: '4px 6px',
                        background: searchOptions.caseSensitive ? 'color-mix(in srgb, var(--bf-appearance-token-color-accent-500) 20%, transparent)' : 'transparent',
                        border: '1px solid var(--bf-appearance-token-color-overlay-white-12)',
                        borderRadius: '4px',
                        color: searchOptions.caseSensitive ? 'var(--bf-appearance-token-color-accent-500)' : 'var(--bf-appearance-token-color-text-muted)',
                        cursor: 'pointer',
                        fontSize: '12px',
                      }}
                      onClick={() => setSearchOptions(prev => ({ ...prev, caseSensitive: !prev.caseSensitive }))}
                      title="Option"
                    >
                      Aa
                    </button>
                    <button
                      style={{
                        padding: '4px 6px',
                        background: searchOptions.useRegex ? 'color-mix(in srgb, var(--bf-appearance-token-color-accent-500) 20%, transparent)' : 'transparent',
                        border: '1px solid var(--bf-appearance-token-color-overlay-white-12)',
                        borderRadius: '4px',
                        color: searchOptions.useRegex ? 'var(--bf-appearance-token-color-accent-500)' : 'var(--bf-appearance-token-color-text-muted)',
                        cursor: 'pointer',
                        fontSize: '12px',
                      }}
                      onClick={() => setSearchOptions(prev => ({ ...prev, useRegex: !prev.useRegex }))}
                      title="Option"
                    >
                      .*
                    </button>
                  </div>
                }
              />
              <Search
                placeholder="Search..."
                expandOnFocus
              />
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                <Search size="small" placeholder="Search" />
                <Search size="medium" placeholder="Search" />
                <Search size="large" placeholder="Search" />
              </div>
              <Search
                placeholder="Disabled"
                disabled
              />
              <Search
                placeholder="Error"
                error
                errorMessage="Error message"
              />
            </div>
          );
        },
      },
      {
        id: 'checkbox-demo',
        name: 'Checkbox - Demo',
        description: 'Checkbox demo',
        category: 'form',
        component: () => {
          const [checked, setChecked] = React.useState(false);
          const [indeterminate, setIndeterminate] = React.useState(true);

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <Checkbox label="Option" />
              <Checkbox
                label="Option"
                description="Description"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
              />
              <Checkbox
                label="Indeterminate"
                indeterminate={indeterminate}
                onChange={() => setIndeterminate(false)}
              />
              <Checkbox label="Option" disabled />
              <Checkbox label="Option" error />
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <Checkbox size="small" label="Small" />
                <Checkbox size="medium" label="Medium" />
                <Checkbox size="large" label="Large" />
              </div>
            </div>
          );
        },
      },
      {
        id: 'switch-demo',
        name: 'Switch - Demo',
        description: 'Demo',
        category: 'form',
        component: () => {
          const [checked, setChecked] = React.useState(false);
          const [loading, setLoading] = React.useState(false);

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <Switch label="Option" />
              <Switch
                label="Option"
                description="Description"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
              />
              <Switch
                label="Loading"
                loading={loading}
                checked={loading}
                onChange={(e) => {
                  setLoading(true);
                  setTimeout(() => setLoading(false), 2000);
                }}
              />
              <Switch label="Option" disabled />
              <Switch
                checkedText="ON"
                uncheckedText="OFF"
                label="With labels"
              />
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <Switch size="small" />
                <Switch size="medium" />
                <Switch size="large" />
              </div>
            </div>
          );
        },
      },
      {
        id: 'textarea-demo',
        name: 'Textarea - Demo',
        description: 'Demo',
        category: 'form',
        component: () => {
          const [value, setValue] = React.useState('');

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '500px' }}>
              <Textarea
                label="Label"
                placeholder="Placeholder..."
              />
              <Textarea
                label="Character limit"
                placeholder="Up to 100 characters.."
                showCount
                maxLength={100}
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
              <Textarea
                label="Auto-resize height"
                placeholder="Content auto-resizes height..."
                autoResize
              />
              <Textarea
                label="Error"
                error
                errorMessage="Please enter valid content"
                placeholder="Enter content.."
              />
              <Textarea
                variant="filled"
                placeholder="Filled variant"
              />
              <Textarea
                variant="outlined"
                placeholder="Outlined variant"
              />
            </div>
          );
        },
      },
    ],
  },
  {
    id: 'content',
    name: 'Content Components',
    description: 'Components that display content and media',
    layoutType: 'large-card',
    components: [
      {
        id: 'markdown-viewer',
        name: 'Markdown Demo',
description: 'Markdown with GFM support',
        category: 'content',
        component: () => (
          <Markdown
            content={`# Markdown Demo

This is a **Markdown** rendering example

## Features

- Code highlighting
- GFM support
- Math formulas
- Table support

\`\`\`js
console.log('Hello, BitFun!');
\`\`\`

> Blockquote example`}
          />
        ),
      },
      {
        id: 'code-editor',
        name: 'CodeEditor',
        description: 'Code editor based on Monaco Editor',
        category: 'content',
        component: () => {
          const [code, setCode] = React.useState(`// TypeScript example
interface User {
  name: string;
  age: number;
  email?: string;
}

class Person implements User {
  constructor(
    public name: string,
    public age: number,
    public email?: string
  ) {}

  greet(): string {
    return \`Hello, I'm \${this.name}\`;
  }
}

const user = new Person("Alice", 25);
console.log(user.greet());`);

          return (
            <div style={{ width: '100%' }}>
              <CodeEditor
                value={code}
                language="typescript"
                height="350px"
                minimap={false}
                lineNumbers="on"
                onChange={(value) => setCode(value || '')}
              />
            </div>
          );
        },
      },
    ],
  },
  {
    id: 'navigation',
    name: 'Navigation Components',
    description: 'Demo',
    layoutType: 'grid-2',
    components: [
      {
        id: 'tabs-demo',
        name: 'Tabs - Demo',
        description: 'Demo',
        category: 'navigation',
        component: () => (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <Tabs type="line" defaultActiveKey="1">
              <TabPane tabKey="1" label="Tab 1">
                <div style={{ padding: '16px' }}>Line type - Content 1</div>
              </TabPane>
              <TabPane tabKey="2" label="Tab 2">
                <div style={{ padding: '16px' }}>Line type - Content 2</div>
              </TabPane>
              <TabPane tabKey="3" label="Tab 3">
                <div style={{ padding: '16px' }}>Line type - Content 3</div>
              </TabPane>
            </Tabs>

            <Tabs type="card" defaultActiveKey="1">
              <TabPane tabKey="1" label="Card 1">
                <div style={{ padding: '16px' }}>Card type - Content 1</div>
              </TabPane>
              <TabPane tabKey="2" label="Card 2">
                <div style={{ padding: '16px' }}>Card type - Content 2</div>
              </TabPane>
            </Tabs>

            <Tabs type="pill" defaultActiveKey="1">
              <TabPane tabKey="1" label="Pill 1">
                <div style={{ padding: '16px' }}>Pill type - Content 1</div>
              </TabPane>
              <TabPane tabKey="2" label="Pill 2">
                <div style={{ padding: '16px' }}>Pill type - Content 2</div>
              </TabPane>
            </Tabs>
          </div>
        ),
      },
    ],
  },
  {
    id: 'advanced-feedback',
    name: 'Advanced Feedback',
    description: 'Advanced feedback components',
    layoutType: 'grid-3',
    components: [
      {
        id: 'tooltip-demo',
        name: 'Tooltip - Placement demo',
        description: 'Tooltip',
        category: 'advanced-feedback',
        component: () => (
          <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', justifyContent: 'center', padding: '40px' }}>
            <Tooltip content="Top tooltip" placement="top">
              <Button>Top</Button>
            </Tooltip>
            <Tooltip content="Bottom tooltip" placement="bottom">
              <Button>Bottom</Button>
            </Tooltip>
            <Tooltip content="Left tooltip" placement="left">
              <Button>Left</Button>
            </Tooltip>
            <Tooltip content="Right tooltip" placement="right">
              <Button>Right</Button>
            </Tooltip>
          </div>
        ),
      },
    ],
  },
  {
    id: 'flowchat-cards',
    name: 'FlowChat Cards',
    description: 'Preview of FlowChat tool-call card components',
    layoutType: 'column',
    components: [
      {
        id: 'read-file-card',
        name: 'ReadFile - File read card',
        description: 'Tool card for reading files',
        category: 'flowchat-cards',
        component: () => (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '20px' }}>
            <h3 style={{ color: 'var(--bf-appearance-token-color-static-white)', marginBottom: '8px' }}>Read file - Success</h3>
            <ReadFileDisplay
              toolItem={createMockToolItem('Read',
                { target_file: 'src/App.tsx', offset: 1, limit: 50 },
                {
                  content: 'import React from "react";\n\nfunction App() {\n  return <div>Hello World</div>;\n}\n\nexport default App;',
                  lines_read: 7,
                  total_lines: 150,
                  file_size: 2048
                },
                'completed'
              )}
              config={TOOL_CARD_CONFIGS['Read']}
              sessionId="preview-session"
            />

            <h3 style={{ color: 'var(--bf-appearance-token-color-static-white)', marginTop: '16px', marginBottom: '8px' }}>Read file - Running</h3>
            <ReadFileDisplay
              toolItem={createMockToolItem('Read',
                { target_file: 'src/components/Header.tsx' },
                undefined,
                'running'
              )}
              config={TOOL_CARD_CONFIGS['Read']}
              sessionId="preview-session"
            />
          </div>
        ),
      },
      {
        id: 'file-operation-card',
        name: 'FileOperation - File operation card',
        description: 'Tool card for file write, edit, and delete operations',
        category: 'flowchat-cards',
        component: () => (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '20px' }}>
            <h3 style={{ color: 'var(--bf-appearance-token-color-static-white)', marginBottom: '8px' }}>Write file</h3>
            <FileOperationToolCard
              toolItem={createMockToolItem('Write',
                {
                  file_path: 'src/newFile.ts',
                  contents: 'export const greeting = "Hello World";'
                },
                { success: true },
                'completed'
              )}
              config={TOOL_CARD_CONFIGS['Write']}
              sessionId="preview-session"
            />

            <h3 style={{ color: 'var(--bf-appearance-token-color-static-white)', marginTop: '16px', marginBottom: '8px' }}>Edit file</h3>
            <FileOperationToolCard
              toolItem={createMockToolItem('Edit',
                {
                  file_path: 'src/components/Header.tsx',
                  old_string: 'const title = "Old Title"',
                  new_string: 'const title = "New Title"'
                },
                { success: true },
                'completed'
              )}
              config={TOOL_CARD_CONFIGS['Edit']}
              sessionId="preview-session"
            />

            <h3 style={{ color: 'var(--bf-appearance-token-color-static-white)', marginTop: '16px', marginBottom: '8px' }}>Delete file</h3>
            <FileOperationToolCard
              toolItem={createMockToolItem('Delete',
                { target_file: 'src/oldFile.ts' },
                { success: true },
                'completed'
              )}
              config={TOOL_CARD_CONFIGS['Delete']}
              sessionId="preview-session"
            />
          </div>
        ),
      },
      {
        id: 'search-card',
        name: 'Search - Search card',
        description: 'Search tool result display',
        category: 'flowchat-cards',
        component: () => (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '20px' }}>
            <h3 style={{ color: 'var(--bf-appearance-token-color-static-white)', marginBottom: '8px' }}>Grep search results</h3>
            <GrepSearchDisplay
              toolItem={createMockToolItem('Grep',
                { pattern: 'function', path: 'src/' },
                {
                  matches: [
                    'src/app.ts:10:function main() {',
                    'src/utils.ts:5:function helper() {'
                  ],
                  total_matches: 2,
                  files_searched: 10
                },
                'completed'
              )}
              config={TOOL_CARD_CONFIGS['Grep']}
              sessionId="preview-session"
            />

            <h3 style={{ color: 'var(--bf-appearance-token-color-static-white)', marginTop: '16px', marginBottom: '8px' }}>Grep - Multiple results example</h3>
            <GrepSearchDisplay
              toolItem={createMockToolItem('Grep',
                { pattern: 'import React', path: 'src/components' },
                {
                  matches: [
                    "src/components/App.tsx:1:import React from 'react';",
                    "src/components/Header.tsx:1:import React from 'react';",
                    "src/components/Button.tsx:1:import React from 'react';"
                  ],
                  total_matches: 3,
                  files_searched: 20
                },
                'completed'
              )}
              config={TOOL_CARD_CONFIGS['Grep']}
              sessionId="preview-session"
            />

            <h3 style={{ color: 'var(--bf-appearance-token-color-static-white)', marginTop: '16px', marginBottom: '8px' }}>Glob search results</h3>
            <GlobSearchDisplay
              toolItem={createMockToolItem('Glob',
                { glob_pattern: '*.tsx' },
                {
                  files: ['App.tsx', 'Header.tsx', 'Footer.tsx', 'Button.tsx'],
                  total_count: 4
                },
                'completed'
              )}
              config={TOOL_CARD_CONFIGS['Glob']}
              sessionId="preview-session"
            />

            <h3 style={{ color: 'var(--bf-appearance-token-color-static-white)', marginTop: '16px', marginBottom: '8px' }}>LS directory listing</h3>
            <LSDisplay
              toolItem={createMockToolItem('LS',
                { target_directory: 'src/components' },
                {
                  items: [
                    'App.tsx',
                    'Header.tsx',
                    'Footer.tsx',
                    'Button.tsx',
                    'Input.tsx'
                  ],
                  total_count: 5
                },
                'completed'
              )}
              config={TOOL_CARD_CONFIGS['LS']}
              sessionId="preview-session"
            />
          </div>
        ),
      },
      {
        id: 'task-card',
        name: 'Task - AI task card',
        description: 'AI task execution card',
        category: 'flowchat-cards',
        component: () => (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '20px' }}>
            <h3 style={{ color: 'var(--bf-appearance-token-color-static-white)', marginBottom: '8px' }}>AI task - Running</h3>
            <TaskToolDisplay
              toolItem={createMockToolItem('Task',
                {
                  description: 'Analyze codebase structure',
                  prompt: 'Analyze the current project code structure',
                  model_name: 'claude-3.5-sonnet',
                  subagent_type: 'code-analyzer'
                },
                undefined,
                'running'
              )}
              config={TOOL_CARD_CONFIGS['Task']}
              sessionId="preview-session"
            />

            <h3 style={{ color: 'var(--bf-appearance-token-color-static-white)', marginTop: '16px', marginBottom: '8px' }}>AI task - Completed</h3>
            <TaskToolDisplay
              toolItem={createMockToolItem('Task',
                {
                  description: 'Create a new feature',
                  prompt: 'Create a new feature module',
                  model_name: 'claude-3.5-sonnet',
                  subagent_type: 'architect'
                },
                {
                  status: 'completed',
                  result: `Task completed successfully

1. Set up the React + TypeScript environment
2. Configure Zustand state management
3. Add SCSS and BEM styling system
4. Implement core components

All requirements have been met`,
                  duration_ms: 12500,
                  tool_uses: 8
                },
                'completed'
              )}
              config={TOOL_CARD_CONFIGS['Task']}
              sessionId="preview-session"
            />
          </div>
        ),
      },
      {
        id: 'todo-card',
        name: 'TodoWrite - Todo task management',
        description: 'Todo task status card',
        category: 'flowchat-cards',
        component: () => (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '20px' }}>
            <h3 style={{ color: 'var(--bf-appearance-token-color-static-white)', marginBottom: '8px' }}>Todo - Basic example</h3>
            <TodoWriteDisplay
              toolItem={createMockToolItem('TodoWrite',
                {
                  todos: [
                    { id: '1', content: 'Task A', status: 'completed' },
                    { id: '2', content: 'Task B', status: 'in_progress' },
                    { id: '3', content: 'Task C', status: 'pending' }
                  ]
                },
                {
                  todos: [
                    { id: '1', content: 'Task A', status: 'completed' },
                    { id: '2', content: 'Task B', status: 'in_progress' },
                    { id: '3', content: 'Task C', status: 'pending' }
                  ]
                },
                'completed'
              )}
              config={TOOL_CARD_CONFIGS['TodoWrite']}
              sessionId="preview-session"
            />

            <h3 style={{ color: 'var(--bf-appearance-token-color-static-white)', marginTop: '16px', marginBottom: '8px' }}>Todo - Multi-task example</h3>
            <TodoWriteDisplay
              toolItem={createMockToolItem('TodoWrite',
                {
                  todos: [
                    { id: '1', content: 'Task 1', status: 'completed' },
                    { id: '2', content: 'Task 2', status: 'in_progress' },
                    { id: '3', content: 'Integrate API', status: 'in_progress' },
                    { id: '4', content: 'Task 4', status: 'in_progress' },
                    { id: '5', content: 'Task 5', status: 'pending' },
                    { id: '6', content: 'Task 6', status: 'pending' }
                  ]
                },
                {
                  todos: [
                    { id: '1', content: 'Task 1', status: 'completed' },
                    { id: '2', content: 'Task 2', status: 'in_progress' },
                    { id: '3', content: 'Integrate API', status: 'in_progress' },
                    { id: '4', content: 'Task 4', status: 'in_progress' },
                    { id: '5', content: 'Task 5', status: 'pending' },
                    { id: '6', content: 'Task 6', status: 'pending' }
                  ]
                },
                'completed'
              )}
              config={TOOL_CARD_CONFIGS['TodoWrite']}
              sessionId="preview-session"
            />

            <h3 style={{ color: 'var(--bf-appearance-token-color-static-white)', marginTop: '16px', marginBottom: '8px' }}>Todo progress - In progress</h3>
            <TodoWriteDisplay
              toolItem={createMockToolItem('TodoWrite',
                {
                  todos: [
                    { id: '1', content: 'Task 1', status: 'completed' },
                    { id: '2', content: 'Task 2', status: 'completed' },
                    { id: '3', content: 'Task 3', status: 'in_progress' },
                    { id: '4', content: 'Task 4', status: 'pending' },
                    { id: '5', content: 'Task 5', status: 'pending' }
                  ]
                },
                {
                  todos: [
                    { id: '1', content: 'Task 1', status: 'completed' },
                    { id: '2', content: 'Task 2', status: 'completed' },
                    { id: '3', content: 'Task 3', status: 'in_progress' },
                    { id: '4', content: 'Task 4', status: 'pending' },
                    { id: '5', content: 'Task 5', status: 'pending' }
                  ]
                },
                'completed'
              )}
              config={TOOL_CARD_CONFIGS['TodoWrite']}
              sessionId="preview-session"
            />

            <h3 style={{ color: 'var(--bf-appearance-token-color-static-white)', marginTop: '16px', marginBottom: '8px' }}>Todo - Pending</h3>
            <TodoWriteDisplay
              toolItem={createMockToolItem('TodoWrite',
                {
                  todos: [
                    { id: '1', content: 'Item', status: 'pending' },
                    { id: '2', content: 'Integrate API', status: 'pending' },
                    { id: '3', content: 'Task 3', status: 'pending' },
                    { id: '4', content: 'Task 4', status: 'pending' }
                  ]
                },
                {
                  todos: [
                    { id: '1', content: 'Item', status: 'pending' },
                    { id: '2', content: 'Integrate API', status: 'pending' },
                    { id: '3', content: 'Task 3', status: 'pending' },
                    { id: '4', content: 'Task 4', status: 'pending' }
                  ]
                },
                'completed'
              )}
              config={TOOL_CARD_CONFIGS['TodoWrite']}
              sessionId="preview-session"
            />

            <h3 style={{ color: 'var(--bf-appearance-token-color-static-white)', marginTop: '16px', marginBottom: '8px' }}>Todo - Completed</h3>
            <TodoWriteDisplay
              toolItem={createMockToolItem('TodoWrite',
                {
                  todos: [
                    { id: '1', content: 'Task 1', status: 'completed' },
                    { id: '2', content: 'Task 2', status: 'completed' },
                    { id: '3', content: 'Task 3', status: 'completed' }
                  ]
                },
                {
                  todos: [
                    { id: '1', content: 'Task 1', status: 'completed' },
                    { id: '2', content: 'Task 2', status: 'completed' },
                    { id: '3', content: 'Task 3', status: 'completed' }
                  ]
                },
                'completed'
              )}
              config={TOOL_CARD_CONFIGS['TodoWrite']}
              sessionId="preview-session"
            />
          </div>
        ),
      },
      {
        id: 'web-search-card',
        name: 'WebSearch - Search results card',
        description: 'Web search results and URL display',
        category: 'flowchat-cards',
        component: () => (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '20px' }}>
            <h3 style={{ color: 'var(--bf-appearance-token-color-static-white)', marginBottom: '8px' }}>Web search - Results</h3>
            <RealWebSearchCard
              toolItem={createMockToolItem('WebSearch',
                { query: 'React Hooks tutorial' },
                {
                  results: [
                    {
                      title: 'React Hooks guide',
                      url: 'https://react.dev/hooks',
                      snippet: 'Learn the basics and best practices of React Hooks...'
                    }
                  ]
                },
                'completed'
              )}
              config={TOOL_CARD_CONFIGS['WebSearch']}
              sessionId="preview-session"
            />

            <h3 style={{ color: 'var(--bf-appearance-token-color-static-white)', marginTop: '16px', marginBottom: '8px' }}>Multiple results - Web search</h3>
            <RealWebSearchCard
              toolItem={createMockToolItem('WebSearch',
                { query: 'TypeScript best practices' },
                {
                  results: [
                    {
                      title: 'TypeScript Best Practices',
                      url: 'https://www.typescriptlang.org/docs/handbook/declaration-files/do-s-and-don-ts.html',
                      snippet: 'This guide covers the best practices for writing TypeScript code...'
                    },
                    {
                      title: 'TypeScript Deep Dive',
                      url: 'https://basarat.gitbook.io/typescript/',
                      snippet: 'A comprehensive guide to TypeScript...'
                    },
                    {
                      title: 'Clean Code with TypeScript',
                      url: 'https://github.com/labs42io/clean-code-typescript',
                      snippet: "Software engineering principles, from Robert C. Martin's book..."
                    }
                  ]
                },
                'completed'
              )}
              config={TOOL_CARD_CONFIGS['WebSearch']}
              sessionId="preview-session"
            />
          </div>
        ),
      },
      {
        id: 'mcp-tool-card',
        name: 'MCP - MCP tool card',
        description: 'Card component that displays MCP tool calls',
        category: 'flowchat-cards',
        component: () => (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '20px' }}>
            <h3 style={{ color: 'var(--bf-appearance-token-color-static-white)', marginBottom: '8px' }}>MCP tool - File list</h3>
            <MCPToolDisplay
              toolItem={createMockToolItem('mcp__server__list_files',
                { directory: '/project/src' },
                {
                  content: [
                    {
                      type: 'text',
                      text: 'Found 5 files:\n- App.tsx\n- Header.tsx\n- Footer.tsx\n- Button.tsx\n- Input.tsx'
                    }
                  ]
                },
                'completed'
              )}
              config={{
                toolName: 'mcp__server__list_files',
                displayName: 'list_files',
                icon: '🔌',
                requiresConfirmation: false,
                resultDisplayType: 'detailed',
                description: 'MCP tool call',
                displayMode: 'compact',
                primaryColor: 'var(--bf-appearance-token-color-purple-500)'
              }}
              sessionId="preview-session"
            />

            <h3 style={{ color: 'var(--bf-appearance-token-color-static-white)', marginTop: '16px', marginBottom: '8px' }}>MCP - Running</h3>
            <MCPToolDisplay
              toolItem={createMockToolItem('mcp__server__fetch_data',
                { url: 'https://api.example.com/data' },
                undefined,
                'running'
              )}
              config={{
                toolName: 'mcp__server__fetch_data',
                displayName: 'fetch_data',
                icon: '🔌',
                requiresConfirmation: false,
                resultDisplayType: 'detailed',
                description: 'MCP tool call',
                displayMode: 'compact',
                primaryColor: 'var(--bf-appearance-token-color-purple-500)'
              }}
              sessionId="preview-session"
            />
          </div>
        ),
      },
      {
        id: 'context-compression-card',
        name: 'ContextCompression - Context compression',
        description: 'Context compression process card',
        category: 'flowchat-cards',
        component: () => (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '20px' }}>
            <h3 style={{ color: 'var(--bf-appearance-token-color-static-white)', marginBottom: '8px' }}>Context compression - Example</h3>
            <ContextCompressionDisplay
              toolItem={createMockToolItem('ContextCompression',
                {
                  trigger: 'ai_response',
                  tokens_before: 50000
                },
                {
                  compression_count: 3,
                  has_summary: true,
                  summary_source: 'model',
                  tokens_before: 50000,
                  tokens_after: 15000,
                  compression_ratio: 0.7,
                  duration: 2500
                },
                'completed'
              )}
            />

            <h3 style={{ color: 'var(--bf-appearance-token-color-static-white)', marginTop: '16px', marginBottom: '8px' }}>Context compression - Local fallback</h3>
            <ContextCompressionDisplay
              toolItem={createMockToolItem('ContextCompression',
                {
                  trigger: 'manual',
                  tokens_before: 42000
                },
                {
                  compression_count: 4,
                  has_summary: false,
                  summary_source: 'local_fallback',
                  tokens_before: 42000,
                  tokens_after: 18000,
                  compression_ratio: 0.43,
                  duration: 1800
                },
                'completed'
              )}
            />

            <h3 style={{ color: 'var(--bf-appearance-token-color-static-white)', marginTop: '16px', marginBottom: '8px' }}>Context compression - Running</h3>
            <ContextCompressionDisplay
              toolItem={createMockToolItem('ContextCompression',
                { trigger: 'user_message' },
                undefined,
                'running'
              )}
            />
          </div>
        ),
      },
      {
        id: 'skill-card',
        name: 'Skill - Skill invocation',
        description: 'Component that displays Skill invocation',
        category: 'flowchat-cards',
        component: () => (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '20px' }}>
            <h3 style={{ color: 'var(--bf-appearance-token-color-static-white)', marginBottom: '8px' }}>Skill invocation</h3>
            <SkillDisplay
              toolItem={createMockToolItem('Skill',
                {
                  skill_name: 'code-review',
                  skill_input: { file_path: 'src/App.tsx' }
                },
                {
                  result: 'Code review completed',
                  suggestions: ['Use React.memo', 'Optimize render performance', 'Fix existing warnings']
                },
                'completed'
              )}
              config={TOOL_CARD_CONFIGS['Skill']}
              sessionId="preview-session"
            />
          </div>
        ),
      },
      {
        id: 'ask-user-card',
        name: 'AskUserQuestion - User question',
        description: 'AI user question card',
        category: 'flowchat-cards',
        component: () => (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '20px' }}>
            <h3 style={{ color: 'var(--bf-appearance-token-color-static-white)', marginBottom: '8px' }}>Ask user - Single question example</h3>
            <AskUserQuestionCard
              toolItem={createMockToolItem('AskUserQuestion',
                {
                  questions: [
                    {
                      question: 'Which option do you prefer?',
                      header: 'Question',
                      options: [
                        { label: 'Option 1', description: 'First option' },
                        { label: 'Option 2', description: 'Second option' },
                        { label: 'Option 3', description: 'Third option' }
                      ],
                      multiSelect: false
                    }
                  ]
                },
                undefined,
                'running'
              )}
              config={TOOL_CARD_CONFIGS['AskUserQuestion']}
              sessionId="preview-session"
            />

            <h3 style={{ color: 'var(--bf-appearance-token-color-static-white)', marginBottom: '8px' }}>Multiple questions - Single and multi select</h3>
            <AskUserQuestionCard
              toolItem={createMockToolItem('AskUserQuestion',
                {
                  questions: [
                    {
                      question: 'Which UI framework would you like to use?',
                      header: 'UI framework',
                      options: [
                        { label: 'React', description: 'Use the React framework' },
                        { label: 'Vue', description: 'Use the Vue framework' },
                        { label: 'Angular', description: 'Use the Angular framework' }
                      ],
                      multiSelect: false
                    },
                    {
                      question: 'Which development tools do you need?',
                      header: 'Development tools',
                      options: [
                        { label: 'TypeScript', description: 'Use TypeScript' },
                        { label: 'ESLint', description: 'Code style checks' },
                        { label: 'Prettier', description: 'Code formatter' },
                        { label: 'Other', description: 'Other development tools' }
                      ],
                      multiSelect: true
                    }
                  ]
                },
                undefined,
                'running'
              )}
              config={TOOL_CARD_CONFIGS['AskUserQuestion']}
              sessionId="preview-session"
            />

            <h3 style={{ color: 'var(--bf-appearance-token-color-static-white)', marginBottom: '8px' }}>Answered - Database selection</h3>
            <AskUserQuestionCard
              toolItem={createMockToolItem('AskUserQuestion',
                {
                  questions: [
                    {
                      question: 'Which database would you like to use?',
                      header: 'Database',
                      options: [
                        { label: 'PostgreSQL', description: 'Relational database' },
                        { label: 'MongoDB', description: 'NoSQL document database' },
                        { label: 'SQLite', description: 'Lightweight embedded database' }
                      ],
                      multiSelect: false
                    }
                  ]
                },
                {
                  status: 'answered',
                  answers: { "0": "PostgreSQL" }
                },
                'completed'
              )}
              config={TOOL_CARD_CONFIGS['AskUserQuestion']}
              sessionId="preview-session"
            />
          </div>
        ),
      },
      {
        id: 'reproduction-steps-card',
        name: 'ReproductionSteps - Reproduction steps',
        description: 'Card that shows reproduction steps and waits for user confirmation',
        category: 'flowchat-cards',
        component: () => {
          const CompletedReproductionSteps = () => {
            const [hasProceeded] = React.useState(true);
            return (
              <div className={`reproduction-steps-block ${hasProceeded ? 'proceeded' : ''}`}>
                <div className="reproduction-steps-header">
                  <div className="reproduction-steps-icon">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                  </div>
                  <div className="reproduction-steps-title">Steps</div>
                </div>
                <div className="reproduction-steps-content">
                  <ol className="reproduction-steps-list">
                    <li className="reproduction-step-item">Step 1</li>
                    <li className="reproduction-step-item">Step 2</li>
                    <li className="reproduction-step-item">Step 3</li>
                  </ol>
                </div>
                <div className="reproduction-steps-completed">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                  <span>Waiting for AI to proceed...</span>
                </div>
              </div>
            );
          };

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '20px' }}>
              <h3 style={{ color: 'var(--bf-appearance-token-color-static-white)', marginBottom: '8px' }}>Reproduction Steps</h3>
              <ReproductionStepsBlock
                steps={`1. Run npm run dev
2. Open http://localhost:3000
3. Click "Button"
4. Check console`}
                onProceed={() => {}}
              />

              <h3 style={{ color: 'var(--bf-appearance-token-color-static-white)', marginTop: '16px', marginBottom: '8px' }}>Completed</h3>
              <CompletedReproductionSteps />
            </div>
          );
        },
      },
      {
        id: 'create-plan-card',
        name: 'CreatePlan - Plan creation',
        description: 'Plan creation card',
        category: 'flowchat-cards',
        component: () => (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '20px' }}>
            <h3 style={{ color: 'var(--bf-appearance-token-color-static-white)', marginBottom: '8px' }}>Create Plan - Streaming</h3>
            <CreatePlanDisplay
              toolItem={createMockToolItem('CreatePlan',
                {
                  name: 'Plan Name',
                  overview: 'Plan overview...'
                },
                null,
                'streaming'
              )}
              config={TOOL_CARD_CONFIGS['CreatePlan']}
              sessionId="preview-session"
            />

            <h3 style={{ color: 'var(--bf-appearance-token-color-static-white)', marginTop: '16px', marginBottom: '8px' }}>Create plan - Completed</h3>
            <CreatePlanDisplay
              toolItem={createMockToolItem('CreatePlan',
                {},
                {
                  plan_file_path: '<bitfun-home>/projects/project-slug/plans/refactor-user-module.plan.md',
                  name: 'Refactor Module',
                  overview: 'Plan overview',
                  todos: [
                    { id: 'todo-1', content: 'Task 1', status: 'completed' },
                    { id: 'todo-2', content: 'Task 2', status: 'completed' },
                    { id: 'todo-3', content: 'Task 3', status: 'in_progress' },
                    { id: 'todo-4', content: 'Add CRUD operations', status: 'pending' },
                    { id: 'todo-5', content: 'Task 5', status: 'pending' },
                    { id: 'todo-6', content: 'API integration', status: 'pending' }
                  ]
                },
                'completed'
              )}
              config={TOOL_CARD_CONFIGS['CreatePlan']}
              sessionId="preview-session"
            />

            <h3 style={{ color: 'var(--bf-appearance-token-color-static-white)', marginTop: '16px', marginBottom: '8px' }}>Create Plan - Dark Mode</h3>
            <CreatePlanDisplay
              toolItem={createMockToolItem('CreatePlan',
                {},
                {
                  plan_file_path: '<bitfun-home>/projects/project-slug/plans/add-dark-mode.plan.md',
                  name: 'Dark Mode',
                  overview: 'Add dark mode support',
                  todos: [
                    { id: 'dm-1', content: 'Add CSS variables', status: 'completed' },
                    { id: 'dm-2', content: 'Update components', status: 'completed' },
                    { id: 'dm-3', content: 'Diagram 3', status: 'completed' }
                  ]
                },
                'completed'
              )}
              config={TOOL_CARD_CONFIGS['CreatePlan']}
              sessionId="preview-session"
            />
          </div>
        ),
      },
      {
        id: 'git-tool-card',
        name: 'Git - Version control card',
        description: 'Tool card component that displays Git operation results',
        category: 'flowchat-cards',
        component: () => (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '20px' }}>
            <h3 style={{ color: 'var(--bf-appearance-token-color-static-white)', marginBottom: '8px' }}>Git Status - Success</h3>
            <GitToolDisplay
              toolItem={createMockToolItem('Git',
                {
                  operation: 'status',
                  args: '',
                  working_directory: '/project'
                },
                {
                  success: true,
                  exit_code: 0,
                  stdout: `On branch main
Your branch is up to date with 'origin/main'.

Changes to be committed:
  (use "git restore --staged <file>..." to unstage)
        modified:   src/components/App.tsx
        new file:   src/utils/helpers.ts

Changes not staged for commit:
  (use "git add <file>..." to update what will be committed)
        modified:   package.json`,
                  stderr: '',
                  execution_time_ms: 45,
                  working_directory: '/project',
                  command: 'git status',
                  operation: 'status'
                },
                'completed'
              )}
              config={TOOL_CARD_CONFIGS['Git']}
              sessionId="preview-session"
            />

            <h3 style={{ color: 'var(--bf-appearance-token-color-static-white)', marginTop: '16px', marginBottom: '8px' }}>Git Commit - Success</h3>
            <GitToolDisplay
              toolItem={createMockToolItem('Git',
                {
                  operation: 'commit',
                  args: '-m "feat: add new feature"',
                  working_directory: '/project'
                },
                {
                  success: true,
                  exit_code: 0,
                  stdout: `[main abc1234] feat: add new feature
 2 files changed, 45 insertions(+), 12 deletions(-)
 create mode 100644 src/utils/helpers.ts`,
                  stderr: '',
                  execution_time_ms: 120,
                  command: 'git commit -m "feat: add new feature"',
                  operation: 'commit'
                },
                'completed'
              )}
              config={TOOL_CARD_CONFIGS['Git']}
              sessionId="preview-session"
            />

            <h3 style={{ color: 'var(--bf-appearance-token-color-static-white)', marginTop: '16px', marginBottom: '8px' }}>Git Diff - View</h3>
            <GitToolDisplay
              toolItem={createMockToolItem('Git',
                {
                  operation: 'diff',
                  args: 'HEAD~1',
                  working_directory: '/project'
                },
                {
                  success: true,
                  exit_code: 0,
                  stdout: `diff --git a/src/App.tsx b/src/App.tsx
index abc1234..def5678 100644
--- a/src/App.tsx
+++ b/src/App.tsx
@@ -10,6 +10,8 @@ export function App() {
   const [count, setCount] = useState(0);
+  const [name, setName] = useState('');
+
   return (
     <div className="app">`,
                  stderr: '',
                  execution_time_ms: 35,
                  command: 'git diff HEAD~1',
                  operation: 'diff'
                },
                'completed'
              )}
              config={TOOL_CARD_CONFIGS['Git']}
              sessionId="preview-session"
            />

            <h3 style={{ color: 'var(--bf-appearance-token-color-static-white)', marginTop: '16px', marginBottom: '8px' }}>Git Push - Running</h3>
            <GitToolDisplay
              toolItem={createMockToolItem('Git',
                {
                  operation: 'push',
                  args: 'origin main',
                  working_directory: '/project'
                },
                null,
                'running'
              )}
              config={TOOL_CARD_CONFIGS['Git']}
              sessionId="preview-session"
            />

            <h3 style={{ color: 'var(--bf-appearance-token-color-static-white)', marginTop: '16px', marginBottom: '8px' }}>Git Pull - Conflict error</h3>
            <GitToolDisplay
              toolItem={createMockToolItem('Git',
                {
                  operation: 'pull',
                  args: 'origin main',
                  working_directory: '/project'
                },
                {
                  success: false,
                  exit_code: 1,
                  stdout: '',
                  stderr: `error: Your local changes to the following files would be overwritten by merge:
        src/config.ts
Please commit your changes or stash them before you merge.
Aborting`,
                  execution_time_ms: 1500,
                  command: 'git pull origin main',
                  operation: 'pull'
                },
                'error'
              )}
              config={TOOL_CARD_CONFIGS['Git']}
              sessionId="preview-session"
            />
          </div>
        ),
      },
      {
        id: 'init-miniapp-card',
        name: 'InitMiniApp - Mini app creation',
        description: 'Tool card after creating the Mini App skeleton (InitMiniApp)',
        category: 'flowchat-cards',
        component: () => (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '20px' }}>
            <h3 style={{ color: 'var(--bf-appearance-token-color-static-white)', marginBottom: '8px' }}>InitMiniApp - Running</h3>
            <InitMiniAppDisplay
              toolItem={createMockToolItem(
                'InitMiniApp',
                { name: 'Weather Dashboard', description: 'A small weather widget' },
                undefined,
                'running'
              )}
              config={TOOL_CARD_CONFIGS['InitMiniApp']}
              sessionId="preview-session"
            />

            <h3 style={{ color: 'var(--bf-appearance-token-color-static-white)', marginTop: '16px', marginBottom: '8px' }}>InitMiniApp - Streaming params</h3>
            <InitMiniAppDisplay
              toolItem={
                {
                  ...createMockToolItem('InitMiniApp', {}, undefined, 'streaming'),
                  isParamsStreaming: true,
                  partialParams: { name: 'My Mini App' },
                } as FlowToolItem
              }
              config={TOOL_CARD_CONFIGS['InitMiniApp']}
              sessionId="preview-session"
            />

            <h3 style={{ color: 'var(--bf-appearance-token-color-static-white)', marginTop: '16px', marginBottom: '8px' }}>InitMiniApp - Created successfully</h3>
            <InitMiniAppDisplay
              toolItem={createMockToolItem(
                'InitMiniApp',
                { name: 'Weather Dashboard' },
                {
                  app_id: 'ma-preview-001',
                  path: '.bitfun/miniapps/ma-preview-001',
                },
                'completed'
              )}
              config={TOOL_CARD_CONFIGS['InitMiniApp']}
              sessionId="preview-session"
            />
          </div>
        ),
      },
      {
        id: 'model-thinking-card',
        name: 'ModelThinking - Reasoning',
        description: 'Component that displays AI model reasoning state',
        category: 'flowchat-cards',
        component: () => {
          const createMockThinkingItem = (
            content: string,
            isStreaming: boolean,
            status: 'streaming' | 'completed'
          ): FlowThinkingItem => ({
            id: `thinking-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            type: 'thinking',
            timestamp: Date.now(),
            status,
            content,
            isStreaming,
            isCollapsed: !isStreaming
          });

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '20px' }}>
              <h3 style={{ color: 'var(--bf-appearance-token-color-static-white)', marginBottom: '8px' }}>Model reasoning - Streaming output</h3>
              <ModelThinkingDisplay
                thinkingItem={createMockThinkingItem(
                  `Analyzing the user's request..

Let me carefully think through a solution to this problem
- First, understand the user's specific needs
- Then consider feasible implementation approaches
- Finally, choose the optimal solution

Continue analyzing the details in depth..`,
                  true,
                  'streaming'
                )}
              />

              <h3 style={{ color: 'var(--bf-appearance-token-color-static-white)', marginTop: '16px', marginBottom: '8px' }}>Model reasoning - Collapsed completed state</h3>
              <ModelThinkingDisplay
                thinkingItem={createMockThinkingItem(
                  `Analyzed the user's question about performance optimization

Solution
1. Use virtual lists to reduce DOM rendering
2. Introduce React.memo to cache components
3. Lazy-load non-critical resources

Optimization focus
- Reduce unnecessary re-renders
- Use memoization appropriately
- Split large components

These approaches can significantly improve application performance`,
                  false,
                  'completed'
                )}
              />

              <h3 style={{ color: 'var(--bf-appearance-token-color-static-white)', marginTop: '16px', marginBottom: '8px' }}>Model reasoning - Long content display</h3>
              <ModelThinkingDisplay
                thinkingItem={createMockThinkingItem(
                  `This is a complex task that requires multi-step analysis

Background
The user wants to show the effect of various tool cards on the component library preview page, including the FlowChat-related ModelThinkingDisplay component

Requirements analysis
I need to create example data for ModelThinkingDisplay for the preview page, covering the following scenarios
- Streaming output state (simulating the dynamic effect of AI thinking)
- Completed collapsed state (collapsed by default once thinking finishes)

Implementation plan
In registry.tsx
1. Import the ModelThinkingDisplay component
2. Create FlowThinkingItem-typed data
3. Set up different state scenarios
4. Add display samples

Execution result
Successfully created reasoning display examples in three different states

Summary
The ModelThinkingDisplay component renders as expected`,
                  false,
                  'completed'
                )}
              />
            </div>
          );
        },
      },
    ],
  },
];
