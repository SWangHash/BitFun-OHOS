// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { acpReviewErrorMessage } from './acpReviewErrors';
import { reviewPlatformErrorMessage } from '@/app/components/panels/review-platform/reviewErrors';

const root = fileURLToPath(new URL('../../../../..', import.meta.url));
const directories = [
  'src/crates/interfaces/acp/src',
  'src/crates/execution/agent-runtime/src/deep_review',
  'src/crates/assembly/core/src/agentic/deep_review',
  'src/crates/services/services-integrations/src/review_platform',
];
const files = [
  'src/apps/desktop/src/api/acp_client_api.rs',
  'src/crates/services/services-integrations/src/review_platform.rs',
  'src/crates/services/services-integrations/src/review_platform_http.rs',
  'src/crates/assembly/core/src/service/review_platform/mod.rs',
  'src/crates/assembly/core/src/agentic/tools/implementations/review_platform_tool.rs',
  'src/crates/assembly/core/src/agentic/tools/implementations/code_review_tool.rs',
  'src/crates/assembly/core/src/agentic/tools/implementations/task/deep_review.rs',
  'src/crates/assembly/core/src/agentic/tools/implementations/task/launch_review_agent.rs',
  'src/crates/services/services-core/src/session/metadata_store.rs',
  'src/crates/services/services-core/src/session/write_lock.rs',
  'src/crates/services/services-core/src/json_store.rs',
];
function rustFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? rustFiles(join(directory, entry.name))
    : entry.name.endsWith('.rs') && entry.name !== 'tests.rs' ? [join(directory, entry.name)] : []);
}

// Check literals at authored error constructors; log lines, protocol keys,
// prompts and external diagnostic classifiers are not presentation messages.
function errorLiterals(source: string): string[] {
  const literals: string[] = [];
  const token = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|r(#+)?"[\s\S]*?"\1|"(?:\\[\s\S]|[^"\\])*"/g;
  for (const match of source.matchAll(token)) {
    if (!match[0].startsWith('"')) continue;
    const before = source.slice(Math.max(0, match.index! - 200), match.index);
    if (!/(?:BitFunError::\w+|ReviewPlatformError::\w+|ReviewHttpError::\w+|Err)\s*\(\s*(?:format!\s*\(\s*)?$|#\[error\(\s*$|(?:\.error\s*=|error:)\s*(?:Some\()?(?:format!\()?\s*$|notes\.push\(\s*(?:format!\()?\s*$|(?:\w+ValidationError::(?:invalid|invalid_field|new|missing_field)|violation)\([^;{}]*$/.test(before)) continue;
    const message = match[0].slice(1, -1)
      .replace(/\\\r?\n\s*/g, '')
      .replace(/\\([nrt"\\])/g, (_, escaped: string) => ({ n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\' })[escaped]!);
    if (/\s/.test(message)) literals.push(message);
  }
  return literals;
}

describe('ACP and Review authored error coverage', () => {
  it('covers errors authored at the frontend launch and command boundaries', () => {
    const missing: string[] = [];
    for (const path of [
      'flow_chat/services/ReviewService.ts',
      'flow_chat/services/FlowChatManager.ts',
      'flow_chat/deep-review/launch/targetResolver.ts',
      'infrastructure/api/service-api/ACPClientAPI.ts',
      'infrastructure/api/service-api/ReviewPlatformAPI.ts',
      'app/components/panels/review-platform/ReviewPlatformPanel.tsx',
    ]) {
      const source = ts.createSourceFile(path, readFileSync(join(root, 'src/web-ui/src', path), 'utf8'), ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node) => {
        if ((ts.isNewExpression(node) || ts.isCallExpression(node))
          && ['Error', 'reviewTargetError'].includes(node.expression.getText(source))) {
          const argument = node.arguments?.[0];
          if (argument && ts.isStringLiteralLike(argument)
            && reviewPlatformErrorMessage(argument.text, key => `localized:${key}`) === argument.text) {
            missing.push(`${path}: ${argument.text}`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(missing).toEqual([]);
  });

  it('requires a locale entry for each error constructor in the owning modules', () => {
    const paths = [...directories.flatMap(directory => rustFiles(join(root, directory))), ...files.map(file => join(root, file))];
    const missing: string[] = [];
    for (const file of paths) {
      const source = readFileSync(file, 'utf8').split(/#\[cfg\(test\)\]\s*mod\s+tests\s*\{/)[0];
      for (const literal of errorLiterals(source)) {
        const example = literal.replace('{PROVISIONING_CANCELLED_CODE}', 'ACP_PROVISIONING_CANCELLED')
          .replace(/\{[^{}]*\}/g, 'value');
        if (acpReviewErrorMessage(example, key => `localized:${key}`) === example) {
          missing.push(`${relative(root, file)}: ${literal}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
