import type { Page } from 'playwright';
import type { RawEvent } from '../types';

const EBILET_URL = 'https://www.ebilet.pl/organizatorzy/wikart-malgorzata-wnuk';

async function dismissCookieDialog(page: Page): Promise<void> {
  const cookieSelectors = [
    '#CybotCookiebotDialogBodyButtonDecline',
    '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
    '#CybotCookiebotDialogBodyButtonAccept',
  ];

  for (const selector of cookieSelectors) {
    try {
      const btn = page.locator(selector).first();
      const isVisible = await btn.isVisible({ timeout: 1000 }).catch(() => false);
      if (isVisible) {
        await btn.click({ force: true });
        await page.waitForTimeout(1000);
        return;
      }
    } catch {
      // Continue to next selector
    }
  }

  // Force remove cookie overlay
  await page.evaluate(() => {
    const overlay = document.getElementById('CybotCookiebotDialog');
    if (overlay) overlay.remove();
    const underlay = document.getElementById('CybotCookiebotDialogBodyUnderlay');
    if (underlay) underlay.remove();
  });
}

export async function scrapeEbiletEvents(page: Page): Promise<RawEvent[]> {
  await page.goto(EBILET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Wait for Angular to render
  try {
    await page.waitForSelector('eb-title-event-bar, .title-event-container', { timeout: 15000 });
  } catch {
    console.log('eBilet: No event bars found');
  }

  await page.waitForTimeout(3000);

  // Dismiss cookie dialog
  await dismissCookieDialog(page);
  await page.waitForTimeout(1000);

  // Click "Zobacz więcej" button repeatedly to load all events
  let iteration = 0;
  const maxIterations = 15;

  while (iteration < maxIterations) {
    iteration++;

    const seeMoreBtn = page.locator('button:has-text("Zobacz więcej")').first();
    const isVisible = await seeMoreBtn.isVisible({ timeout: 2000 }).catch(() => false);

    if (isVisible) {
      const beforeCount = await page.locator('eb-title-event-bar').count();
      await seeMoreBtn.click();
      await page.waitForTimeout(2000);
      const afterCount = await page.locator('eb-title-event-bar').count();

      if (afterCount === beforeCount) {
        break;
      }
    } else {
      break;
    }
  }

  // Extract events
  const events = await page.evaluate(() => {
    const results: Array<{
      title: string;
      date: string;
      time: string;
      city: string;
      venue: string;
      url: string;
    }> = [];

    // Find all event bars
    const bars = document.querySelectorAll('eb-title-event-bar, .title-event-container');

    for (const bar of bars) {
      // Title from header link
      const headerLink = bar.querySelector('.eb-title-event-bar__header a, h5 a') as HTMLAnchorElement;
      const title = headerLink?.textContent?.trim() || '';

      // Date and time from dateTmpl elements
      const dateTmpls = bar.querySelectorAll('.eb-title-event-bar__dateTmpl');
      let date = '';
      let time = '';

      dateTmpls.forEach(el => {
        const text = el.textContent?.trim() || '';
        if (text.match(/\d{2}\.\d{2}\.\d{4}/)) {
          date = text;
        } else if (text.match(/\d{1,2}:\d{2}/)) {
          time = text;
        }
      });

      // City and venue from info section
      const infoEl = bar.querySelector('.eb-title-event-bar__info');
      const spans = infoEl?.querySelectorAll('span') || [];
      let city = '';
      let venue = '';

      if (spans.length >= 2) {
        city = spans[0].textContent?.trim().replace(/,\s*$/, '') || '';
        venue = spans[1].textContent?.trim() || '';
      } else if (spans.length === 1) {
        city = spans[0].textContent?.trim().replace(/,\s*$/, '') || '';
      }

      // URL: Prioritize "Kup bilet" button (direct shop link), fallback to header link (event page)
      // Look for links to sklep.ebilet.pl OR /bilety/
      const buyBtn = bar.querySelector('a[href*="sklep.ebilet.pl"], a[href*="/bilety/"], button[href*="/bilety/"]') as HTMLAnchorElement;
      let url = buyBtn?.href || '';

      if (url) {
        console.log(`eBilet: Found direct shop link for "${title}": ${url}`);
      }

      if (!url) {
        url = headerLink?.href || '';
        console.log(`eBilet: Using header link for "${title}": ${url}`);
      }

      if (title && date) {
        results.push({
          title,
          date,
          time,
          city,
          venue,
          url
        });
      }
    }

    return results;
  });

  console.log(`eBilet: Found ${events.length} events`);

  // Process and normalize
  return events.map(e => ({
    source: 'ebilet' as const,
    title: e.title,
    date: parseDate(e.date),
    time: e.time,
    city: normalizeCity(e.city),
    cityOriginal: e.city.trim(), // Keep original with Polish chars for URL
    venue: e.venue,
    eventCardUrl: e.url || EBILET_URL,
    buyButtonSelector: 'eb-button, .eb-btn, button[class*="btn"], a[href*="/bilety/"]',
  }));
}

// Parse "DD.MM.YYYY" to "YYYY-MM-DD"
function parseDate(dateStr: string): string {
  if (!dateStr) return '';

  const match = dateStr.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (match) {
    const day = match[1].padStart(2, '0');
    const month = match[2].padStart(2, '0');
    const year = match[3];
    return `${year}-${month}-${day}`;
  }

  return '';
}

// Normalize city name
function normalizeCity(city: string): string {
  return city
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}
