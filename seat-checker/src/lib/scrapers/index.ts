import { chromium, type Browser, type Page } from 'playwright';
import type { RawEvent, SourceType } from '../types';
import { scrapeBiletynaEvents } from './biletyna';
import { scrapeEbiletEvents } from './ebilet';
import { scrapeKupbilecikEvents } from './kupbilecik';

export interface ScrapeResult {
  source: SourceType;
  events: RawEvent[];
  error?: string;
}

export async function scrapeAllEvents(): Promise<ScrapeResult[]> {
  const results: ScrapeResult[] = [];
  let browser: Browser | null = null;
  
  // 1. Uruchomienie przeglądarki (kosztowna operacja, robimy to raz)
  try {
    browser = await chromium.launch({
      headless: true,
    });
    
    // 2. Utworzenie kontekstu przeglądarki (izolowana sesja, jakby osobny profil)
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

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
  // ... obsługa błędów i zamykanie browsera
  } catch (error) {
    console.error('Error during scraping:', error);
  } finally {
    if (browser) {
      await browser.close();
    }
  }

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
    console.error(`Error scraping ${source}:`, errorMessage);
    return { source, events: [], error: errorMessage };
  }
}

// Re-export individual scrapers
export { scrapeBiletynaEvents } from './biletyna';
export { scrapeEbiletEvents } from './ebilet';
export { scrapeKupbilecikEvents } from './kupbilecik';
