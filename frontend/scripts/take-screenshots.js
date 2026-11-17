import { chromium } from 'playwright';
import fs from 'fs';

const BASE_URL = 'https://super-league.pages.dev';
const routes = ['', 'fantasy', 'wc', 'matches', 'standings', 'statistics', 'legends', 'rules'];

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
            // A normal page load, not a wait for idle network: the home page keeps streaming a video, so the network never goes idle.
            await page.goto(url, { waitUntil: 'load', timeout: 30000 });
            await page.waitForTimeout(3000); // Allow animations to settle

            // The home page is a rotating video carousel, so a plain screenshot is a random slide and video frame, and
            // this image is the default share preview for the whole site. Show the Super League slide and pause it.
            if (route === '') {
                try {
                    await page.getByRole('button', { name: 'Show Super League' }).click({ timeout: 5000 });
                    await page.getByRole('button', { name: 'Pause carousel video' }).click({ timeout: 5000 });
                    await page.waitForTimeout(1500);
                } catch {
                    console.warn('  ⚠️ Carousel controls not found; capturing the home page as it is.');
                }
            }

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
