import { chromium } from 'playwright';
import fs from 'fs';

const BASE_URL = 'https://super-league.pages.dev';
const routes = ['', 'fantasy', 'wc', 'matches', 'standings', 'clubs', 'statistics', 'legends', 'rules'];

(async () => {
    console.log('🚀 Starting screenshot automation...');
    if (!fs.existsSync('./screenshots')) fs.mkdirSync('./screenshots');

    const browser = await chromium.launch();
    const context = await browser.newContext({
        viewport: { width: 1200, height: 630 },
        deviceScaleFactor: 2
    });

    const page = await context.newPage();

    for (const route of routes) {
        const url = route ? `${BASE_URL}/${route}` : BASE_URL;
        const filename = route || 'home';

        console.log(`📸 Capturing ${url}`);

        await page.goto(url, { waitUntil: 'networkidle' });
        await page.waitForTimeout(2000); // Wait for animations
        await page.screenshot({ path: `./screenshots/${filename}.png` });
    }

    await browser.close();
    console.log('✅ Screenshots captured!');
})();

