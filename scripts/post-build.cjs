#!/usr/bin/env node
/**
 * Post-build script for copilot-router
 * - Ensures CLI has shebang line
 * - Sets executable permissions (cross-platform)
 */

const fs = require('fs');
const path = require('path');

const CLI_PATH = path.join(__dirname, '..', 'dist', 'cli.js');

try {
    // Read the CLI file
    let content = fs.readFileSync(CLI_PATH, 'utf8');

    // Add shebang if missing
    if (!content.startsWith('#!')) {
        content = '#!/usr/bin/env node\n' + content;
        fs.writeFileSync(CLI_PATH, content);
        console.log('✓ Added shebang to cli.js');
    } else {
        console.log('✓ Shebang already present in cli.js');
    }

    // Set executable permission (Unix-like systems only)
    if (process.platform !== 'win32') {
        fs.chmodSync(CLI_PATH, 0o755);
        console.log('✓ Set executable permission on cli.js');
    }

    console.log('✓ Post-build complete');
} catch (error) {
    console.error('✗ Post-build failed:', error.message);
    process.exit(1);
}
