// Separate process name keeps the original menu app's keyboard-bridge stop
// command from terminating a controller-mode session.
if (!process.argv.includes('--controller')) process.argv.push('--controller');
require('./bridge');
