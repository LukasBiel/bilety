import { type Browser, type Page } from 'playwright';
import type { RawEvent, SourceType, ScrapeResult } from '../types';
import { getGlobalBrowser } from '../globalBrowser';
import { scrapeBiletynaEvents } from './biletyna';
import { scrapeEbiletEvents } from './ebilet';
import { scrapeKupbilecikEvents } from './kupbilecik';



export async function scrapeAllEvents(): Promise<ScrapeResult[]> {
  const results: ScrapeResult[] = [];

  try {
    const browser = await getGlobalBrowser();

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    // OPTIMIZATION: Block unnecessary resources for faster scraping
    await context.route('**/*.{png,jpg,jpeg,gif,webp,svg,css,woff,woff2,ico,otf,ttf}', route => route.abort());

    // Scrape all sources in parallel using separate pages
    const [biletynaPage, ebiletPage, kupbilecikPage] = await Promise.all([
      context.newPage(),
      context.newPage(),
      context.newPage(),
    ]);

    // 4. Uruchamiamy wszystkie scrapery równolegle (Promise.all)
    const scrapePromises = [
      scrapeSource('biletyna', biletynaPage, scrapeBiletynaEvents),
      scrapeSource('ebilet', ebiletPage, scrapeEbiletEvents),
      scrapeSource('kupbilecik', kupbilecikPage, scrapeKupbilecikEvents),
    ];

    const scrapeResults = await Promise.all(scrapePromises);
    results.push(...scrapeResults);

    // IMPORTANT: Close context to free memory, but KEEP BROWSER OPEN
    await context.close();

  } catch (error) {
    console.error('Error during scraping:', error);
  }
  // removed browser.close()

  return results;
}

async function scrapeSource(
  source: SourceType,
  page: Page,
  scraper: (page: Page) => Promise<RawEvent[]>
): Promise<ScrapeResult> {
  try {
    const events = await scraper(page);
    console.log(`${source}: Found ${events.length} events`);
    return { source, events };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Error scraping ${source}: `, errorMessage);
    return { source, events: [], error: errorMessage };
  }
}

// Re-export individual scrapers
export { scrapeBiletynaEvents } from './biletyna';
export { scrapeEbiletEvents } from './ebilet';
export { scrapeKupbilecikEvents } from './kupbilecik';
