// @vitest-environment jsdom
import { browserFixtureFlags, cleanupBrowserFixture } from './browser-fixture.test-support';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { compile } from 'sass';
import { expect, it, vi } from 'vitest';
import { Disclosure } from '@bitfun/ui';
import { ConfigPageSection } from '@/infrastructure/config/components/common/ConfigPageLayout';
import { ConfigPageHeader } from '@/infrastructure/config/components/common/ConfigPageHeader';
import SkillCard from '@/app/scenes/skills/components/SkillCard';
import { SkillsPagination } from '@/app/scenes/skills/components/SkillsPagination';
import TodoCalendar from '@/app/scenes/todos/components/TodoCalendar';

const calendarProps = { occurrences: [], monthAnchorMs: new Date(2026,10,7).getTime(), nowMs: new Date(2026,10,7).getTime(), selectedDayKey: null, onSelectDay: vi.fn(), onShiftMonth: vi.fn(), onToday: vi.fn() };
const browser = process.env.BITFUN_TEST_BROWSER ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium'].find(existsSync);

it('keeps disclosure and calendar actions functional with local reading material', async () => {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const opened = vi.fn();
  try {
    await act(async () => root.render(<><Disclosure summary="More"><ConfigPageSection title="Options"><button>Save</button></ConfigPageSection></Disclosure><SkillCard name="Skill" onOpenDetails={opened}/><TodoCalendar {...calendarProps}/></>));
    const trigger = host.querySelector('[data-bitfun-component="disclosure"] button') as HTMLButtonElement;
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    await act(async () => trigger.click());
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelector('[data-bitfun-component="field-group"]')).not.toBeNull();
    (host.querySelector('.skills-card__open') as HTMLButtonElement).click(); expect(opened).toHaveBeenCalledOnce();
    const day = host.querySelector('[data-day-key="2026-11-07"]') as HTMLButtonElement;
    day.click(); expect(calendarProps.onSelectDay).toHaveBeenCalledWith('2026-11-07');
    expect(day.closest('[data-bitfun-reading-surface="before"]')).not.toBeNull();
    expect(host.querySelector('.skills-card')?.getAttribute('data-bitfun-reading-surface')).toBe('self');
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it.skipIf(!browser).each(['light','dark'])('protects real settings, skill and calendar markup while retaining clear gaps and geometry in %s', async mode => {
  const scratch = mkdtempSync(resolve(tmpdir(), 'skin-material-'));
  try {
    const markup = renderToStaticMarkup(<main className="bitfun-config-page-layout">
      <ConfigPageHeader title="Page title" extra={<button>Import</button>}/>
      <ConfigPageSection title="Collapsed" extra={<button>Expand</button>}>{false}</ConfigPageSection>
      <Disclosure summary="More" defaultOpen={true}><ConfigPageSection title="Expanded"><button>Save</button></ConfigPageSection></Disclosure>
      <SkillCard name="Skill" description="Readable description" onOpenDetails={() => {}}/>
      <SkillsPagination pagination={{page:1,totalPages:3,start:1,end:10}} total={30} listId="skills" onPageChange={()=>{}}/>
      <TodoCalendar {...calendarProps}/>
      <div id="gap"> </div>
    </main>);
    const css = compile(resolve('src/app/styles/visual-skin.scss')).css;
    const html = resolve(scratch,'test.html');
    const panel = mode==='light' ? 'rgba(255,255,255,.96)' : 'rgba(24,24,24,.96)';
    const foreground = mode==='light' ? 'rgb(40, 40, 40)' : 'rgb(245, 245, 245)';
    writeFileSync(html, `<!doctype html><html data-bitfun-skin-id="test"><head><style>
      :root{--bitfun-color-surface-panel:${panel};--bitfun-color-content-primary:${foreground};--bitfun-color-content-secondary:${foreground};--bitfun-space-2:8px;--bitfun-space-4:16px;--bitfun-layout-field-group-radius:16px}
      body{background:repeating-linear-gradient(90deg,red 0 12px,blue 12px 24px);margin:40px}
      main{width:600px} main>*, [data-bitfun-part="header"]{margin-bottom:40px} #gap{height:30px}
      ${css}
      /* Reproduce an authored light-only heading and toolbar token override. */
      [data-bitfun-part="sectionTitle"]{color:#172534!important;text-shadow:0 1px 2px white!important}
      [data-bitfun-part="actionBar"]{--bitfun-color-content-primary:#172534!important;--bitfun-color-action-quiet-content:#172534!important}
      [data-bitfun-part="actionBar"] button{color:var(--bitfun-color-action-quiet-content)}
      </style></head><body>${markup}<pre id="result"></pre><script>
      const targets=[...document.querySelectorAll('[data-bitfun-reading-surface], [data-bitfun-component="disclosure"] > [data-bitfun-part="header"]')];
      const measure=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return [r.x,r.y,r.width,r.height,s.borderRadius,s.padding,s.fontSize,s.lineHeight]};
      const before=targets.map(measure), paints=targets.map(e=>getComputedStyle(e,e.dataset.bitfunReadingSurface==='self'?null:'::before').backgroundColor);
      const title=getComputedStyle(document.querySelector('[data-bitfun-part="sectionTitle"]')), toolbar=getComputedStyle(document.querySelector('[data-bitfun-part="actionBar"] button'));
      const toolbarColor=toolbar.color;
      const headingPlates=[...document.querySelectorAll('.bitfun-config-page-header__inner,.bitfun-config-page-header__extra,.bitfun-config-page-section__extra,.bitfun-config-page-section > [data-bitfun-part="header"],.bitfun-todos__calendar-head,.bitfun-todos__calendar-actions')].map(e=>({background:getComputedStyle(e).backgroundColor,content:getComputedStyle(e,'::before').content}));
      const headingColor=title.color,shadow=title.textShadow;
      const card=document.querySelector('.skills-card'),restingMaterial=getComputedStyle(card).backgroundColor;
      card.querySelector('button').focus({preventScroll:true});const focusedMaterial=getComputedStyle(card).backgroundColor;card.querySelector('button').blur();
      const calendarPlanes=[...document.querySelectorAll('.bitfun-todos__calendar [data-bitfun-reading-surface]')].map(e=>e.className);
      const gap=getComputedStyle(document.getElementById('gap')).backgroundColor;
      document.documentElement.removeAttribute('data-bitfun-skin-id');
      document.getElementById('result').textContent=JSON.stringify({restingMaterial,focusedMaterial,toolbarColor,calendarPlanes,headingPlates,headingColor,shadow,before,after:targets.map(measure),paints,gap,disabled:targets.map(e=>getComputedStyle(e,'::before').content)});
      </script></body></html>`);
    const out = execFileSync(browser!, [...browserFixtureFlags(), '--headless=new','--disable-gpu','--no-first-run',`--user-data-dir=${resolve(scratch,'profile')}`,'--virtual-time-budget=200','--dump-dom',pathToFileURL(html).href], {encoding:'utf8',windowsHide:true,timeout:20000,stdio:'pipe'});
    const result=JSON.parse(out.match(/<pre id="result">(.*?)<\/pre>/s)![1]);
    expect(result.calendarPlanes).toEqual(['bitfun-todos__calendar-body']);
    expect(result.paints.length).toBeGreaterThan(0);
    result.paints.forEach((paint:string)=>expect(paint).toBe(mode==='light'?'rgba(255, 255, 255, 0.96)':'rgba(24, 24, 24, 0.96)'));
    expect(result.before).toEqual(result.after);
    expect(result.gap).toBe('rgba(0, 0, 0, 0)');
    expect(result.focusedMaterial).not.toBe(result.restingMaterial);expect(result.focusedMaterial).not.toBe('rgba(0, 0, 0, 0)');
    expect(result.toolbarColor).toBe('rgb(23, 37, 52)');
    expect(result.headingPlates.length).toBeGreaterThanOrEqual(4);
    result.headingPlates.forEach((plate:{background:string;content:string})=>{expect(plate.background).toBe('rgba(0, 0, 0, 0)');expect(['none','normal']).toContain(plate.content);});
    expect(result.headingColor).toBe('rgb(23, 37, 52)');expect(result.shadow).toContain('2px');
    expect(result.disabled.every((content:string)=>['none','normal'].includes(content))).toBe(true);
  } finally { await cleanupBrowserFixture(scratch); }
}, 30000);
