const path = require('node:path');
const shared = require('../../miniapps/generate.cjs');
function generate() { shared.generate(path.resolve(__dirname, '../entry/src/main/resources/rawfile/miniapps'), false); }
module.exports = { generate };
if (require.main === module) generate();
