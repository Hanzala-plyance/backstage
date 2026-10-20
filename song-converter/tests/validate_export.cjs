// Independent Clone Hero-compatible parser. Install: npm install --prefix .cache/chart-validator scan-chart
const {scanChartFolder} = require('../.cache/chart-validator/node_modules/scan-chart');
const fs = require('node:fs');
const path = require('node:path');
const roots = process.argv.slice(2);
for (const dir of roots) {
  const files = fs.readdirSync(dir).filter(name => fs.statSync(path.join(dir,name)).isFile()).map(fileName => ({fileName,data:new Uint8Array(fs.readFileSync(path.join(dir,fileName)))}));
  const scan = scanChartFolder(files, {includeMd5:false});
  if (!scan.playable) throw Error('Unplayable export: '+dir);
  const counts = scan.notesData.noteCounts;
  for (const instrument of ['guitar','bass','rhythm','drums']) for (const difficulty of ['easy','medium','hard','expert']) {
    const found=counts.find(t=>t.instrument===instrument && t.difficulty===difficulty);
    if (!found || found.count<1) throw Error(`Missing ${instrument} ${difficulty} in ${dir}`);
  }
  console.log(JSON.stringify({folder:dir,playable:scan.playable,drumType:scan.notesData.drumType,hasLyrics:scan.notesData.hasLyrics,tracks:counts,issues:scan.notesData.chartIssues},null,2));
}
