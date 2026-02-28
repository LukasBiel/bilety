
import { type BrowserContext } from 'playwright';
import { getGlobalBrowser } from '@/lib/globalBrowser';
import type { SourceType, SourceStats, SectorStats, CombinedEventStats, JoinedEvent } from '@/lib/types';
import { loadHistory, saveHistory, type SeatHistory } from '@/lib/history';
import { loadStatsHistory, saveStatsHistory, type StatsHistoryEntry } from '@/lib/statsHistory';
import { touchCachedUrl } from '@/lib/urlCache';
import { saveFullStats } from '@/lib/fullStatsCache';
import { sendDiscordSaleNotification } from '@/lib/discord';

import {
    parseBiletynaSeats,
    parseBiletynaSectorSeats,
    combineBiletynaSectors,
    type BiletynaSectorResult
} from '@/lib/seat-scrapers/biletyna-seats';

import {
    processEbiletAllSectors,
    type EbiletSeatsResponse,
    type EbiletFreeSeatsResponse
} from '@/lib/seat-scrapers/ebilet-seats';

import {
    processKupbilecikData,
    type KupBilecikObiektData
} from '@/lib/seat-scrapers/kupbilecik-seats';

import { normalizeSeatKey, matchSectorByStructure } from '@/lib/seat-scrapers/utils';

interface BiletynaRawData {
    sectorResults: Array<{ sectorUrl: string; data: BiletynaSectorResult }>;
    finalUrl: string;
}

interface EbiletRawData {
    seatsBySid: Map<string, EbiletSeatsResponse>;
    freeSeatsData: EbiletFreeSeatsResponse & { sfc?: Record<string, number> };
    sectorCapacities?: Record<string, { id: string, n: string, c: number }>;
    currentUrl: string;
}

interface KupbilecikRawData {
    obiektData: KupBilecikObiektData;
    finalUrl: string;
}

