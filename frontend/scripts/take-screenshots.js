import { chromium } from 'playwright';
import fs from 'fs';

const BASE_URL = 'https://super-league.pages.dev';
const routes = ['', 'fantasy', 'wc', 'matches', 'standings', 'clubs', 'statistics', 'legends', 'rules'];

(async () => {
    console.log('🚀 Starting native screenshot automation (1200x630)...');
    if (!fs.existsSync('./screenshots')) fs.mkdirSync('./screenshots');

    const browser = await chromium.launch();
    
    // Exact 1200x630 frame, scale 1 = direct 1200x630 pixel output
    const context = await browser.newContext({
        viewport: { width: 1200, height: 630 },
        deviceScaleFactor: 1
    });

    const page = await context.newPage();

    for (const route of routes) {
        const url = route ? `${BASE_URL}/${route}` : BASE_URL;
        const filename = route || 'home';
        const outputPath = `./screenshots/${filename}.png`;

        console.log(`📸 Capturing ${url}`);

        try {
            await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
            await page.waitForTimeout(2000); // Allow animations to settle

            // Native Playwright PNG output — no sharp dependency needed
            await page.screenshot({ path: outputPath });

            const stats = fs.statSync(outputPath);
            console.log(`  └─ Saved ${filename}.png (${Math.round(stats.size / 1024)} KB) [1200x630]`);

        } catch (error) {
            console.error(`❌ Failed to capture ${url}:`, error.message);
        }
    }

    await browser.close();
    console.log('✅ Direct 1200x630 screenshots complete!');
})();
