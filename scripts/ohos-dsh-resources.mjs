#!/usr/bin/env node
import path from 'node:path';
import { parseArgs } from 'node:util';
import { prepareDshProfile } from './prepare-dsh-profile.mjs';
import { verifyHapProfile } from './dsh-profile-artifact.mjs';

const { values } = parseArgs({ options: {
  project: { type: 'string' }, 'verify-hap': { type: 'string' },
} });
if (!values.project) throw new Error('--project must name the actual OHOS assembly project');
const project = path.resolve(values.project);
const destinationDir = path.join(project, 'entry/src/main/resources/resfile/dsh-profile');
if (values['verify-hap']) {
  const result = await verifyHapProfile(path.resolve(values['verify-hap']), destinationDir);
  console.log(`[dsh-profile] verified ${result.files} HAP resources (${result.content})`);
} else {
  // This script lives in the source checkout even when the project is staged elsewhere.
  prepareDshProfile({ destinationDir, required: true });
  console.log(`[dsh-profile] prepared resources for ${project}`);
}
