import type { Page } from 'playwright';
import type { RawEvent } from '../types';

const BILETYNA_URL = 'https://biletyna.pl/event/index/?q=Wikart#list';

export async function scrapeBiletynaEvents(page: Page): Promise<RawEvent[]> {
  await page.goto(BILETYNA_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Wait for event rows to load
  try {
    await page.waitForSelector('tr.event-row', { timeout: 15000 });
  } catch {
    console.log('Biletyna: No event rows found');
  }

  await page.waitForTimeout(3000);

  // Extract events from tr.event-row elements (konkretne terminy)
  const events = await page.evaluate(() => {
    const results: Array<{
      title: string;
      date: string;
      time: string;
      city: string;
      venue: string;
      url: string;
    }> = [];

    // Znajdź wszystkie wiersze z wydarzeniami
    const rows = document.querySelectorAll('tr.event-row');

    for (const row of rows) {
      // Tytuł z .event-title lub img alt
      const titleEl = row.querySelector('.event-title a, .event-title p');
      const imgEl = row.querySelector('img');
      const title = titleEl?.textContent?.trim() || imgEl?.alt || '';

      // Data - w .event-date, format "DD.MM.YYYY"
      const dateEl = row.querySelector('.event-date .table-important-text');
      const dateText = dateEl?.textContent?.trim() || '';

      // Godzina - tekst po dacie, np. "godz. 18:00"
      const dateContainer = row.querySelector('.event-date');
      const timeMatch = dateContainer?.textContent?.match(/godz\.\s*(\d{1,2}:\d{2})/i);
      const time = timeMatch ? timeMatch[1] : '';

      // Miasto i miejsce z .event-place
      const placeEl = row.querySelector('.event-place');
      const cityEl = placeEl?.querySelector('.table-important-text a, .table-important-text');
      const city = cityEl?.textContent?.trim() || '';

      // Venue - drugi link lub tekst po mieście
      const venueLinks = placeEl?.querySelectorAll('a');
      let venue = '';
      if (venueLinks && venueLinks.length > 1) {
        venue = venueLinks[1].textContent?.trim() || '';
      }

      // URL do zakupu biletu
      const buyLink = row.querySelector('a[href*="/event/view/id/"]') as HTMLAnchorElement;
      const url = buyLink?.href || '';

      if (title && url) {
        results.push({
          title,
          date: dateText,
          time,
          city,
          venue,
          url
        });
      }
    }

    return results;
  });

  // Process and normalize
  return events.map(e => ({
    source: 'biletyna' as const,
    title: e.title,
    date: parseDate(e.date),
    time: e.time,
    city: normalizeCity(e.city),
    venue: e.venue,
    eventCardUrl: e.url,
    buyButtonSelector: '.B-btn--primary, .ticket-buy, a[href*="/event/view/"]',
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

// Normalize city name (remove diacritics, lowercase)
function normalizeCity(city: string): string {
  return city
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}
