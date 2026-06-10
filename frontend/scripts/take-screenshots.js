import { chromium } from 'playwright';
import fs from 'fs';

const BASE_URL = 'https://super-league.pages.dev';

// Map each route to a word or heading that uniquely identifies that page.
// Even if it's just a standard <h1> or a table header, Playwright will find it.
const pages = [
    { route: '', text: 'Super League' }, // Replace with a word visible on your home page
    { route: 'fantasy', text: 'Fantasy' },
    { route: 'wc', text: 'World Cup' },
    { route: 'matches', text: 'Matches' },
    { route: 'standings', text: 'Standings' },
    { route: 'clubs', text: 'Clubs' },
    { route: 'statistics', text: 'Statistics' },
    { route: 'legends', text: 'Legends' },
    { route: 'rules', text: 'Rules' }
];

(async () => {
    console.log('🚀 Starting CI-safe screenshot automation...');
    if (!fs.existsSync('./screenshots')) fs.mkdirSync('./screenshots');

    const browser = await chromium.launch();
    const context = await browser.newContext({
        viewport: { width: 1200, height: 630 },
        deviceScaleFactor: 2
    });

    const page = await context.newPage();

    for (const pageConfig of pages) {
        const url = pageConfig.route ? `${BASE_URL}/${pageConfig.route}` : BASE_URL;
        const filename = pageConfig.route || 'home';

        console.log(`📸 Capturing ${url}...`);

        // 1. Navigate, but don't wait for network idle yet
        await page.goto(url, { waitUntil: 'domcontentloaded' });

        try {
            // 2. THE CI FIX: Wait for the specific text to appear on the screen.
            // This proves React Router has finished calculating and painting the component.
            console.log(`   ⏳ Waiting for text: "${pageConfig.text}"`);
            await page.getByText(pageConfig.text, { exact: false })
                .first()
                .waitFor({ state: 'visible', timeout: 15000 }); // Fails the build if it doesn't load in 15s

            // 3. Optional but recommended: Now wait for any delayed images or API calls to finish
            await page.waitForLoadState('networkidle');

            // 4. Capture the screenshot
            await page.screenshot({ path: `./screenshots/${filename}.png` });
            console.log(`   ✅ Saved ${filename}.png`);

        } catch (error) {
            console.error(`   ❌ Failed to capture ${filename}. Could not find text: "${pageConfig.text}"`);
            // In CI, you might want to process.exit(1) here to fail the workflow
        }
    }

    await browser.close();
    console.log('🏁 All done!');
})();
