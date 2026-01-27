import { NextResponse } from 'next/server';
import { scrapeAllEvents } from '@/lib/scrapers';
import { joinEvents } from '@/lib/eventJoin';
import type { JoinedEvent } from '@/lib/types';
import { hasCachedData, getCacheTimestamp } from '@/lib/urlCache';
import fs from 'fs';
import path from 'path';

const SEEN_EVENTS_FILE = path.join(process.cwd(), 'data', 'seen_events.json');

function loadSeenEvents(): Set<string> {
  try {
    if (fs.existsSync(SEEN_EVENTS_FILE)) {
      const data = fs.readFileSync(SEEN_EVENTS_FILE, 'utf-8');
      const ids = JSON.parse(data);
      return new Set(ids);
    }
  } catch (e) {
    console.error('Failed to load seen events:', e);
  }
  return new Set();
}

function saveSeenEvents(ids: Set<string>) {
  try {
    const dir = path.dirname(SEEN_EVENTS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SEEN_EVENTS_FILE, JSON.stringify(Array.from(ids), null, 2));
  } catch (e) {
    console.error('Failed to save seen events:', e);
  }
}

// In-memory cache for events (in production, use Redis or similar)
let eventsCache: {
  events: JoinedEvent[];
  lastUpdated: Date | null;
} = {
  events: [],
  lastUpdated: null,
};

// GET - fetch cached events or scrape new ones
export async function GET() {
  try {
    // Return cached events if available and recent (less than 5 minutes old)
    if (eventsCache.lastUpdated) {
      const cacheAge = Date.now() - eventsCache.lastUpdated.getTime();
      if (cacheAge < 5 * 60 * 1000) {
        return NextResponse.json({
          success: true,
          events: eventsCache.events,
          lastUpdated: eventsCache.lastUpdated?.toISOString() || new Date().toISOString(),
          fromCache: true,
        });
      }
    }

    // Scrape fresh events
    const scrapeResults = await scrapeAllEvents();

    // Collect all raw events
    const allRawEvents = scrapeResults.flatMap(result => result.events);

    // Join events from all sources
    // Join events from all sources
    const joinedEventsRaw = joinEvents(allRawEvents);

    // Enrich events with cache status and "new" status
    const seenEvents = loadSeenEvents();
    const joinedEvents = joinedEventsRaw.map(evt => {
      const isNew = !seenEvents.has(evt.globalEventId);
      if (isNew) seenEvents.add(evt.globalEventId);

      return {
        ...evt,
        hasCache: hasCachedData(evt.globalEventId),
        cacheTimestamp: getCacheTimestamp(evt.globalEventId) || undefined,
        isNew
      };
    });

    // Save updated seen events
    saveSeenEvents(seenEvents);

    // Update cache
    eventsCache = {
      events: joinedEvents,
      lastUpdated: new Date(),
    };

    // Build response with scrape details
    const sourceDetails = scrapeResults.map(r => ({
      source: r.source,
      count: r.events.length,
      error: r.error,
    }));

    return NextResponse.json({
      success: true,
      events: joinedEvents,
      lastUpdated: eventsCache.lastUpdated?.toISOString() || new Date().toISOString(),
      fromCache: false,
      sourceDetails,
    });

  } catch (error) {
    console.error('Error fetching events:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}

// POST - force refresh events
export async function POST() {
  try {
    console.log('Force refreshing events...');

    // Scrape fresh events
    const scrapeResults = await scrapeAllEvents();

    // Collect all raw events
    const allRawEvents = scrapeResults.flatMap(result => result.events);

    // Join events from all sources
    // Join events from all sources
    const joinedEventsRaw = joinEvents(allRawEvents);

    // Enrich events
    const seenEvents = loadSeenEvents();
    const joinedEvents = joinedEventsRaw.map(evt => {
      const isNew = !seenEvents.has(evt.globalEventId);
      if (isNew) seenEvents.add(evt.globalEventId);

      return {
        ...evt,
        hasCache: hasCachedData(evt.globalEventId),
        cacheTimestamp: getCacheTimestamp(evt.globalEventId) || undefined,
        isNew
      };
    });
    saveSeenEvents(seenEvents);

    // Update cache
    eventsCache = {
      events: joinedEvents,
      lastUpdated: new Date(),
    };

    // Build response with scrape details
    const sourceDetails = scrapeResults.map(r => ({
      source: r.source,
      count: r.events.length,
      error: r.error,
    }));

    return NextResponse.json({
      success: true,
      events: joinedEvents,
      lastUpdated: eventsCache.lastUpdated?.toISOString() || new Date().toISOString(),
      sourceDetails,
    });

  } catch (error) {
    console.error('Error refreshing events:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}
