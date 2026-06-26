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
 * Waits for the Cloudflare challenge to fully resolve and the real content to load.
 */
export async function fetchWithBrowser(url, { timeout = 90000 } = {}) {
    const browser = await getBrowser();
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
        locale: 'en-US',
        timezoneId: 'America/New_York'
    });

    const page = await context.newPage();

    try {
        // NOT using 'networkidle' — Cloudflare challenge keeps connections open,
        // which would cause 'networkidle' to timeout indefinitely.
        // Using 'domcontentloaded' loads the challenge page HTML, then
        // we wait for the challenge to resolve via waitForFunction below.
        await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout
        });

        // Wait for Cloudflare challenge to resolve by detecting real content
        // The challenge page shows "Just a moment..." or "Checking your browser"
        // We poll until those texts disappear, meaning the real page loaded
            try {
                await page.waitForFunction(() => {
                    const text = document.body?.innerText || '';
                    const noCloudflare = !text.includes('Just a moment') &&
                                         !text.includes('Checking your browser');
                    const hasContent = text.length > 200 || document.querySelector('table');
                    return noCloudflare && hasContent;
                }, { timeout: 30000, polling: 500 });
            } catch {
                // Challenge may have already resolved or page loaded without challenge
            }

        // Extra stabilization time for JavaScript-rendered content
        await page.waitForTimeout(5000);

        // Get the fully rendered HTML
        const html = await page.content();
        return html;
    } finally {
        await page.close();
        await context.close();
    }
}
