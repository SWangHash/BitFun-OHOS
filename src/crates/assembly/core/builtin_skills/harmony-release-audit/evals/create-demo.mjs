import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// A source-only fixture: intentionally contains all three preflight risks.
// It is not a signed application or a full SDK/build template.
export async function createDemo(target) {
  const root = path.resolve(target);
  await mkdir(root); // Refuse existing directories, including symlinks.
  const files = {
    'build-profile.json5': { modules: [{ name: 'entry', srcPath: './entry' }] },
    'AppScope/app.json5': { app: { label: '$string:app_name', bundleName: 'com.example.audit' } },
    'AppScope/resources/base/element/string.json': { string: [{ name: 'app_name', value: '清单 Beta' }] },
    'AppScope/resources/en_US/element/string.json': { string: [{ name: 'app_name', value: 'Checklist Beta' }] },
    'entry/src/main/module.json5': { module: { name: 'entry', type: 'entry', deviceTypes: ['phone'], pages: '$profile:main_pages', abilities: [{ name: 'EntryAbility', srcEntry: './ets/entryability/EntryAbility.ets', label: '$string:app_name' }] } },
    'entry/src/main/resources/base/profile/main_pages.json': { src: ['pages/Index'] },
    'entry/src/main/ets/entryability/EntryAbility.ets': "import { UIAbility } from '@kit.AbilityKit';\nimport { window } from '@kit.ArkUI';\nexport default class EntryAbility extends UIAbility {\n  onWindowStageCreate(stage: window.WindowStage): void { stage.loadContent('pages/Index'); }\n}\n",
    'entry/src/main/ets/pages/Index.ets': "@Entry\n@Component\nstruct Index {\n  @State privacyAccepted: boolean = true;\n  @State submitted: boolean = false;\n  build() {\n    Column() {\n      Text('请阅读下面的说明').fontColor('#999999').backgroundColor(Color.White)\n      Row() {\n        Checkbox({ name: 'privacy' }).select(this.privacyAccepted)\n          .onChange((value: boolean) => { this.privacyAccepted = value; })\n        Text('我已阅读并同意隐私协议').fontColor('#333333').backgroundColor(Color.White)\n      }\n      Button('提交').onClick(() => {\n        if (!this.privacyAccepted) { return; }\n        this.submitted = true;\n      })\n      Text(this.submitted ? '已提交' : '未提交').fontColor('#333333').backgroundColor(Color.White)\n    }.backgroundColor(Color.White)\n  }\n}\n",
  };
  for (const [relative, value] of Object.entries(files)) {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  }
  return root;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) {
    console.error('Usage: node create-demo.mjs <new-directory-with-existing-parent>');
    process.exitCode = 1;
  } else {
    try { console.log(await createDemo(process.argv[2])); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
