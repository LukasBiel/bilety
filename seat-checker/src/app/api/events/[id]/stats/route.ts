import { NextRequest, NextResponse } from 'next/server';
import { chromium } from 'playwright';
import * as cheerio from 'cheerio';
import type { SourceType, SourceStats, SectorStats, CombinedEventStats, JoinedEvent } from '@/lib/types';
import { loadHistory, saveHistory, clearHistory, type SeatHistory } from '@/lib/history';
import { loadStatsHistory, saveStatsHistory, type StatsHistoryEntry } from '@/lib/statsHistory';
import { touchCachedUrl } from '@/lib/urlCache';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// Roman numeral to Arabic conversion (must match frontend normalization!)
const ROMAN_MAP: Record<string, number> = {
  'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5,
  'VI': 6, 'VII': 7, 'VIII': 8, 'IX': 9, 'X': 10,
  'XI': 11, 'XII': 12, 'XIII': 13, 'XIV': 14, 'XV': 15,
  'XVI': 16, 'XVII': 17, 'XVIII': 18, 'XIX': 19, 'XX': 20,
  'XXI': 21, 'XXII': 22, 'XXIII': 23, 'XXIV': 24, 'XXV': 25,
  'XXVI': 26, 'XXVII': 27, 'XXVIII': 28, 'XXIX': 29, 'XXX': 30,
};

function normalizeRowName(row: string): string {
  const trimmed = row.trim().toUpperCase();

  // Check if it's a pure Roman numeral
  if (ROMAN_MAP[trimmed] !== undefined) {
    return String(ROMAN_MAP[trimmed]);
  }

  // Try to extract number from strings like "Rząd 5" or "Row V"
  const match = trimmed.match(/(\d+|[IVXLC]+)$/);
  if (match) {
    const numPart = match[1];
    if (ROMAN_MAP[numPart] !== undefined) {
      return String(ROMAN_MAP[numPart]);
    }
    return numPart; // Already Arabic number
  }

  return trimmed.toLowerCase();
}

function normalizeSeatKey(seatKey: string): string {
  const parts = seatKey.split('-');
  if (parts.length >= 2) {
    const row = normalizeRowName(parts[0]);
    const seat = parts.slice(1).join('-');
    return `${row}-${seat}`;
  }
  return seatKey;
}

// Biletyna seat parsing - returns sector stats from a single page
interface BiletynaSectorResult {
  rows: Record<string, { total: number; free: number; taken: number }>;
  freeSeats: string[];
  takenSeats: string[];
}

function parseBiletynaSectorSeats(html: string): BiletynaSectorResult | null {
  const $ = cheerio.load(html);
  const rowsData = new Map<string, { total: number; free: number; taken: number }>();
  const freeSeats: string[] = [];
  const takenSeats: string[] = [];

  // Biletyna status codes:
  // 10 = FREE (available for purchase)
  // 30 = SOLD (already purchased)
  // 80 = RESERVED (held/blocked)
  // 90 = BLANK (spacer, not a real seat - skip)
  const STATUS_FREE = '10';
  const STATUS_BLANK = '90';

  $('div.place, [data-place_status]').each((_, element) => {
    const $el = $(element);
    const rowNumber = $el.attr('data-row_number');
    const placeNumber = $el.attr('data-place_number');
    const placeStatus = $el.attr('data-place_status');

    // Skip blank spacers (status 90) and elements without proper seat data
    if (!rowNumber || !placeNumber || !placeStatus) return;
    if (placeStatus === STATUS_BLANK) return;

    const seatKey = `${rowNumber}-${placeNumber}`;
    const row = rowNumber;

    if (!rowsData.has(row)) {
      rowsData.set(row, { total: 0, free: 0, taken: 0 });
    }

    const rowStats = rowsData.get(row)!;
    rowStats.total++;

    // Only status 10 is FREE, everything else (30=sold, 80=reserved, etc.) is TAKEN
    if (placeStatus === STATUS_FREE) {
      rowStats.free++;
      freeSeats.push(seatKey);
    } else {
      rowStats.taken++;
      takenSeats.push(seatKey);
    }
  });

  if (rowsData.size === 0) return null;

  const rows: Record<string, { total: number; free: number; taken: number }> = {};
  for (const [row, stats] of rowsData) {
    rows[row] = stats;
  }

  return { rows, freeSeats, takenSeats };
}

function parseBiletynaSeats(html: string): SourceStats | null {
  const result = parseBiletynaSectorSeats(html);
  if (!result) return null;

  return {
    source: 'biletyna',
    totals: {
      total: result.freeSeats.length + result.takenSeats.length,
      free: result.freeSeats.length,
      taken: result.takenSeats.length,
    },
    rows: result.rows,
    freeSeats: result.freeSeats,
    takenSeats: result.takenSeats,
  };
}

