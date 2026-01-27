import type { RawEvent, JoinedEvent, SourceType, SourceData } from './types';

/**
 * Join events from multiple sources based on EXACT match of:
 * - date (YYYY-MM-DD)
 * - time (HH:MM)
 * - city (normalized)
 *
 * Events that don't match any other are kept as single-source events.
 */
export function joinEvents(rawEvents: RawEvent[]): JoinedEvent[] {
  // Group events by join key: date + time + city
  const eventGroups = new Map<string, RawEvent[]>();

  for (const event of rawEvents) {
    const key = createJoinKey(event);
    if (!eventGroups.has(key)) {
      eventGroups.set(key, []);
    }
    eventGroups.get(key)!.push(event);
  }

  // Convert groups to JoinedEvents
  const joinedEvents: JoinedEvent[] = [];

  for (const [key, events] of eventGroups) {
    // Pick the best title (prefer longer, more descriptive titles)
    const bestEvent = events.reduce((a, b) =>
      a.title.length >= b.title.length ? a : b
    );

    const sourceData: JoinedEvent['sources'] = {};

    for (const event of events) {
      sourceData[event.source] = {
        eventCardUrl: event.eventCardUrl,
        buyButtonSelector: event.buyButtonSelector,
        venue: event.venue,
      };
    }

    const globalId = generateEventId(bestEvent);

    // Get cityOriginal from ebilet source if available (it has Polish chars)
    const ebiletEvent = events.find(e => e.source === 'ebilet');
    const cityOriginal = ebiletEvent?.cityOriginal || bestEvent.cityOriginal;

    joinedEvents.push({
      globalEventId: globalId,
      title: bestEvent.title,
      date: bestEvent.date,
      time: bestEvent.time,
      city: bestEvent.city,
      cityOriginal,
      sources: sourceData,
    });
  }

  // Sort by date + time (ascending - soonest first)
  return joinedEvents.sort((a, b) => {
    const dateTimeA = `${a.date} ${a.time}`;
    const dateTimeB = `${b.date} ${b.time}`;
    return dateTimeA.localeCompare(dateTimeB);
  });
}

/**
 * Create join key from event data.
 * Key format: "YYYY-MM-DD|HH:MM|normalizedcity"
 */
function createJoinKey(event: RawEvent): string {
  const date = event.date || 'unknown';
  const time = event.time || '00:00';
  const city = event.city || 'unknown';

  return `${date}|${time}|${city}`;
}

/**
 * Generate unique event ID
 */
function generateEventId(event: RawEvent): string {
  const datePart = event.date.replace(/-/g, '');
  const timePart = event.time.replace(':', '');
  const cityPart = event.city.substring(0, 10).replace(/\s/g, '');

  // Add short hash of title
  const titleHash = hashString(event.title).toString(36).substring(0, 6);

  return `${datePart}-${timePart}-${cityPart}-${titleHash}`;
}

/**
 * Simple string hash function
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/**
 * Get list of sources for an event
 */
export function getSourcesList(event: JoinedEvent): SourceType[] {
  return (['biletyna', 'ebilet', 'kupbilecik'] as SourceType[])
    .filter(source => event.sources[source]);
}

/**
 * Get source count for an event
 */
export function getSourceCount(event: JoinedEvent): number {
  return getSourcesList(event).length;
}

/**
 * Format date for display (Polish format)
 */
export function formatDatePolish(dateStr: string): string {
  if (!dateStr) return '';

  try {
    const [year, month, day] = dateStr.split('-');
    return `${day}.${month}.${year}`;
  } catch {
    return dateStr;
  }
}
