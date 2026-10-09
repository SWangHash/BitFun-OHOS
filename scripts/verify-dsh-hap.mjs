#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { verifyHapProfile } from './dsh-profile-artifact.mjs';
const { values } = parseArgs({ options: { hap: { type: 'string' }, source: { type: 'string' } } });
if (!values.hap || !values.source) throw new Error('--hap and --source are required');
const result = await verifyHapProfile(values.hap, values.source);
console.log(`[dsh-profile] verified ${result.files} HAP resources (${result.content})`);