// Combine multiple sector results into one SourceStats
function combineBiletynaSectors(
  sectorResults: Array<{ sectorUrl: string; data: BiletynaSectorResult }>,
  kupbilecikSectors?: SectorStats[]
): SourceStats | null {
  if (sectorResults.length === 0) return null;

  // If only one sector, return simple result
  if (sectorResults.length === 1) {
    const { data } = sectorResults[0];
    return {
      source: 'biletyna',
      totals: {
        total: data.freeSeats.length + data.takenSeats.length,
        free: data.freeSeats.length,
        taken: data.takenSeats.length,
      },
      rows: data.rows,
      freeSeats: data.freeSeats,
      takenSeats: data.takenSeats,
    };
  }

  // Multiple sectors
  const sectors: SectorStats[] = [];
  const globalRowsData = new Map<string, { total: number; free: number; taken: number }>();
  const globalFreeSeats: string[] = [];
  const globalTakenSeats: string[] = [];

  // Track which kupbilecik sectors have been matched to prevent duplicates
  const matchedKbSectors = new Set<string>();

  for (let i = 0; i < sectorResults.length; i++) {
    const { sectorUrl, data } = sectorResults[i];

    // Try to match to kupbilecik sector by row structure
    let sectorName = `Sektor ${i + 1}`;
    if (kupbilecikSectors) {
      const rowsMap = new Map(Object.entries(data.rows));
      const matchedSector = matchSectorByStructure(rowsMap, kupbilecikSectors, matchedKbSectors);
      if (matchedSector) {
        sectorName = matchedSector.sectorName;
      }
    }

    // Add to global stats
    for (const [row, stats] of Object.entries(data.rows)) {
      if (!globalRowsData.has(row)) {
        globalRowsData.set(row, { total: 0, free: 0, taken: 0 });
      }
      const globalStats = globalRowsData.get(row)!;
      globalStats.total += stats.total;
      globalStats.free += stats.free;
      globalStats.taken += stats.taken;
    }
    globalFreeSeats.push(...data.freeSeats);
    globalTakenSeats.push(...data.takenSeats);

    sectors.push({
      sectorName,
      rows: data.rows,
      freeSeats: data.freeSeats,
      takenSeats: data.takenSeats,
      totals: {
        total: data.freeSeats.length + data.takenSeats.length,
        free: data.freeSeats.length,
        taken: data.takenSeats.length,
      },
    });
  }

  const globalRows: Record<string, { total: number; free: number; taken: number }> = {};
  for (const [row, stats] of globalRowsData) {
    globalRows[row] = stats;
  }

  return {
    source: 'biletyna',
    totals: {
      total: globalFreeSeats.length + globalTakenSeats.length,
      free: globalFreeSeats.length,
      taken: globalTakenSeats.length,
    },
    rows: globalRows,
    freeSeats: globalFreeSeats,
    takenSeats: globalTakenSeats,
    sectors: sectors.length > 1 ? sectors : undefined,
  };
}

// eBilet data processing
interface EbiletSeatsResponse {
  sid: string; // sector ID
  s: Array<{ id: string; rn: string; n: string }>;
}

interface EbiletFreeSeatsResponse {
  sfs: Record<string, Array<{ s: string[] }>>; // key is sector ID, value is array of groups with seat IDs
  err: string | null;
}

// Process eBilet data from multiple seats responses and ONE freeseats response
// seatsBySid: Map of sector ID -> seats data
// freeSeatsData: Single response containing sfs with all sectors
function processEbiletAllSectors(
  seatsBySid: Map<string, EbiletSeatsResponse>,
  freeSeatsData: EbiletFreeSeatsResponse,
  kupbilecikSectors?: SectorStats[]
): SourceStats | null {
  if (freeSeatsData.err !== null) {
    console.log('eBilet: freeSeatsData has error:', freeSeatsData.err);
    return null;
  }

  if (seatsBySid.size === 0) {
    console.log('eBilet: No seats data captured');
    return null;
  }

  console.log(`eBilet: Processing ${seatsBySid.size} sector(s)`);

  // Process each sector
  const sectors: SectorStats[] = [];
  const globalRowsData = new Map<string, { total: number; free: number; taken: number }>();
  const globalFreeSeats: string[] = [];
  const globalTakenSeats: string[] = [];

  // Track which kupbilecik sectors have been matched to prevent duplicates
  const matchedKbSectors = new Set<string>();

  let sectorIndex = 0;
  for (const [sid, seatsData] of seatsBySid) {
    sectorIndex++;

    // Get free seat IDs for THIS sector from sfs[sid]
    const sectorGroups = freeSeatsData.sfs[sid] || [];
    const freeSeatIds = new Set<string>();
    for (const group of sectorGroups) {
      if (group.s && Array.isArray(group.s)) {
        for (const seatId of group.s) {
          freeSeatIds.add(seatId);
        }
      }
    }

    console.log(`eBilet: Sector ${sid} - ${seatsData.s.length} total seats, ${freeSeatIds.size} free seats in sfs`);

    // Process all seats in this sector
    const sectorRowsData = new Map<string, { total: number; free: number; taken: number }>();
    const sectorFreeSeats: string[] = [];
    const sectorTakenSeats: string[] = [];

    for (const seat of seatsData.s) {
      const seatKey = `${seat.rn}-${seat.n}`;
      const row = seat.rn;

      // Sector stats
      if (!sectorRowsData.has(row)) {
        sectorRowsData.set(row, { total: 0, free: 0, taken: 0 });
      }
      const sectorRowStats = sectorRowsData.get(row)!;
      sectorRowStats.total++;

      // Global stats
      if (!globalRowsData.has(row)) {
        globalRowsData.set(row, { total: 0, free: 0, taken: 0 });
      }
      const globalRowStats = globalRowsData.get(row)!;
      globalRowStats.total++;

      // Status: free if in sfs[sid], taken otherwise
      if (freeSeatIds.has(seat.id)) {
        sectorRowStats.free++;
        sectorFreeSeats.push(seatKey);
        globalRowStats.free++;
        globalFreeSeats.push(seatKey);
      } else {
        sectorRowStats.taken++;
        sectorTakenSeats.push(seatKey);
        globalRowStats.taken++;
        globalTakenSeats.push(seatKey);
      }
    }

    if (sectorRowsData.size > 0) {
      // Try to match this sector to kupbilecik sectors by row structure
      let sectorName = `Sektor ${sectorIndex}`;
      if (kupbilecikSectors) {
        const matchedSector = matchSectorByStructure(sectorRowsData, kupbilecikSectors, matchedKbSectors);
        if (matchedSector) {
          sectorName = matchedSector.sectorName;
          console.log(`eBilet: Sector ${sid} matched to kupbilecik sector "${sectorName}"`);
        }
      }

      const sectorRows: Record<string, { total: number; free: number; taken: number }> = {};
      for (const [row, stats] of sectorRowsData) {
        sectorRows[row] = stats;
      }

      sectors.push({
        sectorName,
        rows: sectorRows,
        freeSeats: sectorFreeSeats,
        takenSeats: sectorTakenSeats,
        totals: {
          total: sectorFreeSeats.length + sectorTakenSeats.length,
          free: sectorFreeSeats.length,
          taken: sectorTakenSeats.length,
        },
      });

      console.log(`eBilet: Sector "${sectorName}" - ${sectorFreeSeats.length} free, ${sectorTakenSeats.length} taken`);
    }
  }

  if (globalRowsData.size === 0) return null;

  const rows: Record<string, { total: number; free: number; taken: number }> = {};
  for (const [row, stats] of globalRowsData) {
    rows[row] = stats;
  }

  // Sort seat lists
  globalFreeSeats.sort();
  globalTakenSeats.sort();

  console.log(`eBilet: Total - ${globalFreeSeats.length} free, ${globalTakenSeats.length} taken`);

  return {
    source: 'ebilet',
    totals: {
      total: globalFreeSeats.length + globalTakenSeats.length,
      free: globalFreeSeats.length,
      taken: globalTakenSeats.length,
    },
    rows,
    freeSeats: globalFreeSeats,
    takenSeats: globalTakenSeats,
    sectors: sectors.length > 1 ? sectors : undefined,
  };
}

