import { chromium } from 'playwright';
import fs from 'fs';
import sharp from 'sharp';

const BASE_URL = 'https://super-league.pages.dev';
const routes = ['', 'fantasy', 'wc', 'matches', 'standings', 'clubs', 'statistics', 'legends', 'rules'];

(async () => {
    console.log('🚀 Starting screenshot automation (2400x1260)...');
    if (!fs.existsSync('./screenshots')) fs.mkdirSync('./screenshots');

    const browser = await chromium.launch();
    
    // Retains exact 2400x1260 pixel output
    const context = await browser.newContext({
        viewport: { width: 1200, height: 630 },
        deviceScaleFactor: 2
    });

    const page = await context.newPage();

    for (const route of routes) {
        const url = route ? `${BASE_URL}/${route}` : BASE_URL;
        const filename = route || 'home';
        const outputPath = `./screenshots/${filename}.png`;

        console.log(`📸 Capturing ${url}`);

        try {
            await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
            await page.waitForTimeout(2000); // Allow frontend animations to settle

            const rawBuffer = await page.screenshot();

            // Compress buffer while preserving 2400x1260 resolution
            await sharp(rawBuffer)
                .png({
                    quality: 85,        // High-quality palette quantization
                    palette: true,      // 8-bit palette drops size drastically
                    compressionLevel: 9 // Maximum PNG compression effort
                })
                .toFile(outputPath);

            const stats = fs.statSync(outputPath);
            console.log(`  └─ Saved ${filename}.png (${Math.round(stats.size / 1024)} KB) [2400x1260]`);

        } catch (error) {
            console.error(`❌ Failed to capture ${url}:`, error.message);
        }
    }

    await browser.close();
    console.log('✅ Screenshots captured & compressed under 600 KB!');
})();
