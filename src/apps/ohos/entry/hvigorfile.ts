import { hapTasks, OhosPluginId } from '@ohos/hvigor-ohos-plugin';
import { hvigor } from '@ohos/hvigor';
const { dshProfilePlugin } = require('../hvigor/dsh-profile-plugin.cjs');
const { remoteWebPlugin } = require('../hvigor/remote-web-plugin.cjs');

export default {
  system: hapTasks, /* Built-in plugin of Hvigor. It cannot be modified. */
  plugins: [
    dshProfilePlugin(hvigor, OhosPluginId.OHOS_HAP_PLUGIN),
    remoteWebPlugin(hvigor, OhosPluginId.OHOS_HAP_PLUGIN),
  ]
}
