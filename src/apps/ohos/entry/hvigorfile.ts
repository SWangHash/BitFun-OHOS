import { hapTasks, OhosPluginId } from '@ohos/hvigor-ohos-plugin';
import { hvigor } from '@ohos/hvigor';
const { dshProfilePlugin } = require('../hvigor/dsh-profile-plugin.cjs');

export default {
  system: hapTasks, /* Built-in plugin of Hvigor. It cannot be modified. */
  plugins: [dshProfilePlugin(hvigor, OhosPluginId.OHOS_HAP_PLUGIN)]       /* Custom plugin to extend the functionality of Hvigor. */
}