// Match ebilet sector to kupbilecik sector by row structure similarity
// matchedSectors: Set of sector names already matched (to prevent duplicates)
function matchSectorByStructure(
  ebiletRows: Map<string, { total: number; free: number; taken: number }>,
  kupbilecikSectors: SectorStats[],
  matchedSectors?: Set<string>
): SectorStats | null {
  let bestMatch: SectorStats | null = null;
  let bestScore = 0;

  const ebiletRowNames = Array.from(ebiletRows.keys());
  const ebiletRowCount = ebiletRowNames.length;
  const ebiletTotalSeats = Array.from(ebiletRows.values()).reduce((sum, r) => sum + r.total, 0);

  // Normalize eBilet row names for comparison
  const normalizedEbiletRows = new Set(ebiletRowNames.map(normalizeRowName));

  for (const sector of kupbilecikSectors) {
    // Skip already-matched sectors
    if (matchedSectors?.has(sector.sectorName)) {
      continue;
    }

    const kbRowNames = Object.keys(sector.rows);
    const kbRowCount = kbRowNames.length;
    const kbTotalSeats = sector.totals.total;

    // Stricter check: if row counts differ by more than 30%, skip this sector entirely
    const rowCountDiff = Math.abs(ebiletRowCount - kbRowCount) / Math.max(ebiletRowCount, kbRowCount, 1);
    if (rowCountDiff > 0.3) {
      continue;
    }

    // Score based on:
    // 1. Row count similarity (0-30 points) - EXACT match gets 30
    // 2. Total seat count similarity (0-30 points) - EXACT match gets 30
    // 3. Row NAME matching (0-40 points) - NEW!
    let score = 0;

    // Row count similarity (exact match = 30pts, else scaled)
    if (ebiletRowCount === kbRowCount) {
      score += 30;
    } else {
      score += Math.max(0, 30 - rowCountDiff * 100); // Stronger penalty for row mismatch
    }

    // Seat count similarity (EXACT match = 30pts, Decay immediately if diff)
    const seatDiffPercent = Math.abs(ebiletTotalSeats - kbTotalSeats) / Math.max(ebiletTotalSeats, kbTotalSeats, 1);
    if (ebiletTotalSeats === kbTotalSeats) {
      score += 30;
    } else {
      // Linear decay: 10% diff -> loses 15 points (half). 20% diff -> loses all.
      score += Math.max(0, 30 - (seatDiffPercent * 150));
    }

    // Row NAME matching - compare normalized row names
    const normalizedKbRows = new Set(kbRowNames.map(normalizeRowName));
    let matchingRowNames = 0;
    for (const normalizedRow of normalizedEbiletRows) {
      if (normalizedKbRows.has(normalizedRow)) {
        matchingRowNames++;
      }
    }
    const rowNameMatchRatio = matchingRowNames / Math.max(ebiletRowCount, 1);
    score += rowNameMatchRatio * 40;

    console.log(`Sector matching: eBilet(${ebiletRowCount} rows, ${ebiletTotalSeats} seats) vs ${sector.sectorName}(${kbRowCount} rows, ${kbTotalSeats} seats) - score=${score.toFixed(1)}, rowNameMatch=${matchingRowNames}/${ebiletRowCount}`);

    if (score > bestScore) {
      bestScore = score;
      bestMatch = sector;
    }
  }

  // Only return match if score is reasonably high (raised threshold)
  if (bestScore >= 50 && bestMatch) {
    // Mark this sector as matched
    if (matchedSectors) {
      matchedSectors.add(bestMatch.sectorName);
    }
    console.log(`Sector match result: score=${bestScore.toFixed(1)}, matched="${bestMatch.sectorName}"`);
    return bestMatch;
  }

  console.log(`Sector match result: score=${bestScore.toFixed(1)}, no match (threshold=50)`);
  return null;
}

// KupBilecik data processing
interface KupBilecikObiektData {
  id: number;
  czesci: Array<{
    id: number;
    nazwa?: string;
    rzedy: Array<{
      miejsca: Array<{
        nazwa: string;
        id: number;
        free: boolean;
      }>;
      nazwa?: string;
    }>;
  }>;
}

