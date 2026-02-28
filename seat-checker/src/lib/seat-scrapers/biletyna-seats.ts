import * as cheerio from 'cheerio';
import type { SourceStats, SectorStats } from '../types';
import { matchSectorByStructure } from './utils';

// Biletyna seat parsing - returns sector stats from a single page
export interface BiletynaSectorResult {
    rows: Record<string, { total: number; free: number; taken: number }>;
    freeSeats: string[];
    takenSeats: string[];
    // If parsing directly into SourceStats is not enough for intermediate steps
}

export function parseBiletynaSectorSeats(html: string): BiletynaSectorResult | null {
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

export function parseBiletynaSeats(html: string): SourceStats | null {
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
        sectors: [{
            sectorName: 'Sektor 1',
            rows: result.rows,
            freeSeats: result.freeSeats,
            takenSeats: result.takenSeats,
            totals: {
                total: result.freeSeats.length + result.takenSeats.length,
                free: result.freeSeats.length,
                taken: result.takenSeats.length,
            }
        }]
    };
}

// Combine multiple sector results into one SourceStats
export function combineBiletynaSectors(
    sectorResults: Array<{ sectorUrl: string; data: BiletynaSectorResult }>,
    kupbilecikSectors?: SectorStats[]
): SourceStats | null {
    if (sectorResults.length === 0) return null;

    // If only one sector, return simple result
    if (sectorResults.length === 1) {
        const { data } = sectorResults[0];

        // Match sector name if possible
        let sectorName = 'Sektor 1';
        if (kupbilecikSectors) {
            const rowsMap = new Map(Object.entries(data.rows));
            const matchedSector = matchSectorByStructure(rowsMap, kupbilecikSectors, new Set());
            if (matchedSector) sectorName = matchedSector.sectorName;
        }

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
            sectors: [{
                sectorName,
                rows: data.rows,
                freeSeats: data.freeSeats,
                takenSeats: data.takenSeats,
                totals: {
                    total: data.freeSeats.length + data.takenSeats.length,
                    free: data.freeSeats.length,
                    taken: data.takenSeats.length,
                }
            }]
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
