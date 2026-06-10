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

<<<<<<< HEAD
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
=======
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
>>>>>>> bdad86b (Add delay)
            await page.screenshot({ path: `./screenshots/${filename}.png` });
            console.log(`   ✅ Saved ${filename}.png`);

        } catch (error) {
<<<<<<< HEAD
            console.error(`   ❌ Failed to capture ${filename}. Could not find data-testid="${pageConfig.testId}" within 15 seconds.`);
            hasErrors = true;
=======
            console.error(`   ❌ Failed to capture ${filename}. Could not find text: "${pageConfig.text}"`);
            // In CI, you might want to process.exit(1) here to fail the workflow
>>>>>>> bdad86b (Add delay)
        }
    }

    await browser.close();
<<<<<<< HEAD
    console.log('\n🏁 All done!');

    // If any screenshot failed, exit with an error code so the GitHub Action turns red
    if (hasErrors) {
        process.exit(1);
    }
=======
    console.log('🏁 All done!');
>>>>>>> bdad86b (Add delay)
})();
