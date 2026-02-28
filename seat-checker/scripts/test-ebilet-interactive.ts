import { chromium } from 'playwright';

(async () => {
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    let shopUrl = null;

    page.on('response', async (response) => {
        const url = response.url();
        if (url.includes('sklep.ebilet.pl')) {
            console.log('Detected sklep link in response:', url);
        }
        if (url.includes('/api/event/')) {
            console.log('Detected API event call:', url);
            try {
                const data = await response.json();
                console.log('  Data:', JSON.stringify(data).substring(0, 100));
            } catch (e) { }
        }
    });

    try {
        await page.goto('https://www.ebilet.pl/muzyka/pop/anita-lipnicka?city=Pszczyna', { timeout: 30000 });

        // Wait for cookie banner and dismiss
        const cookieAcceptButton = page.locator('#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll, button:has-text("Akceptuję"), button:has-text("Zgadzam się")');
        if (await cookieAcceptButton.first().isVisible({ timeout: 5000 }).catch(() => false)) {
            await cookieAcceptButton.first().click();
            console.log("Dismissed cookie");
        }

        await page.waitForTimeout(2000);

        const allBuyButtons = page.locator('button[ebtype="primary"], a.eb-btn-primary, button.eb-btn-primary, [data-testid*="buy"], [data-testid*="buyTicket"]');
        if (await allBuyButtons.count() > 0) {
            console.log("Clicking buy button");
            await allBuyButtons.first().click();
        } else {
            console.log("No buy button found");
        }

        console.log("Waiting 10 seconds to observe network/navigation...");
        await page.waitForTimeout(10000);

        console.log("Final URL:", page.url());

    } finally {
        await browser.close();
    }
})();