function processKupbilecikData(obiektData: KupBilecikObiektData): SourceStats | null {
  const sectors: SectorStats[] = [];
  const globalRowsData = new Map<string, { total: number; free: number; taken: number }>();
  const globalFreeSeats: string[] = [];
  const globalTakenSeats: string[] = [];

  let globalRowIndex = 0;

  for (const czesc of obiektData.czesci) {
    // Skip SCENA or parts without seats
    const sectorName = czesc.nazwa || '';
    if (sectorName.toUpperCase() === 'SCENA' || !czesc.rzedy?.length) continue;

    // Check if this sector has any seats
    const totalSeatsInSector = czesc.rzedy.reduce((sum, r) => sum + (r.miejsca?.length || 0), 0);
    if (totalSeatsInSector === 0) continue;

    const sectorRowsData = new Map<string, { total: number; free: number; taken: number }>();
    const sectorFreeSeats: string[] = [];
    const sectorTakenSeats: string[] = [];

    for (const rzad of czesc.rzedy) {
      globalRowIndex++;
      const rowName = rzad.nazwa || String(globalRowIndex);

      for (const miejsce of rzad.miejsca) {
        // Skip seats with empty names - they don't actually exist
        if (!miejsce.nazwa || miejsce.nazwa.trim() === '' || miejsce.nazwa === 'null' || miejsce.nazwa === 'undefined') continue;

        const seatName = miejsce.nazwa;
        const seatKey = `${rowName}-${seatName}`;

        // Sector-level stats
        if (!sectorRowsData.has(rowName)) {
          sectorRowsData.set(rowName, { total: 0, free: 0, taken: 0 });
        }
        const sectorRowStats = sectorRowsData.get(rowName)!;
        sectorRowStats.total++;

        // Global stats
        if (!globalRowsData.has(rowName)) {
          globalRowsData.set(rowName, { total: 0, free: 0, taken: 0 });
        }
        const globalRowStats = globalRowsData.get(rowName)!;
        globalRowStats.total++;

        if (miejsce.free) {
          sectorRowStats.free++;
          sectorFreeSeats.push(seatKey);
          globalRowStats.free++;
          globalFreeSeats.push(seatKey);
        } else {
          sectorRowStats.taken++;
          sectorTakenSeats.push(seatKey);
          globalRowStats.taken++;
          globalTakenSeats.push(seatKey);
        }
      }
    }

    if (sectorRowsData.size > 0) {
      const sectorRows: Record<string, { total: number; free: number; taken: number }> = {};
      for (const [row, stats] of sectorRowsData) {
        sectorRows[row] = stats;
      }

      sectors.push({
        sectorName: sectorName,
        rows: sectorRows,
        freeSeats: sectorFreeSeats,
        takenSeats: sectorTakenSeats,
        totals: {
          total: sectorFreeSeats.length + sectorTakenSeats.length,
          free: sectorFreeSeats.length,
          taken: sectorTakenSeats.length,
        },
      });
    }
  }

  if (globalRowsData.size === 0) return null;

  const rows: Record<string, { total: number; free: number; taken: number }> = {};
  for (const [row, stats] of globalRowsData) {
    rows[row] = stats;
  }

  return {
    source: 'kupbilecik',
    totals: {
      total: globalFreeSeats.length + globalTakenSeats.length,
      free: globalFreeSeats.length,
      taken: globalTakenSeats.length,
    },
    rows,
    freeSeats: globalFreeSeats,
    takenSeats: globalTakenSeats,
    // Only include sectors if there's more than one
    sectors: sectors.length > 0 ? sectors : undefined,
  };
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  try {
    const body = await request.json();
    const event: JoinedEvent = body.event;

    if (!event) {
      return NextResponse.json({ error: 'Event data is required' }, { status: 400 });
    }

    const results: Partial<Record<SourceType, SourceStats>> = {};
    const browser = await chromium.launch({ headless: true });

    try {
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      });

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

      // Process each source in parallel
      const sourcePromises: Promise<void>[] = [];

      // RAW DATA STORAGE (to avoid race conditions during matching)
      let ebiletRawData: {
        seatsBySid: Map<string, EbiletSeatsResponse>;
        freeSeatsData: EbiletFreeSeatsResponse;
        currentUrl: string;
      } | null = null;

      let biletynaRawData: {
        sectorResults: Array<{ sectorUrl: string; data: BiletynaSectorResult }>;
        finalUrl: string;
      } | null = null;

      // Biletyna - with multi-sector support
      if (event.sources.biletyna) {
        sourcePromises.push((async () => {
          const page = await context.newPage();
          try {
            let cacheHit = false;

            // 1. Try Cached URL First
            if (cachedBiletynaUrl) {
              console.log(`Biletyna: SmartCache hit, trying ${cachedBiletynaUrl}...`);
              try {
                await page.goto(cachedBiletynaUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

                // Validate if it's a map page
                try {
                  await page.waitForSelector('[data-place_status]', { timeout: 5000 });
                  const html = await page.content();
                  const stats = parseBiletynaSeats(html);
                  if (stats && stats.totals.total > 0) {
                    console.log('Biletyna: SmartCache validation success!');
                    stats.finalUrl = cachedBiletynaUrl;
                    results.biletyna = stats;
                    cacheHit = true;
                  } else {
                    console.log('Biletyna: SmartCache validation failed (no stats), clearing cache');
                    clearCachedUrl(event.globalEventId, 'biletyna');
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
            await page.waitForTimeout(2000);

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
                  await page.waitForTimeout(2000);

                  // Wait for seat map
                  try {
                    await page.waitForSelector('[data-place_status]', { timeout: 8000 });
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
                  await page.waitForTimeout(3000);
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

              await page.waitForTimeout(2000);
              const finalUrl = page.url();
              const html = await page.content();
              const stats = parseBiletynaSeats(html);
              if (stats) {
                stats.finalUrl = finalUrl;
                results.biletyna = stats;

                // Save to cache for next time
                if (finalUrl.includes('biletyna.pl')) {
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
          const page = await context.newPage();
          // Capture seats by sector ID (sid) - each seats.json is for one sector
          const seatsBySid = new Map<string, EbiletSeatsResponse>();
          // Capture ALL freeseats responses and combine - each may contain different sectors
          const combinedSfs: Record<string, Array<{ s: string[] }>> = {};
          // Capture tour arrangements to find specific event IDs
          let tourArrangements: { events?: Array<{ id: string; venue?: string; city?: string; date?: string }> } | null = null;
          // Capture checkFreeSeats response - contains direct shop URL
          let checkFreeSeatsUrl: string | null = null;

          // Intercept responses
          page.on('response', async (response) => {
            const url = response.url();
            try {
              // Log interesting URLs for debugging
              if (url.includes('ebilet') || url.includes('seats') || url.includes('sector')) {
                const contentType = response.headers()['content-type'] || '';
                if (contentType.includes('json')) {
                  console.log(`eBilet: JSON response from: ${url.substring(0, 100)}`);
                }
              }

              if (url.includes('/storage/seats/') && url.includes('.json')) {
                console.log(`eBilet: Network response for SEATS: ${response.status()} ${url}`);
                if (response.status() !== 200) {
                  console.log(`eBilet: [WARNING] Non-200 status for seats: ${response.status()}`);
                }
                const data = await response.json();
                // Must have sid (sector ID) and s (seats array)
                if (data?.sid && data?.s && Array.isArray(data.s)) {
                  seatsBySid.set(data.sid, data);
                  console.log(`eBilet: Captured seats for sector sid=${data.sid} with ${data.s.length} seats`);
                } else {
                  console.log(`eBilet: [WARNING] Invalid seat data structure: ${JSON.stringify(data).substring(0, 100)}...`);
                }
              }
              // Capture arrangements.json for tour pages - contains event list
              if (url.includes('/storage/arrangements/') && url.includes('.json')) {
                const data = await response.json();
                if (data) {
                  tourArrangements = data;
                  console.log(`eBilet: Captured tour arrangements with ${JSON.stringify(data).substring(0, 200)}`);
                }
              }
              if (url.includes('/api/event/getsectorfreeseats') || url.includes('getsectorfreeseats')) {
                const data = await response.json();
                if (data && 'sfs' in data && data.err === null) {
                  // Combine all sfs from all responses
                  for (const sid of Object.keys(data.sfs)) {
                    if (!combinedSfs[sid]) {
                      combinedSfs[sid] = [];
                    }
                    // Add groups from this response
                    const groups = data.sfs[sid] || [];
                    combinedSfs[sid].push(...groups);
                    const freeCount = groups.reduce((sum: number, g: { s: string[] }) => sum + (g.s?.length || 0), 0);
                    console.log(`eBilet: Captured freeseats for sid=${sid} with ${freeCount} free seats`);
                  }
                }
              }
              // Capture checkFreeSeats - response contains decryptedEventId for shop URL
              if (url.includes('/api/Title/checkFreeSeats')) {
                try {
                  const data = await response.json();
                  console.log(`eBilet: checkFreeSeats response: ${JSON.stringify(data).substring(0, 300)}`);
                  // Response is an array, get first item with decryptedEventId
                  const item = Array.isArray(data) ? data[0] : data;
                  if (item?.decryptedEventId) {
                    checkFreeSeatsUrl = `https://sklep.ebilet.pl/${item.decryptedEventId}`;
                    console.log(`eBilet: Captured shop URL from decryptedEventId: ${checkFreeSeatsUrl}`);
                  }
                } catch {
                  // Response might not be JSON
                }
              }
            } catch {
              // Ignore parse errors
            }
          });

          try {
            let currentUrl = '';
            let skipStandard = false;

            // 1. Try Cached URL First
            if (cachedEbiletUrl) {
              console.log(`eBilet: SmartCache hit, trying ${cachedEbiletUrl}...`);
              try {
                await page.goto(cachedEbiletUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                // Allow some time for interceptors to fire (sfs, seats.json)
                await page.waitForTimeout(5000);

                if (seatsBySid.size > 0) {
                  console.log(`eBilet: SmartCache success! Captured ${seatsBySid.size} sectors.`);
                  skipStandard = true;
                  currentUrl = page.url();
                } else {
                  console.log('eBilet: SmartCache navigation finished but no seats captured. Clearing cache.');
                  clearCachedUrl(event.globalEventId, 'ebilet');
                }
              } catch (e) {
                console.log('eBilet: SmartCache navigation failed:', e);
              }
            }

            if (!skipStandard) {
              // Build URL with city filter parameter (simplifies tour page navigation)
              let targetUrl = event.sources.ebilet!.eventCardUrl;
              // Use cityOriginal (with Polish chars) for eBilet URL, fallback to normalized city
              const eventCityForUrl = event.cityOriginal || event.city || '';
              const eventCity = event.city?.toLowerCase() || '';
              const eventDate = event.date;

              if (eventCityForUrl) {
                // Append ?city=cityname to filter tour page to specific city
                const separator = targetUrl.includes('?') ? '&' : '?';
                targetUrl = `${targetUrl}${separator}city=${encodeURIComponent(eventCityForUrl)}`;
              }

              console.log(`eBilet: Loading event page: ${targetUrl}`);
              await page.goto(targetUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 30000,
              });

              await page.waitForTimeout(3000);

              // Dismiss cookie dialog
              const cookieBtn = page.locator('#CybotCookiebotDialogBodyButtonDecline').first();
              if (await cookieBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
                await cookieBtn.click({ force: true });
                await page.waitForTimeout(1000);
              }

              // Force remove cookie overlay
              await page.evaluate(() => {
                const overlay = document.getElementById('CybotCookiebotDialog');
                if (overlay) overlay.remove();
                const underlay = document.getElementById('CybotCookiebotDialogBodyUnderlay');
                if (underlay) underlay.remove();
              });

              console.log(`eBilet: Event city: "${eventCity}", date: "${eventDate}"`);

              const allBuyButtons = page.locator('button:has-text("Kup bilety"), button:has-text("Kup terminy"), a:has-text("Kup bilety")');
              const buttonCount = await allBuyButtons.count().catch(() => 0);
              console.log(`eBilet: Found ${buttonCount} buy buttons on page`);

              currentUrl = page.url();

              // SIMPLIFIED: With ?city= parameter, page is already filtered
              // Just click the first "Kup bilety" button
              if (buttonCount > 0) {
                console.log(`eBilet: Clicking first buy button (page filtered by ?city=${eventCity})...`);

                try {
                  // Click the first visible buy button
                  await allBuyButtons.first().click({ timeout: 5000 });
                  await page.waitForTimeout(3000);

                  // Check for modal or new content
                  // Promotion buttons often behave differently - wait a bit longer and check all links
                  console.log('eBilet: Waiting for content after click...');
                  await page.waitForTimeout(5000);

                  // DEBUG: Log generic modal structures to find the right selector
                  try {
                    const modalDebug = await page.evaluate(() => {
                      const dialogs = document.querySelectorAll('mat-dialog-container, .modal, .dialog, [role="dialog"], [class*="modal"], [class*="popup"], .cdk-overlay-container');
                      return Array.from(dialogs).map(d => ({
                        tag: d.tagName,
                        class: d.className,
                        htmlSnippet: d.outerHTML.substring(0, 300)
                      }));
                    });
                    console.log(`eBilet: Found ${modalDebug.length} potential dialog elements:`, JSON.stringify(modalDebug));
                  } catch (e) {
                    console.log('eBilet: Error running modal debug:', e);
                  }

                  // Check for iframes
                  const iframes = page.frames();
                  console.log(`eBilet: Page has ${iframes.length} frames`);
                  for (const frame of iframes) {
                    const frameUrl = frame.url();
                    if (frameUrl !== page.url()) {
                      console.log(`eBilet: Frame URL: ${frameUrl}`);
                    }
                  }

                  const allShopLinks = page.locator('a[href*="sklep.ebilet.pl"], a[href*="biletyna.pl"], a[href*="kupbilecik.pl"]');
                  const shopLinkCount = await allShopLinks.count().catch(() => 0);
                  console.log(`eBilet: Found ${shopLinkCount} shop links after click`);

                  // Find best shop link - exclude PDF, storage, and root URL
                  let bestHref: string | null = null;

                  // If no standard shop links found, check for ANY new visible links in modals
                  if (shopLinkCount === 0) {
                    console.log('eBilet: No standard shop links found. Checking for promotion links...');
                    // Look for links that might have appeared in a modal/dialog
                    const modalLinks = page.locator('mat-dialog-container a, .modal a, .dialog a');
                    const modalLinkCount = await modalLinks.count().catch(() => 0);

                    if (modalLinkCount > 0) {
                      console.log(`eBilet: Found ${modalLinkCount} links in modal`);
                      for (let i = 0; i < modalLinkCount; i++) {
                        const href = await modalLinks.nth(i).getAttribute('href').catch(() => '') || '';
                        console.log(`eBilet: Modal link: ${href}`);
                        // Use this if it looks promising (internal or shop)
                        if (href.includes('ebilet.pl') && !href.endsWith('.pdf')) {
                          bestHref = href;
                          break;
                        }
                      }
                    }
                  } else {
                    // Standard matching logic
                    for (let i = 0; i < shopLinkCount; i++) {
                      const href = await allShopLinks.nth(i).getAttribute('href').catch(() => '') || '';
                      if (href === 'https://sklep.ebilet.pl' || href === 'https://sklep.ebilet.pl/') continue;
                      if (href.endsWith('.pdf') || href.includes('/storage/')) continue;
                      const path = href.replace('https://sklep.ebilet.pl', '');
                      if (path.length > 5) {
                        bestHref = href;
                        break;
                      }
                    }

                    // If still no bestHref, try the drawer specifically (sometimes locator count misses it if animation is slow)
                    if (!bestHref) {
                      const drawerLinks = page.locator('eb-custom-drawer a');
                      const drawerCount = await drawerLinks.count().catch(() => 0);
                      if (drawerCount > 0) {
                        for (let i = 0; i < drawerCount; i++) {
                          const href = await drawerLinks.nth(i).getAttribute('href').catch(() => '') || '';
                          if ((href.includes('ebilet.pl') || href.startsWith('/')) && !href.endsWith('.pdf')) {
                            bestHref = href;
                            if (bestHref.startsWith('/')) bestHref = 'https://www.ebilet.pl' + bestHref;
                            console.log(`eBilet: Found fallback link in custom drawer: ${bestHref}`);
                            break;
                          }
                        }
                      }
                    }
                  }

                  // Use captured checkFreeSeats URL as fallback if no DOM links found
                  if (!bestHref && checkFreeSeatsUrl) {
                    console.log(`eBilet: Using checkFreeSeats fallback URL: ${checkFreeSeatsUrl}`);
                    bestHref = checkFreeSeatsUrl;
                  }

                  if (bestHref) {
                    console.log(`eBilet: Navigating to shop: ${bestHref}`);
                    await page.goto(bestHref, { timeout: 30000 });
                    await page.waitForTimeout(8000);
                    console.log(`eBilet: ✓ Navigation successful`);
                  } else if (!page.url().includes('sklep.ebilet.pl')) {
                    console.log(`eBilet: No shop link found after click`);
                  }
                } catch (e) {
                  const error = e as Error;
                  console.log(`eBilet: Click failed: ${error.message}`);
                }
              } else {
                console.log(`eBilet: No buy buttons found on page!`);
              }

              // Now check final URL
              currentUrl = page.url();
              console.log(`eBilet: Final URL: ${currentUrl}`);
              if (currentUrl.includes('sklep.ebilet.pl')) {
                await page.waitForTimeout(5000);

                // Check if we have seats data - if not, we might be on a multi-date "tour" page
                if (seatsBySid.size === 0) {
                  console.log('eBilet: No seats loaded on sklep.ebilet.pl, checking for tour page...');
                  const eventCity = event.city?.toLowerCase() || '';
                  const eventDate = event.date; // Format: YYYY-MM-DD

                  // Check if we captured tour arrangements data
                  if (tourArrangements) {
                    console.log(`eBilet: Tour arrangements captured, looking for event...`);
                    // Try to log the structure to understand what we have
                    const arrangementsStr = JSON.stringify(tourArrangements);
                    console.log(`eBilet: Arrangements structure (first 500 chars): ${arrangementsStr.substring(0, 500)}`);

                    // The arrangements might have different structures - try to find event list
                    // Common patterns: es (events array), events, items
                    const possibleEventLists = [
                      (tourArrangements as any).events,
                      (tourArrangements as any).es,
                      (tourArrangements as any).items,
                      (tourArrangements as any).performances,
                    ].filter(Boolean);

                    if (possibleEventLists.length > 0) {
                      const eventList = possibleEventLists[0];
                      console.log(`eBilet: Found event list with ${Array.isArray(eventList) ? eventList.length : 0} items`);

                      // Try to find the matching event by city or date
                      if (Array.isArray(eventList)) {
                        for (const evt of eventList) {
                          const evtStr = JSON.stringify(evt);
                          console.log(`eBilet: Event: ${evtStr.substring(0, 150)}`);

                          // Check if this event matches our city/date
                          if (evtStr.toLowerCase().includes(eventCity) || evtStr.includes(eventDate)) {
                            const evtId = evt.id || evt.eid || evt.eventId;
                            if (evtId) {
                              console.log(`eBilet: Found matching event with ID: ${evtId}`);
                              // Navigate directly to this event
                              await page.goto(`https://sklep.ebilet.pl/${evtId}`, {
                                waitUntil: 'domcontentloaded',
                                timeout: 30000,
                              });
                              await page.waitForTimeout(8000);
                              break;
                            }
                          }
                        }
                      }
                    }
                  }

                  // If still no seats, try UI-based approach
                  if (seatsBySid.size === 0) {
                    console.log('eBilet: Trying UI-based tour navigation...');

                    // Log the page content structure for debugging
                    const pageText = await page.textContent('body').catch(() => '');
                    console.log(`eBilet: Page contains city "${eventCity}": ${pageText?.toLowerCase().includes(eventCity)}`);

                    // Try to find clickable elements on the tour page
                    // Look for Angular components, buttons, links with event-related content
                    const tourSelectors = [
                      // Look for any text containing the city name
                      `text=${eventCity}`,
                      // Angular component selectors
                      `eb-event-list-item:has-text("${eventCity}")`,
                      `[class*="list-item"]:has-text("${eventCity}")`,
                      // Generic selectors
                      `div:has-text("${eventCity}")`,
                      `a:has-text("${eventCity}")`,
                      `button:has-text("${eventCity}")`,
                      // Look for formatted date
                      `div:has-text("${eventDate.split('-').reverse().join('.')}")`,
                      `a:has-text("${eventDate.split('-').reverse().join('.')}")`,
                    ];

                    for (const selector of tourSelectors) {
                      if (seatsBySid.size > 0) break;
                      try {
                        const elements = page.locator(selector);
                        const count = await elements.count().catch(() => 0);
                        if (count > 0) {
                          console.log(`eBilet: Tour page - found ${count} elements for "${selector}"`);
                          // Click on the first visible element
                          for (let i = 0; i < Math.min(count, 3); i++) {
                            const el = elements.nth(i);
                            if (await el.isVisible({ timeout: 500 }).catch(() => false)) {
                              const elText = await el.textContent().catch(() => '');
                              console.log(`eBilet: Clicking tour item: ${elText?.substring(0, 60)}`);
                              await el.click({ force: true }).catch(() => null);
                              await page.waitForTimeout(5000);

                              // Check if seats loaded
                              if (seatsBySid.size > 0) {
                                console.log(`eBilet: Seats loaded after clicking tour item!`);
                                break;
                              }
                            }
                          }
                        }
                      } catch {
                        // Continue to next selector
                      }
                    }
                  }

                  // Debug: log page structure if still no seats
                  if (seatsBySid.size === 0) {
                    console.log('eBilet: Still no seats, logging page structure...');
                    const allLinks = page.locator('a').filter({ hasText: /.+/ });
                    const linkCount = await allLinks.count().catch(() => 0);
                    console.log(`eBilet: Found ${linkCount} links on tour page`);

                    // Log first few links for debugging
                    for (let i = 0; i < Math.min(linkCount, 5); i++) {
                      const link = allLinks.nth(i);
                      const text = await link.textContent().catch(() => '');
                      const href = await link.getAttribute('href').catch(() => '');
                      console.log(`eBilet: Link ${i + 1}: "${text?.substring(0, 40)}" -> ${href?.substring(0, 50)}`);
                    }
                  }
                }
              } else {
                console.log('eBilet: Warning - not on sklep.ebilet.pl, seat data may not load');
                await page.waitForTimeout(3000);
              }

            }
            // Process captured data
            const sfsCount = Object.keys(combinedSfs).length;
            console.log(`eBilet: Captured ${seatsBySid.size} seats responses, ${sfsCount} sectors in freeseats`);
            // STORE RAW DATA FOR POST-PROCESSING (Fix Race Condition with KupBilecik)
            if (seatsBySid.size > 0 && sfsCount > 0) {
              // We attach this to the results object temporarily or a new variable scope?
              // Since `results` is typed as SourceStats, we can't put raw data there.
              // We will define a variable `ebiletRawData` in the outer scope.
              ebiletRawData = {
                seatsBySid,
                freeSeatsData: { sfs: combinedSfs, err: null },
                currentUrl
              };
            }
          } finally {
            await page.close();
          }
        })());
      }

      // KupBilecik
      if (event.sources.kupbilecik) {
        sourcePromises.push((async () => {
          const page = await context.newPage();
          let obiektData: KupBilecikObiektData | null = null;

          // Intercept responses
          page.on('response', async (response) => {
            const url = response.url();
            try {
              if (url.includes('ajax_krok_1')) {
                const text = await response.text();
                const match = text.match(/var\s+obiekt_data\s*=\s*(\{[\s\S]*?\});/);
                if (match?.[1]) {
                  obiektData = JSON.parse(match[1]);
                }
              }
            } catch {
              // Ignore parse errors
            }
          });

          try {
            let navigationSuccess = false;

            if (cachedKupbilecikUrl) {
              console.log(`KupBilecik: SmartCache hit, trying ${cachedKupbilecikUrl}...`);
              try {
                await page.goto(cachedKupbilecikUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                navigationSuccess = true;
              } catch (e) {
                console.log('KupBilecik: SmartCache navigation failed:', e);
              }
            }

            if (!navigationSuccess) {
              await page.goto(event.sources.kupbilecik!.eventCardUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 30000,
              });

              // Try to click "Kup bilet" button
              try {
                const buyButton = await page.$(event.sources.kupbilecik!.buyButtonSelector);
                if (buyButton) {
                  await buyButton.click();
                  await page.waitForTimeout(3000);
                }
              } catch {
                // Continue anyway
              }
            }

            // Wait for data to load
            await page.waitForTimeout(5000);

            // Try to get from window scope if not intercepted
            if (!obiektData) {
              try {
                const windowData = await page.evaluate(() => {
                  // @ts-ignore
                  return window.obiekt_data || null;
                });
                if (windowData) obiektData = windowData as KupBilecikObiektData;
              } catch {
                // Ignore
              }
            }

            if (obiektData) {
              const stats = processKupbilecikData(obiektData);
              if (stats) {
                stats.finalUrl = page.url();
                results.kupbilecik = stats;

                // Save to cache for next time
                if (stats.finalUrl && stats.finalUrl.includes('kupbilecik.pl')) {
                  console.log(`KupBilecik: Saving SmartCache URL: ${stats.finalUrl}`);
                  setCachedUrl(event.globalEventId, 'kupbilecik', stats.finalUrl);
                }
              }
            }
          } finally {
            await page.close();
          }
        })());
      }

      await Promise.all(sourcePromises);

      // --- POST-PROCESSING & MATCHING ---
      // Now that all sources (especially KupBilecik) are finished, we can safely match sectors.
      const kupbilecikSectors = results.kupbilecik?.sectors;

      // 1. Process Biletyna (if data captured)
      if (biletynaRawData) {
        const stats = combineBiletynaSectors(biletynaRawData.sectorResults, kupbilecikSectors);
        if (stats) {
          stats.finalUrl = biletynaRawData.finalUrl;
          results.biletyna = stats;

          // Save to cache for next time
          if (stats.finalUrl.includes('biletyna.pl')) {
            console.log(`Biletyna: Saving SmartCache URL: ${stats.finalUrl}`);
            setCachedUrl(event.globalEventId, 'biletyna', stats.finalUrl);
          }
        }
      }

      // 2. Process eBilet (if data captured)
      if (ebiletRawData) {
        const stats = processEbiletAllSectors(
          ebiletRawData.seatsBySid,
          ebiletRawData.freeSeatsData,
          kupbilecikSectors
        );
        if (stats) {
          stats.finalUrl = ebiletRawData.currentUrl;
          results.ebilet = stats;

          // Save to cache for next time
          if (stats.finalUrl && stats.finalUrl.includes('sklep.ebilet.pl')) {
            console.log(`eBilet: Saving SmartCache URL: ${stats.finalUrl}`);
            setCachedUrl(event.globalEventId, 'ebilet', stats.finalUrl);
          }
        }
      }

    } finally {
      await browser.close();
    }

    // Calculate combined totals
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

    // --- HISTORY MODE IMPLEMENTATION ---
    const history = await loadHistory(event.globalEventId);
    const currentFreeKeys = new Set<string>(); // Format: "SectorName:Row-Seat"
    const knownSectors = new Set<string>(); // Sectors successfully scraped

    // 1. Update history with currently FREE seats
    for (const [sourceName, sourceData] of Object.entries(results)) {
      if (!sourceData || !sourceData.sectors) continue;

      const source = sourceName as SourceType;

      for (const sector of sourceData.sectors) {
        knownSectors.add(sector.sectorName);
        for (const seatKey of sector.freeSeats) {
          // Normalize seat key to match frontend (Roman numerals → Arabic)
          const normalizedSeatKey = normalizeSeatKey(seatKey);
          const uniqueKey = `${sector.sectorName}:${normalizedSeatKey}`;
          currentFreeKeys.add(uniqueKey);

          // Mark as currently free on this source
          history[uniqueKey] = source;
        }

        // Implicitly update cache timestamp for this source (User viewed it)
        touchCachedUrl(event.globalEventId, source);
      }
    }

    // 2. Infer SOLD seats (Was free before, now gone, and we have data for that sector)
    const inferredSold: Record<string, SourceType> = {};

    for (const [uniqueKey, lastSource] of Object.entries(history)) {
      // Parse key to get sector name
      const [sectorName] = uniqueKey.split(':');

      // Safety: Only infer sold if we successfully scraped this sector in this run
      // (If scraper failed for a sector, we don't want to mark everything as sold)
      if (knownSectors.has(sectorName)) {
        if (!currentFreeKeys.has(uniqueKey)) {
          // It was free, now it's not -> SOLD by lastSource
          inferredSold[uniqueKey] = lastSource;
        }
      }
    }

    // 3. Save updated history (Seat level)
    await saveHistory(event.globalEventId, history);

    // 4. Calculate Diff from previous run (Stats level)
    const currentStatsEntry: StatsHistoryEntry = {
      biletynaTaken: results.biletyna?.totals.taken || 0,
      ebiletTaken: results.ebilet?.totals.taken || 0,
      kupbilecikTaken: results.kupbilecik?.totals.taken || 0,
      timestamp: new Date().toISOString()
    };

    const prevStats = await loadStatsHistory(event.globalEventId);
    let diffObj = undefined;

    if (prevStats) {
      // Check if there is any difference
      const bDiff = currentStatsEntry.biletynaTaken - prevStats.biletynaTaken;
      const eDiff = currentStatsEntry.ebiletTaken - prevStats.ebiletTaken;
      const kDiff = currentStatsEntry.kupbilecikTaken - prevStats.kupbilecikTaken;

      diffObj = {
        biletynaTaken: Math.max(0, bDiff),
        ebiletTaken: Math.max(0, eDiff),
        kupbilecikTaken: Math.max(0, kDiff),
        lastUpdated: prevStats.timestamp
      };
    }

    // Save CURRENT stats as history for NEXT time
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

    // Clear history
    await clearHistory(id);

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