export async function scrapeEventStats(event: JoinedEvent, id: string): Promise<CombinedEventStats> {
    const results: Partial<Record<SourceType, SourceStats>> = {};
    const browser = await getGlobalBrowser();

    /* Safe Context Management for Global Browser */
    let context: BrowserContext | null = null;

    try {
        context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        });

        // OPTIMIZATION: Block unnecessary resources
        await context.route('**/*.{png,jpg,jpeg,gif,webp,svg,css,woff,woff2,ico,otf,ttf}', route => route.abort());

        // --- SMART CACHING STRATEGY ---
        // Import (dynamic import to avoid build issues if file doesn't exist yet)
        const { getCachedUrl, setCachedUrl, clearCachedUrl } = await import('@/lib/urlCache');

        // Check cache for eBilet
        let cachedEbiletUrl: string | null = null;
        if (event.sources.ebilet) {
            cachedEbiletUrl = getCachedUrl(event.globalEventId, 'ebilet');
            if (cachedEbiletUrl) console.log(`SmartCache: Found cached URL for eBilet: ${cachedEbiletUrl}`);
        }

        // Check cache for Biletyna
        let cachedBiletynaUrl: string | null = null;
        if (event.sources.biletyna) {
            cachedBiletynaUrl = getCachedUrl(event.globalEventId, 'biletyna');
            if (cachedBiletynaUrl) console.log(`SmartCache: Found cached URL for Biletyna: ${cachedBiletynaUrl}`);
        }

        // Check cache for KupBilecik
        let cachedKupbilecikUrl: string | null = null;
        if (event.sources.kupbilecik) {
            cachedKupbilecikUrl = getCachedUrl(event.globalEventId, 'kupbilecik');
            if (cachedKupbilecikUrl) console.log(`SmartCache: Found cached URL for KupBilecik: ${cachedKupbilecikUrl}`);
        }

        const sourcePromises: Promise<void>[] = [];
        let ebiletRawData: EbiletRawData | null = null;
        let biletynaRawData: BiletynaRawData | null = null;
        let kupbilecikRawData: KupbilecikRawData | null = null;


        // Biletyna
        if (event.sources.biletyna) {
            sourcePromises.push((async () => {
                const page = await context!.newPage();

                // Block heavy media resources for speed
                try {
                    await page.route('**/*.{png,jpg,jpeg,gif,webp,svg,mp4,webm}', route => route.abort());
                } catch { }

                try {
                    let cacheHit = false;

                    // 1. Try Cached URL First
                    if (cachedBiletynaUrl) {
                        console.log(`Biletyna: SmartCache hit, trying ${cachedBiletynaUrl}...`);
                        try {
                            await page.goto(cachedBiletynaUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

                            // Validate if we are really on a sector page or seat map
                            try {
                                // Check for seats container OR sector selector
                                await page.waitForSelector('.place, [data-place_status], .sectors', { timeout: 5000 });

                                // If successful, capture data
                                const html = await page.content();
                                // Try single sector parse first
                                const stats = parseBiletynaSeats(html);
                                if (stats) {
                                    // Single sector / direct map
                                    stats.finalUrl = page.url();
                                    results.biletyna = stats;
                                    console.log('Biletyna: SmartCache success (Single/Map)!');
                                    cacheHit = true;
                                } else {
                                    // Maybe multi-sector list?
                                    const sectorUrls = await page.$$eval('a[href*="/event/sector/"]', els => els.map(e => (e as HTMLAnchorElement).href));
                                    if (sectorUrls.length > 0) {
                                        // Yes, it's a list. We need to go back to standard logic to iterate them? 
                                        // Or we trust the cache URL was a specific sector?
                                        // Actually cache stores the *final* URL. If final URL was a sector, we are good.
                                        // If final URL was the list, we are back to square one.
                                        console.log('Biletyna: SmartCache led to sector list, proceeding with standard logic');
                                    } else {
                                        console.log('Biletyna: SmartCache validation failed (no stats), clearing cache');
                                        clearCachedUrl(event.globalEventId, 'biletyna');
                                    }
                                }
                            } catch {
                                console.log('Biletyna: SmartCache validation failed (selector not found)');
                                clearCachedUrl(event.globalEventId, 'biletyna');
                            }
                        } catch (e) {
                            console.log('Biletyna: SmartCache navigation failed:', e);
                        }
                    }

                    if (cacheHit) return;

                    // 2. Standard Logic (Fallback)
                    console.log('Biletyna: Starting standard navigation...');
                    await page.goto(event.sources.biletyna!.eventCardUrl, {
                        waitUntil: 'domcontentloaded',
                        timeout: 30000,
                    });

                    // Dismiss cookie dialog first
                    try {
                        await page.evaluate(() => {
                            const dialog = document.getElementById('CybotCookiebotDialog');
                            if (dialog) dialog.remove();
                            const underlay = document.getElementById('CybotCookiebotDialogBodyUnderlay');
                            if (underlay) underlay.remove();
                        });
                    } catch {
                        // Ignore
                    }

                    // Find all WYBIERZ sector links
                    const sectorUrls = await page.evaluate(() => {
                        const links: string[] = [];
                        const anchors = document.querySelectorAll('a');
                        anchors.forEach(a => {
                            const text = a.textContent?.trim().toUpperCase();
                            if (text === 'WYBIERZ' && a.href?.includes('/event/sector/')) {
                                links.push(a.href);
                            }
                        });
                        return links;
                    });

                    // Multi-sector: navigate to each sector URL and collect data
                    if (sectorUrls.length > 1) {
                        const sectorResults: Array<{ sectorUrl: string; data: BiletynaSectorResult }> = [];

                        for (const sectorUrl of sectorUrls) {
                            try {
                                await page.goto(sectorUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

                                // Wait dynamically for seat map
                                try {
                                    await page.waitForSelector('.place, [data-place_status]', { state: 'attached', timeout: 8000 });
                                } catch {
                                    // No seats on this sector
                                    continue;
                                }

                                const html = await page.content();
                                const sectorData = parseBiletynaSectorSeats(html);
                                if (sectorData && sectorData.freeSeats.length + sectorData.takenSeats.length > 0) {
                                    sectorResults.push({ sectorUrl, data: sectorData });
                                }
                            } catch {
                                // Skip failed sector
                            }
                        }

                        // STORE RAW DATA FOR POST-PROCESSING
                        if (sectorResults.length > 0) {
                            biletynaRawData = {
                                sectorResults,
                                finalUrl: event.sources.biletyna!.eventCardUrl
                            };
                        }
                    } else {
                        // Single sector or no WYBIERZ buttons - use old logic
                        // Try to click "Kup bilet" button
                        try {
                            const buyButton = await page.$(event.sources.biletyna!.buyButtonSelector);
                            if (buyButton) {
                                await buyButton.click();
                            }
                        } catch {
                            // Continue anyway
                        }

                        // If there's exactly one WYBIERZ, navigate to it
                        if (sectorUrls.length === 1) {
                            try {
                                await page.goto(sectorUrls[0], { waitUntil: 'domcontentloaded', timeout: 30000 });
                                await page.waitForTimeout(2000);
                            } catch {
                                // Ignore
                            }
                        }

                        // Wait for seat map
                        try {
                            await page.waitForSelector('.place, [data-place_status]', { timeout: 10000 });
                        } catch {
                            // Continue anyway
                        }
                        const finalUrl = page.url();
                        const html = await page.content();
                        const stats = parseBiletynaSeats(html);
                        if (stats) {
                            stats.finalUrl = finalUrl;
                            results.biletyna = stats;

                            // Save to cache for next time
                            if (stats.finalUrl.includes('biletyna.pl')) {
                                console.log(`Biletyna: Saving SmartCache URL: ${finalUrl}`);
                                setCachedUrl(event.globalEventId, 'biletyna', finalUrl);
                            }
                        }
                    }
                } finally {
                    await page.close();
                }
            })());
        }

        // eBilet
        if (event.sources.ebilet) {
            sourcePromises.push((async () => {
                const page = await context!.newPage();

                // Capture seats by sector ID (sid) - each seats.json is for one sector
                const seatsBySid = new Map<string, EbiletSeatsResponse>();
                // Capture ALL freeseats responses and combine - each may contain different sectors
                const combinedSfs: Record<string, Array<{ s: string[] }>> = {};
                const combinedSfc: Record<string, number> = {};
                // Capture tour arrangements to find specific event IDs
                let tourArrangements: { events?: Array<{ id: string; venue?: string; city?: string; date?: string }> } | null = null;
                const sectorCapacities: Record<string, { id: string, n: string, c: number }> = {};
                // Capture checkFreeSeats response - contains direct shop URL
                let checkFreeSeatsUrl: string | null = null;

                // Intercept responses
                page.on('response', async (response) => {
                    const url = response.url();
                    try {
                        // Capture checkFreeSeats - contains decryptedEventId for shop URL
                        if (url.includes('/api/event/checkfreeseats')) {
                            const data = await response.json();
                            if (data && data.url) {
                                checkFreeSeatsUrl = 'https://sklep.ebilet.pl' + data.url;
                                console.log(`[DEBUG eBilet] Intercepted checkfreeseats! URL: ${checkFreeSeatsUrl}`);
                            }
                        }
                        if (url.includes('/api/event/geteventfreeseats')) {
                            const data = await response.json();
                            if (data && data.url) {
                                checkFreeSeatsUrl = 'https://sklep.ebilet.pl' + data.url;
                                console.log(`[DEBUG eBilet] Intercepted geteventfreeseats! URL: ${checkFreeSeatsUrl}`);
                            }
                        }
                        if (url.includes('/storage/seats/') && url.includes('.json')) {
                            console.log(`[DEBUG eBilet] Intercepted seats.json URL: ${url}`);
                            const data = await response.json();
                            if (data?.sid && data?.s) {
                                seatsBySid.set(data.sid, data);
                                console.log(`[DEBUG eBilet] Successfully captured seats for sector sid=${data.sid}. Total sectors captured now: ${seatsBySid.size}`);
                            } else {
                                console.log(`[DEBUG eBilet] Warning: intercepted seats.json but it lacked 'sid' or 's' data.`);
                            }
                        }
                        // Capture arrangements.json for tour pages
                        if (url.includes('/storage/arrangements/') && url.includes('.json')) {
                            const data = await response.json();
                            if (data) {
                                tourArrangements = data;
                                console.log(`[DEBUG eBilet] Captured tour arrangements.json`);
                                if (data.s && Array.isArray(data.s)) {
                                    data.s.forEach((sec: any) => {
                                        sectorCapacities[sec.id] = { id: sec.id, n: sec.n, c: typeof sec.c === 'number' ? sec.c : (Array.isArray(sec.c) ? sec.c.length : 0) };
                                    });
                                    console.log(`[DEBUG eBilet] Parsed ${Object.keys(sectorCapacities).length} sectors from arrangements.json`);
                                }
                            }
                        }
                        if (url.includes('/api/event/getsectorfreeseats') || url.includes('getsectorfreeseats')) {
                            console.log(`[DEBUG eBilet] Intercepted getsectorfreeseats URL: ${url}`);
                            const data = await response.json();
                            if (data && 'sfs' in data && data.err === null) {
                                let localCount = 0;
                                // Combine all sfs from all responses
                                for (const sid of Object.keys(data.sfs)) {
                                    if (!combinedSfs[sid]) {
                                        combinedSfs[sid] = [];
                                    }
                                    combinedSfs[sid].push(...(data.sfs[sid] || []));
                                    localCount++;
                                }
                                console.log(`[DEBUG eBilet] Successfully processed getsectorfreeseats. Added data for ${localCount} sectors.`);
                            } else if (data && 'sfc' in data) {
                                // New Lazy Loaded Map format
                                for (const sid of Object.keys(data.sfc)) {
                                    combinedSfc[sid] = data.sfc[sid];
                                }
                                console.log(`[DEBUG eBilet] Captured sfc lazy-load data for ${Object.keys(data.sfc).length} sectors.`);
                            } else {
                                console.log(`[DEBUG eBilet] Warning: intercepted getsectorfreeseats but data was missing expected keys or threw error. data.err: ${data?.err}`);
                            }
                        }
                        // Capture checkFreeSeats - contains decryptedEventId for shop URL
                        if (url.includes('/api/Title/checkFreeSeats')) {
                            try {
                                const data = await response.json();
                                const item = Array.isArray(data) ? data[0] : data;
                                if (item?.decryptedEventId) {
                                    checkFreeSeatsUrl = `https://sklep.ebilet.pl/${item.decryptedEventId}`;
                                }
                            } catch { }
                        }
                    } catch { }
                });

                try {
                    let currentUrl = '';
                    let skipStandard = false;

                    // 1. Try Cached URL First
                    if (cachedEbiletUrl) {
                        console.log(`eBilet: SmartCache hit, trying ${cachedEbiletUrl}...`);
                        try {
                            await page.goto(cachedEbiletUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

                            // SMART WAIT STRATEGY FOR CACHED URL
                            let waitTime = 0;
                            while (waitTime < 5000) {
                                const capCount = Object.keys(sectorCapacities).length;
                                const geomCount = seatsBySid.size;
                                const sfsCount = Object.keys(combinedSfs).length;
                                const sfcCount = Object.keys(combinedSfc).length;

                                // We know capacity count from arrangements.json (loaded instantly). 
                                // We need geomCount (sfs schema) OR sfcCount (lazy schema) to match capCount.
                                if (capCount > 0 && ((geomCount > 0 && geomCount >= capCount) || (sfcCount > 0 && sfcCount >= capCount))) {
                                    console.log(`[DEBUG eBilet] SmartCache Wait: Captured all ${capCount} expected sectors in ${waitTime}ms!`);
                                    await page.waitForTimeout(200); // Tiny buffer for trailing packets
                                    break;
                                }
                                await page.waitForTimeout(200);
                                waitTime += 200;
                            }
                            // Fallback if capCount was 0 or never reached, we naturally slept for max 5s.

                            if (seatsBySid.size > 0 || Object.keys(combinedSfc).length > 0) {
                                skipStandard = true;
                                currentUrl = page.url();
                            } else {
                                console.log('eBilet: SmartCache failed (no seats). Clearing.');
                                clearCachedUrl(event.globalEventId, 'ebilet');
                            }
                        } catch (e) {
                            console.log('eBilet: SmartCache navigation failed:', e);
                        }
                    }

                    if (!skipStandard) {
                        // Build URL with city filter parameter
                        let targetUrl = event.sources.ebilet!.eventCardUrl;
                        const eventCityForUrl = event.cityOriginal || event.city || '';

                        if (eventCityForUrl) {
                            const separator = targetUrl.includes('?') ? '&' : '?';
                            targetUrl = `${targetUrl}${separator}city=${encodeURIComponent(eventCityForUrl)}`;
                        }

                        // Inject Cookie to prevent banner
                        await context!.addCookies([{
                            name: 'CookieConsent',
                            value: '{stamp:%27-%27%2Cnecessary:true%2Cpreferences:true%2Cstatistics:true%2Cmarketing:true%2Cmethod:%27explicit%27%2Cver:1%2Cutc:1700000000000%2Cregion:%27pl%27}',
                            domain: '.ebilet.pl',
                            path: '/'
                        }]);

                        console.log(`eBilet: Loading event page: ${targetUrl}`);
                        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                        await page.waitForTimeout(2000);

                        // Gracefully accept cookies instead of removing from DOM to unblock eBilet's jsaction listeners
                        try {
                            const acceptBtn = page.locator('#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll, #CybotCookiebotDialogBodyButtonAccept');
                            if (await acceptBtn.isVisible({ timeout: 2000 })) {
                                await acceptBtn.click({ force: true });
                                await page.waitForTimeout(1000);
                                // physically remove just in case it's doing a slow fade
                                await page.evaluate(() => {
                                    const ids = ['CybotCookiebotDialog', 'CybotCookiebotDialogBodyUnderlay'];
                                    ids.forEach(id => {
                                        const el = document.getElementById(id);
                                        if (el) el.remove();
                                    });
                                });
                                await page.waitForTimeout(500);
                            }
                        } catch (e) { }

                        // Try to find the specific event in the list if it's a tour page or single event
                        console.log(`[DEBUG eBilet] Searching for specific event button...`);

                        // Look for action buttons by text or aria-label
                        const allBuyButtons = page.locator('a, button').filter({ hasText: /Kup bilety|Wybierz/i }).or(page.locator('a[aria-label*="Kup bilety" i], button[aria-label*="Kup bilety" i], a[aria-label*="Wybierz" i], button[aria-label*="Wybierz" i]'));

                        // Wait briefly for elements to appear and for JS to hydrate event listeners!
                        await allBuyButtons.first().waitFor({ state: 'attached', timeout: 5000 }).catch(() => { });
                        await page.waitForTimeout(2000); // CRITICAL: Wait for Angular to attach jsaction listeners!

                        const buttonCount = await allBuyButtons.count().catch(() => 0);
                        let clicked = false;
                        currentUrl = page.url();

                        console.log(`[DEBUG eBilet] Found ${buttonCount} generic buy buttons. Looking for match with city: ${eventCityForUrl}`);

                        for (let i = 0; i < buttonCount; i++) {
                            const btn = allBuyButtons.nth(i);
                            const text = await btn.textContent().catch(() => '') || '';
                            const aria = await btn.getAttribute('aria-label').catch(() => '') || '';
                            const combinedText = `${text} ${aria}`.toLowerCase();

                            // If we have a city filter, enforce it
                            if (eventCityForUrl && !combinedText.includes(eventCityForUrl.toLowerCase())) {
                                // City not explicitly in button. Let's check its parent container (e.g., the row)
                                const parentRow = btn.locator('xpath=ancestor::*[contains(@class, "row") or contains(@class, "item") or contains(@class, "card")]').first();
                                const rowText = await parentRow.textContent().catch(() => '') || '';
                                if (!rowText.toLowerCase().includes(eventCityForUrl.toLowerCase())) {
                                    continue; // Skip this button as it's for another city
                                }
                            }

                            // Found a matching button!
                            const btnHref = await btn.getAttribute('href').catch(() => null);
                            if (btnHref && btnHref.includes('sklep.ebilet.pl')) {
                                console.log(`[DEBUG eBilet] Direct shop link found on the button itself: ${btnHref}`);
                                checkFreeSeatsUrl = btnHref;
                            }

                            console.log(`[DEBUG eBilet] Clicking button matched for city: ${eventCityForUrl}`);
                            try {
                                await btn.scrollIntoViewIfNeeded();
                                const box = await btn.boundingBox();
                                if (box) {
                                    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                                    await page.mouse.down();
                                    await page.waitForTimeout(50);
                                    await page.mouse.up();
                                } else {
                                    await btn.click({ delay: 50, force: true });
                                }
                                clicked = true;
                                break;
                            } catch (e) {
                                console.log(`[DEBUG eBilet] Failed to click button: ${e}`);
                            }
                        }

                        // Fallback if city matched none, but there is exactly 1 button, assume it's the one (or we are not on a tour page)
                        if (!clicked && buttonCount > 0) {
                            const btn = allBuyButtons.first();
                            const btnHref = await btn.getAttribute('href').catch(() => null);
                            if (btnHref && btnHref.includes('sklep.ebilet.pl')) checkFreeSeatsUrl = btnHref;
                            console.log(`[DEBUG eBilet] Clicking the first buy button available as fallback.`);
                            try {
                                await btn.scrollIntoViewIfNeeded();
                                await btn.click({ delay: 50, timeout: 5000 });
                                clicked = true;
                            } catch (e) { }
                        }

                        currentUrl = page.url();

                        if (clicked) {
                            // Setup a hook to catch router navigations or window.location changes
                            await page.exposeFunction('onTargetUrl', (url: string) => {
                                if (url.includes('sklep.ebilet.pl')) {
                                    checkFreeSeatsUrl = url;
                                    console.log(`[DEBUG eBilet] Intercepted navigation hook: ${url}`);
                                }
                            }).catch(() => { }); // might be already exposed

                            await page.evaluate(() => {
                                document.addEventListener('click', (e) => {
                                    const target = e.target as HTMLElement;
                                    const btn = target.closest('button, a') as HTMLAnchorElement | HTMLButtonElement | null;
                                    if (btn) {
                                        // @ts-ignore
                                        if (btn.href && btn.href.includes('sklep.ebilet.pl')) window.onTargetUrl(btn.href);
                                    }
                                }, true);

                                // Monitor history state changes (Angular router)
                                const win = window as any;
                                const origPushState = win.history.pushState;
                                win.history.pushState = function (...args: any[]) {
                                    const url = args[2];
                                    if (typeof url === 'string' && url.includes('sklep.ebilet.pl')) win.onTargetUrl(url);
                                    return origPushState.apply(this, args);
                                };

                                // Monitor window.open
                                const origOpen = win.open;
                                win.open = function (url?: string, target?: string, features?: string) {
                                    if (typeof url === 'string' && url.includes('sklep.ebilet.pl')) win.onTargetUrl(url);
                                    return origOpen.call(this, url, target, features);
                                }
                            });

                            // Attempt to extract decryptedEventId directly from Angular state first to save 10 seconds!
                            console.log(`[DEBUG eBilet] Analyzing DOM for decryptedEventId before waiting for redirect...`);
                            const extractedId = await page.evaluate(() => {
                                const stateScript = document.getElementById('serverApp-state');
                                if (!stateScript) return null;
                                const text = stateScript.textContent || '';
                                let match = /decryptedEventId[^\w\d]*([0-9]{14,20})/.exec(text);
                                if (!match) match = /&q;decryptedEventId&q;:&q;([0-9]{14,20})&q;/.exec(text);
                                return match ? match[1] : null;
                            });

                            if (extractedId) {
                                console.log(`[DEBUG eBilet] Found decryptedEventId in DOM: ${extractedId}. Skipping redirect wait!`);
                                checkFreeSeatsUrl = `https://sklep.ebilet.pl/${extractedId}`;
                            } else {
                                // Wait specifically for the URL interceptor if DOM parsing failed
                                console.log(`[DEBUG eBilet] Clicked button. Waiting for redirect (max 10s)...`);
                                for (let i = 0; i < 40; i++) {
                                    if (checkFreeSeatsUrl) break;
                                    if (page.url().includes('sklep.ebilet.pl')) {
                                        console.log(`[DEBUG eBilet] Caught page.url() redirect to: ${page.url()}`);
                                        checkFreeSeatsUrl = page.url();
                                        break;
                                    }
                                    await page.waitForTimeout(250);
                                }
                            }

                            // Find fallback shop link in DOM just in case
                            const allShopLinks = page.locator('a[href*="sklep.ebilet.pl"], a[href*="biletyna.pl"], a[href*="kupbilecik.pl"]');
                            const shopLinkCount = await allShopLinks.count().catch(() => 0);
                            let bestHref: string | null = null;

                            // NEW: check for iframes pointing to sklep
                            const iframes = page.locator('iframe[src*="sklep.ebilet.pl"]');
                            const iframeCount = await iframes.count().catch(() => 0);
                            if (iframeCount > 0) {
                                const src = await iframes.first().getAttribute('src').catch(() => null);
                                if (src) {
                                    console.log(`[DEBUG eBilet] Found sklep link in iframe src: ${src}`);
                                    checkFreeSeatsUrl = src;
                                }
                            }

                            console.log(`[DEBUG eBilet] Evaluated DOM links post-click. Count: ${shopLinkCount}, iframes: ${iframeCount}`);

                            // ALWAYS prioritize the intercepted dynamic data if it exists
                            if (checkFreeSeatsUrl) {
                                bestHref = checkFreeSeatsUrl;
                                console.log(`[DEBUG eBilet] Prioritizing checkFreeSeatsUrl: ${bestHref}`);
                            } else {
                                // Fallback to DOM parsing
                                for (let i = 0; i < shopLinkCount; i++) {
                                    const href = await allShopLinks.nth(i).getAttribute('href').catch(() => '') || '';
                                    if (href === 'https://sklep.ebilet.pl' || href === 'https://sklep.ebilet.pl/') continue;
                                    if (href.endsWith('.pdf') || href.includes('/storage/')) continue;
                                    const path = href.replace('https://sklep.ebilet.pl', '');
                                    if (path.length > 5) {
                                        bestHref = href;
                                        console.log(`[DEBUG eBilet] Selected bestHref from DOM links: ${bestHref}`);
                                        break;
                                    } else {
                                        console.log(`[DEBUG eBilet] Rejected shop link from DOM: ${href}, path length: ${path.length}`);
                                    }
                                }
                            }

                            // If we didn't extract a link but the button click already navigated us to the shop:
                            if (!bestHref && page.url().includes('sklep.ebilet.pl')) {
                                console.log(`[DEBUG eBilet] Page already navigated to shop via JS redirect: ${page.url()}`);
                                bestHref = page.url();
                            }

                            if (bestHref) {
                                console.log(`eBilet: Navigating to shop: ${bestHref}`);
                                await page.goto(bestHref, { timeout: 30000 });
                                console.log(`[DEBUG eBilet] Shop page loaded.`);

                                // SMART WAIT STRATEGY
                                const expectedSectors = Object.keys(sectorCapacities).length;
                                console.log(`[DEBUG eBilet] Cache check: Expecting ${expectedSectors} sectors based on arrangements.json.`);

                                if (expectedSectors > 0) {
                                    console.log(`eBilet: Smart Wait - Expecting ${expectedSectors} sectors...`);
                                    const waitStart = Date.now();
                                    const maxWait = 10000;
                                    while (Date.now() - waitStart < maxWait) {
                                        const geomCount = seatsBySid.size;
                                        const availCount = Object.keys(combinedSfs).length;
                                        const sfcCount = Object.keys(combinedSfc).length;

                                        if ((geomCount > 0 && geomCount >= expectedSectors) || (sfcCount > 0 && sfcCount >= expectedSectors)) {
                                            console.log(`[DEBUG eBilet] Smart Wait: Captured all ${expectedSectors} expected sectors.`);
                                            await page.waitForTimeout(500); // small buffer for trailing packets
                                            break;
                                        }
                                        await page.waitForTimeout(200);
                                    }
                                } else {
                                    // Heuristic Wait
                                    console.log(`[DEBUG eBilet] No expectations from cache. Using heuristic wait.`);
                                    try {
                                        await page.waitForResponse(response => {
                                            const url = response.url();
                                            return (url.includes('/storage/seats/') && url.includes('.json')) ||
                                                url.includes('getsectorfreeseats');
                                        }, { timeout: 8000 });
                                        console.log(`[DEBUG eBilet] First heuristic response received. Waiting for bursts...`);

                                        // Wait briefly for bursts
                                        let lastSize = seatsBySid.size;
                                        let silenceStart = Date.now();
                                        while (Date.now() - silenceStart < 2500 && Date.now() - silenceStart < 8000) {
                                            await page.waitForTimeout(200);
                                            if (seatsBySid.size > lastSize) {
                                                lastSize = seatsBySid.size;
                                                silenceStart = Date.now();
                                            }
                                        }
                                        console.log(`[DEBUG eBilet] Heuristic wait ended. Settled at ${seatsBySid.size} sectors.`);
                                    } catch (e) {
                                        console.log(`[DEBUG eBilet] Heuristic wait timed out waiting for responses.`);
                                    }
                                }

                                console.log(`eBilet: Navigation finished. Total: ${seatsBySid.size} sectors.`);
                            } else {
                                console.log(`[DEBUG eBilet] Failed to find bestHref to navigate to shop.`);
                                const html = await page.content();
                                import('fs').then(fs => fs.writeFileSync('debug-ebilet-no-href.html', html));
                            }
                        }

                        if (!clicked) {
                            console.log(`[DEBUG eBilet] No "Kup bilety" buttons found on the page!`);
                            const html = await page.content();
                            import('fs').then(fs => fs.writeFileSync('debug-ebilet-no-buttons.html', html));
                            console.log(`[DEBUG eBilet] Dumped HTML to debug-ebilet-no-buttons.html`);
                        }
                    } // close if(!skipStandard)

                    // Final URL Update
                    currentUrl = page.url();
                    if (currentUrl.includes('sklep.ebilet.pl')) {
                        await page.waitForTimeout(2000); // safety

                        // Save to cache
                        if (seatsBySid.size > 0) {
                            console.log(`eBilet: Saving SmartCache URL: ${currentUrl}`);
                            setCachedUrl(event.globalEventId, 'ebilet', currentUrl);
                        }
                    }

                    // Process data
                    const sfcCount = Object.keys(combinedSfc).length;
                    const sfsCount = Object.keys(combinedSfs).length;
                    const capCount = Object.keys(sectorCapacities).length;
                    console.log(`[DEBUG eBilet] Pre-processing check: seatsBySid.size = ${seatsBySid.size}, sfsCount = ${sfsCount}, sfcCount = ${sfcCount}, capCount = ${capCount}`);

                    if ((seatsBySid.size > 0 && sfsCount > 0) || (capCount > 0 && sfcCount > 0)) {
                        ebiletRawData = {
                            seatsBySid,
                            freeSeatsData: { sfs: combinedSfs, sfc: combinedSfc, err: null },
                            sectorCapacities,
                            currentUrl
                        };
                        console.log(`[DEBUG eBilet] Successfully mapped ebiletRawData.`);
                    } else {
                        console.log(`[DEBUG eBilet] WARNING: Missing either seat geometry data (${seatsBySid.size}) or availability data (${sfsCount}/${sfcCount}). Dropping eBilet data.`);
                    }
                } catch (e) {
                    console.error('eBilet: Unexpected error', e);
                } finally {
                    await page.close();
                }
            })());
        }

        // KupBilecik
        if (event.sources.kupbilecik) {
            sourcePromises.push((async () => {
                const page = await context!.newPage();
                let obiektData: KupBilecikObiektData | null = null;

                // Block heavy resources and trackers for massive speedup on KupBilecik
                try {
                    await page.route('**/*.{png,jpg,jpeg,gif,webp,svg,mp4,webm,css,woff,woff2}', route => route.abort());
                } catch { }

                page.on('response', async (response) => {
                    if (response.url().includes('ajax_krok_1')) {
                        try {
                            const text = await response.text();
                            const match = text.match(/var\s+obiekt_data\s*=\s*(\{[\s\S]*?\});/);
                            if (match?.[1]) obiektData = JSON.parse(match[1]);
                        } catch { }
                    }
                });

                try {
                    let navigationSuccess = false;
                    if (cachedKupbilecikUrl) {
                        try {
                            await page.goto(cachedKupbilecikUrl, { timeout: 30000 });
                            navigationSuccess = true;
                        } catch { }
                    }
                    if (!navigationSuccess) {
                        await page.goto(event.sources.kupbilecik!.eventCardUrl, { timeout: 30000 });
                    }

                    // Check if data is already in DOM (common when loaded directly via cache 'bilety.php')
                    if (!obiektData) {
                        try {
                            const html = await page.content();
                            const match = html.match(/var\s+obiekt_data\s*=\s*(\{[\s\S]*?\});/);
                            if (match?.[1]) {
                                obiektData = JSON.parse(match[1]);
                                console.log('[DEBUG KupBilecik] Retrieved object data directly from DOM regex match');
                            }
                        } catch (e) {
                            console.error("[DEBUG KupBilecik] Error parsing obiektData from DOM", e);
                        }
                    }

                    // If not in DOM (first load / routing), wait for the network request
                    if (!obiektData) {
                        try {
                            // First, let's explicitly wait for the map container to exist which guarantees DOM logic ran
                            await page.waitForSelector('#plan_obiektu', { timeout: 3000 }).catch(() => { });

                            // Re-check DOM one more time in case it loaded fast while we waited
                            const html = await page.content();
                            const match = html.match(/var\s+obiekt_data\s*=\s*(\{[\s\S]*?\});/);
                            if (match?.[1]) {
                                obiektData = JSON.parse(match[1]);
                                console.log('[DEBUG KupBilecik] Retrieved object data directly from DOM regex match after waiting');
                            } else {
                                // If REALLY not in DOM, we wait for the ajax call
                                console.log('[DEBUG KupBilecik] Not in DOM, falling back to network WAIT for 5000ms');
                                await page.waitForResponse(r => r.url().includes('ajax_krok_1'), { timeout: 5000 });
                            }
                        } catch { }
                    }

                    if (obiektData) {
                        console.log(`[DEBUG KupBilecik] Object data captured, processing stats.`);
                        kupbilecikRawData = {
                            obiektData,
                            finalUrl: page.url()
                        };
                        if (page.url().includes('bilety.php')) {
                            setCachedUrl(event.globalEventId, 'kupbilecik', page.url());
                        }
                        const stats = processKupbilecikData(obiektData);
                        if (stats) {
                            stats.finalUrl = page.url();
                            results.kupbilecik = stats;
                            console.log(`[DEBUG KupBilecik] successfully returned and mapped stats.`);
                        } else {
                            console.log(`[DEBUG KupBilecik] processKupbilecikData returned null! objectData might be malformed or empty.`);
                        }
                    } else {
                        console.log(`[DEBUG KupBilecik] No obiektData captured from DOM or Response.`);
                    }

                } finally {
                    await page.close();
                }
            })());
        }

        await Promise.all(sourcePromises);

        // --- POST PROCESSING (Process collected raw data) ---
        // 1. Biletyna (Multi-sector combine)
        const bData = biletynaRawData as BiletynaRawData | null;
        if (bData) {
            const stats = combineBiletynaSectors(bData.sectorResults, results.kupbilecik?.sectors);
            if (stats) {
                stats.finalUrl = bData.finalUrl;
                results.biletyna = stats;
            }
        } else if (results.biletyna?.sectors && results.kupbilecik?.sectors) {
            // SMART-CACHE FLOW: Match the solitary Biletyna sector against KupBilecik geometries now that they are downloaded
            for (const bSector of results.biletyna.sectors) {
                if (!results.kupbilecik.sectors.find(k => k.sectorName === bSector.sectorName)) {
                    const matched = matchSectorByStructure(new Map(Object.entries(bSector.rows)), results.kupbilecik.sectors, new Set());
                    if (matched) {
                        bSector.sectorName = matched.sectorName;
                    }
                }
            }
        }

        // 2. eBilet (Combine seats with availability)
        const eData = ebiletRawData as EbiletRawData | null;
        if (eData) {
            const stats = processEbiletAllSectors(
                eData.seatsBySid,
                eData.freeSeatsData,
                results.kupbilecik?.sectors
            );
            if (stats) {
                stats.finalUrl = eData.currentUrl;
                results.ebilet = stats;
            }
        }

    } finally {
        if (context) await context.close();
    }


    // --- AGGREGATION & HISTORY ---
    let totalSeats = 0;
    let totalFree = 0;
    let totalTaken = 0;

    for (const source of Object.values(results)) {
        if (source) {
            totalSeats += source.totals.total;
            totalFree += source.totals.free;
            totalTaken += source.totals.taken;
        }
    }

    // History Logic
    const history = await loadHistory(event.globalEventId);

    // Create a global set of ALL currently free seats across ALL platforms
    const allCurrentFreeKeys = new Set<string>();

    // We also need per-platform tracking to adjust diff math later
    const currentFreeKeysBySource: Record<string, Set<string>> = {
        biletyna: new Set(),
        ebilet: new Set(),
        kupbilecik: new Set()
    };

    const knownSectors = new Set<string>();

    for (const [sourceName, sourceData] of Object.entries(results)) {
        if (!sourceData || !sourceData.sectors) continue;
        const source = sourceName as SourceType;
        for (const sector of sourceData.sectors) {
            knownSectors.add(sector.sectorName);
            for (const seatKey of sector.freeSeats) {
                const normalizedSeatKey = normalizeSeatKey(seatKey);
                // Tworzymy unikalny klucz ignorujący ew. białe znaki czy formatowanie np "SALA:12-3"
                const uniqueKey = `${sector.sectorName}:${normalizedSeatKey}`;
                allCurrentFreeKeys.add(uniqueKey);
                currentFreeKeysBySource[source].add(uniqueKey);
            }
            touchCachedUrl(event.globalEventId, source);
        }
    }

    const inferredSold: Record<string, SourceType> = {};
    const shiftedFrom: Record<string, number> = { biletyna: 0, ebilet: 0, kupbilecik: 0 };

    for (const [uniqueKey, lastSource] of Object.entries(history)) {
        const [sectorName] = uniqueKey.split(':');
        if (knownSectors.has(sectorName)) {
            // Jeśli miejsce było kiedyś wolne, ale na obecnej platformie już go nie ma w wolnych:
            if (!currentFreeKeysBySource[lastSource]?.has(uniqueKey)) {
                // Sprawdzamy czy to miejsce "trafiło" na inną platformę?
                if (allCurrentFreeKeys.has(uniqueKey)) {
                    // Tak! Miejsce nadal jest wolne, tylko pod innym operatorem. To nie jest sprzedaż!
                    // Zliczamy to przenesienie by odjąć je od statystyki "Sprzedanych" dla starego operatora
                    shiftedFrom[lastSource]++;
                } else {
                    // Nie ma go nigdzie. Miejsce zostało autentycznie sprzedane.
                    inferredSold[uniqueKey] = lastSource;
                }
            }
        }
    }

    // Aktualizujemy obiekt historii. Zapisujemy z powrotem, pamiętając skąd dane miejsce pochodzi obecnie "Wolne"
    const newHistory: Record<string, SourceType> = {};
    for (const [source, keys] of Object.entries(currentFreeKeysBySource)) {
        for (const key of keys) {
            newHistory[key] = source as SourceType;
        }
    }
    await saveHistory(event.globalEventId, newHistory);

    const currentStatsEntry: StatsHistoryEntry = {
        biletynaTaken: results.biletyna?.totals.taken || 0,
        ebiletTaken: results.ebilet?.totals.taken || 0,
        kupbilecikTaken: results.kupbilecik?.totals.taken || 0,
        biletynaFree: results.biletyna?.totals.free || 0,
        ebiletFree: results.ebilet?.totals.free || 0,
        kupbilecikFree: results.kupbilecik?.totals.free || 0,
        timestamp: new Date().toISOString()
    };

    const prevStats = await loadStatsHistory(event.globalEventId);
    let diffObj = undefined;

    if (prevStats) {
        // Obliczamy sprzedane sumując bezpośrednio wyizolowane fotele, które przepadły ze starej platformy i NIE uległy migracji
        let bSold = 0;
        let eSold = 0;
        let kSold = 0;

        for (const source of Object.values(inferredSold)) {
            if (source === 'biletyna') bSold++;
            if (source === 'ebilet') eSold++;
            if (source === 'kupbilecik') kSold++;
        }

        diffObj = {
            biletynaSold: bSold,
            ebiletSold: eSold,
            kupbilecikSold: kSold,
            lastUpdated: prevStats.timestamp
        };

        // Trigger Discord notification if there are sales
        const totalSold = bSold + eSold + kSold;
        if (totalSold > 0) {
            // Background dispatch
            sendDiscordSaleNotification({
                eventId: event.globalEventId,
                eventTitle: event.title,
                soldSeatsCount: totalSold,
                details: Object.entries(inferredSold).map(([uniqueKey, source]) => {
                    const [sector, seatKey] = uniqueKey.split(':');
                    const [row, seat] = seatKey.split('-');
                    return { sector, row, seat, source };
                })
            }).catch(e => console.error('Error dispatching Discord webhook:', e));
        }
    }

    await saveStatsHistory(event.globalEventId, currentStatsEntry);

    const combinedStats: CombinedEventStats = {
        globalEventId: event.globalEventId,
        title: event.title,
        date: event.date,
        perSource: results,
        combinedTotals: {
            total: totalSeats,
            free: totalFree,
            taken: totalTaken,
        },
        inferredSold,
        diff: diffObj
    };

    // Save to FULL CACHE
    saveFullStats(event.globalEventId, combinedStats);

    return combinedStats;
}
