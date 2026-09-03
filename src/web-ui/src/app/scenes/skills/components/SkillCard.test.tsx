// @vitest-environment jsdom

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import SkillCard from './SkillCard';

describe('SkillCard Appearance contract', () => {
  it('exposes avatar, name, description, leftContent, action, and disabled state', () => {
    const html = renderToStaticMarkup(
      <SkillCard
        name="agent-browser"
        description="Browse the web"
        leftContent={<span>12</span>}
        rightAction={{
          label: 'Install',
          disabled: true,
          onClick: () => undefined,
        }}
      />,
    );

    expect(html).toContain('data-bf-part="avatar"');
    expect(html).toContain('data-bf-part="name"');
    expect(html).toContain('data-bf-part="description"');
    expect(html).toContain('data-bf-part="leftContent"');
    expect(html).toContain('data-bf-part="action"');
    expect(html).toContain('disabled');
  });
});
