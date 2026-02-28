import { NextRequest, NextResponse } from 'next/server';
import { scrapeEventStats } from '@/lib/scrapers/eventScraper';
import type { JoinedEvent } from '@/lib/types';
import { loadHistory, clearHistory } from '@/lib/history';
import { loadFullStats } from '@/lib/fullStatsCache';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  // Try to load fully cached stats first (Instant Load)
  const cachedStats = loadFullStats(id);

  if (cachedStats) {
    return NextResponse.json({
      success: true,
      stats: cachedStats,
      fromCache: true
    });
  }

  return NextResponse.json({
    success: false,
    stats: null,
    message: 'No cached stats found'
  });
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  try {
    const body = await request.json();
    const event: JoinedEvent = body.event;
    // Check if client explicitly requested a refresh (e.g. clicked "Odśwież")
    const forceRefresh = body.forceRefresh || false;
    const background = body.background || false;

    if (!event) {
      return NextResponse.json({ error: 'Event data is required' }, { status: 400 });
    }

    // Safety check: if we have cache and NOT forced, return it
    if (!forceRefresh) {
      const cached = loadFullStats(id);
      if (cached) {
        console.log(`Stats Cache: Returning cached data for ${id} (no force refresh)`);
        return NextResponse.json({ success: true, stats: cached, fromCache: true });
      }
    }

    if (background) {
      console.log(`API: Starting background refresh for event ${id}`);
      // Fire and forget - do not await
      scrapeEventStats(event, id).catch(err => {
        console.error(`Background Scraping Error for ${id}:`, err);
      });

      return NextResponse.json({
        success: true,
        message: 'Update started in background',
        background: true
      }, { status: 202 });
    }

    // Foreground execution
    console.log(`API: Starting foreground refresh for event ${id}`);
    const combinedStats = await scrapeEventStats(event, id);

    return NextResponse.json({
      success: true,
      stats: combinedStats,
    });

  } catch (error) {
    console.error('Error fetching event stats:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { id } = await params;

    const { clearCachedUrl } = await import('@/lib/urlCache');

    // Clear all known sources
    const sources = ['ebilet', 'biletyna', 'kupbilecik'];
    for (const source of sources) {
      clearCachedUrl(id, source);
    }

    // Clear all histories and stat caches
    const { clearStatsHistory } = await import('@/lib/statsHistory');
    const { clearFullStats } = await import('@/lib/fullStatsCache');
    await clearHistory(id);
    await clearStatsHistory(id);
    clearFullStats(id);

    console.log(`Cache cleared for event ${id}`);

    return NextResponse.json({ success: true, message: 'Cache cleared' });
  } catch (error) {
    console.error('Error clearing cache:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
