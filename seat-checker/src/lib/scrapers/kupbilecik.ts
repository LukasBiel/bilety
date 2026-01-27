import type { Page } from 'playwright';
import type { RawEvent } from '../types';

const KUPBILECIK_URL = 'https://wikart.kupbilecik.pl/';

interface JsonLdEvent {
  '@type': string;
  name: string;
  startDate: string;
  endDate?: string;
  url: string;
  location?: {
    '@type': string;
    name: string;
    address?: {
      addressLocality?: string;
    };
  };
}

interface JsonLdOrganization {
  '@type': string;
  event?: JsonLdEvent[];
}

export async function scrapeKupbilecikEvents(page: Page): Promise<RawEvent[]> {
  const allEvents: Array<{
    title: string;
    date: string;
    time: string;
    city: string;
    venue: string;
    url: string;
  }> = [];

  let currentUrl = KUPBILECIK_URL;
  let pageNum = 1;
  const maxPages = 10; // Safety limit

  while (pageNum <= maxPages) {
    await page.goto(currentUrl, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(2000);

    // Extract events from JSON-LD on current page
    const pageEvents = await page.evaluate(() => {
      const results: Array<{
        title: string;
        date: string;
        time: string;
        city: string;
        venue: string;
        url: string;
      }> = [];

      // Find JSON-LD script
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');

      for (const script of scripts) {
        try {
          const json = JSON.parse(script.textContent || '');

          // Check if it's an Organization with events
          if (json['@type'] === 'Organization' && json.event) {
            for (const event of json.event) {
              const title = event.name || '';
              const startDate = event.startDate || '';
              const url = event.url || '';

              // Parse ISO date
              let date = '';
              let time = '';
              if (startDate) {
                const dateObj = new Date(startDate);
                // Format: YYYY-MM-DD
                date = dateObj.toISOString().split('T')[0];
                // Format: HH:MM
                time = startDate.match(/T(\d{2}:\d{2})/)?.[1] || '';
              }

              // Location
              const city = event.location?.address?.addressLocality || '';
              const venue = event.location?.name || '';

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
          }
        } catch (e) {
          // Ignore parse errors
        }
      }

      return results;
    });

    console.log(`KupBilecik: Page ${pageNum} - found ${pageEvents.length} events`);
    allEvents.push(...pageEvents);

    // Check for next page using <link rel="next"> tag
    const nextPageUrl = await page.evaluate(() => {
      const nextLink = document.querySelector('link[rel="next"]') as HTMLLinkElement;
      return nextLink?.href || null;
    });

    if (!nextPageUrl) {
      console.log(`KupBilecik: No more pages after page ${pageNum}`);
      break;
    }

    currentUrl = nextPageUrl;
    pageNum++;
  }

  console.log(`KupBilecik: Found ${allEvents.length} total events from ${pageNum} page(s)`);

  // Process and normalize
  return allEvents.map(e => ({
    source: 'kupbilecik' as const,
    title: e.title,
    date: e.date,  // Already in YYYY-MM-DD format
    time: e.time,
    city: normalizeCity(e.city),
    venue: e.venue,
    eventCardUrl: e.url,
    buyButtonSelector: '.buy-button, .btn-buy, a[href*="imprezy"], button:has-text("Kup")',
  }));
}

// Normalize city name
function normalizeCity(city: string): string {
  return city
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}
