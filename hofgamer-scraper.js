import { chromium } from 'playwright';

// ==========================================
// 🤖 PLAYWRIGHT HELPER (Cloudflare bypass)
// ==========================================

let browserInstance = null;

async function getBrowser() {
    if (!browserInstance || !browserInstance.isConnected()) {
        browserInstance = await chromium.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled'
            ]
        });
    }
    return browserInstance;
}

export async function closeBrowser() {
    if (browserInstance) {
        try { await browserInstance.close(); } catch {}
        browserInstance = null;
    }
}

/**
 * Fetches a URL using a real Chromium browser to bypass Cloudflare JS challenges.
 * @param {string} url - The URL to fetch
 * @param {object} options
 * @param {number} [options.timeout=45000] - Navigation timeout in ms
 * @param {number} [options.waitAfterLoad=5000] - Extra wait after page load in ms
 * @returns {Promise<string>} The fully rendered HTML content
 */
export async function fetchWithBrowser(url, { timeout = 45000, waitAfterLoad = 5000 } = {}) {
    const browser = await getBrowser();
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
        locale: 'en-US',
        timezoneId: 'America/New_York'
    });
    
    // Block unnecessary resources to speed up loading
    const page = await context.newPage();
    await page.route('**/*.{png,jpg,jpeg,gif,svg,ico,woff,woff2,ttf,eot}', route => route.abort());
    
    try {
        await page.goto(url, {
            waitUntil: 'networkidle',
            timeout
        });
        
        // Extra wait for Cloudflare challenge to fully resolve
        await page.waitForTimeout(waitAfterLoad);
        
        // Get the fully rendered HTML
        const html = await page.content();
        return html;
    } finally {
        await page.close();
        await context.close();
    }
}
