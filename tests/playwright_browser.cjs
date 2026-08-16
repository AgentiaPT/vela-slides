const fs = require('fs');
const path = require('path');

function findPinnedChromium() {
  const configured = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  if (configured && fs.existsSync(configured)) return configured;

  const base = '/opt/pw-browsers';
  try {
    const dirs = fs.readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
    for (const dir of dirs) {
      const executable = path.join(base, dir, 'chrome-linux', 'chrome');
      if (fs.existsSync(executable)) return executable;
    }
  } catch {}
  return null;
}

async function launchChromium(chromium) {
  const args = ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'];
  try {
    return await chromium.launch({ headless: true, args });
  } catch (error) {
    const executablePath = findPinnedChromium();
    if (executablePath) {
      return chromium.launch({ headless: true, args, executablePath });
    }
    throw error;
  }
}

module.exports = { launchChromium };
