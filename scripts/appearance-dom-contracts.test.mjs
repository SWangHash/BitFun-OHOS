import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { collectForwardedTabProps, findDomAttribute } from './appearance-dom-contracts.mjs';

function collect(source) {
  return [...collectForwardedTabProps(ts.createSourceFile('fixture.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX))];
}

test('TabGroup literal and mapped items expose the real native tab attributes', () => {
  for (const items of [
    `[{value: 'models', tabProps: {'data-openbitfun-product-part': 'tab'}}]`,
    `tabs.map(tab => ({value: tab, tabProps: {'data-openbitfun-product-part': 'tab'}}))`,
  ]) {
    const nodes = collect(`import { TabGroup as Tabs } from '@openbitfun/ui'; <Tabs items={${items}} />;`);
    assert.equal(nodes.length, 1);
    assert.equal(findDomAttribute(nodes[0], 'data-openbitfun-product-part').initializer.text, 'tab');
    assert.equal(findDomAttribute(nodes[0], 'missing'), undefined);
  }
});

test('unrelated objects, non-forwarding props and unknown spreads cannot establish DOM contracts', () => {
  for (const source of [
    `const unused = {tabProps: {'data-openbitfun-product-part': 'tab'}};`,
    `import { TabGroup } from './fake'; <TabGroup items={[{tabProps: {part: 'tab'}}]} />;`,
    `import { Button } from '@openbitfun/ui'; <Button items={[{tabProps: {part: 'tab'}}]} />;`,
    `import { TabGroup } from '@openbitfun/ui'; <TabGroup other={[{tabProps: {part: 'tab'}}]} />;`,
    `import { TabGroup } from '@openbitfun/ui'; <TabGroup items={[{tabProps: {part: 'tab'}, ...unknown}]} />;`,
    `import { TabGroup } from '@openbitfun/ui'; <TabGroup items={[{tabProps: {part: 'tab', ...unknown}}]} />;`,
    `import { TabGroup } from '@openbitfun/ui'; <TabGroup items={[{label: {tabProps: {part: 'tab'}}}]} />;`,
  ]) assert.equal(collect(source).length, 0, source);
});

test('component-owned part and value markers cannot be supplied as forwarding evidence', () => {
  const [node] = collect(`import { TabGroup } from '@openbitfun/ui';
    <TabGroup items={[{value: 'models', tabProps: {
      'data-openbitfun-part': 'invented', 'data-openbitfun-value': 'invented',
      'data-openbitfun-product-part': 'tab'
    }}]} />;`);
  assert.equal(findDomAttribute(node, 'data-openbitfun-part'), undefined);
  assert.equal(findDomAttribute(node, 'data-openbitfun-value'), undefined);
  assert.equal(findDomAttribute(node, 'data-openbitfun-product-part').initializer.text, 'tab');
});
