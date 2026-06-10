import { chromium } from 'playwright';
import fs from 'fs';

const BASE_URL = 'https://super-league.pages.dev';

// Map each route to the exact data-testid you added to the React components
const pages = [
    { route: '', testId: 'page-home' },
    { route: 'fantasy', testId: 'page-fantasy' },
    { route: 'wc', testId: 'page-wc' },
    { route: 'matches', testId: 'page-matches' },
    { route: 'standings', testId: 'page-standings' },
    { route: 'clubs', testId: 'page-clubs' },
    { route: 'statistics', testId: 'page-statistics' },
    { route: 'legends', testId: 'page-legends' },
    { route: 'rules', testId: 'page-rules' }
];

(async () => {
    console.log('🚀 Starting CI-safe screenshot automation...');
    if (!fs.existsSync('./screenshots')) fs.mkdirSync('./screenshots');

    const browser = await chromium.launch();
    const context = await browser.newContext({
        viewport: { width: 1200, height: 630 },
        deviceScaleFactor: 2,
        // Optional: Force a dark color scheme if your site supports it
        colorScheme: 'dark'
    });

    const page = await context.newPage();
    let hasErrors = false;

    for (const pageConfig of pages) {
        const url = pageConfig.route ? `${BASE_URL}/${pageConfig.route}` : BASE_URL;
        const filename = pageConfig.route || 'home';

        console.log(`\n📸 Capturing ${url}...`);

        try {
            await page.goto(url, { waitUntil: 'domcontentloaded' });

            console.log(`   ⏳ Waiting for test ID: "${pageConfig.testId}"...`);

            // 1. Wait strictly for the component to mount using the test ID
            await page.getByTestId(pageConfig.testId).waitFor({ state: 'visible', timeout: 15000 });

            // 2. Give the network a brief moment to download any images inside that component
            await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {
                console.log(`   ⚠️ Network didn't fully idle, but proceeding anyway...`);
            });

            // 3. Take the screenshot
            await page.screenshot({ path: `./screenshots/${filename}.png` });
            console.log(`   ✅ Saved ${filename}.png`);

        } catch (error) {
            console.error(`   ❌ Failed to capture ${filename}. Could not find data-testid="${pageConfig.testId}" within 15 seconds.`);
            hasErrors = true;
        }
    }

    await browser.close();
    console.log('\n🏁 All done!');

    // If any screenshot failed, exit with an error code so the GitHub Action turns red
    if (hasErrors) {
        process.exit(1);
    }
})();
