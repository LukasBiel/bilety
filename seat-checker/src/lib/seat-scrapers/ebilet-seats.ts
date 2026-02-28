import type { SourceStats, SectorStats } from '../types';
import { matchSectorByStructure } from './utils';

// eBilet data processing
export interface EbiletSeatsResponse {
    sid: string; // sector ID
    s: Array<{ id: string; rn: string; n: string }>;
}

export interface EbiletFreeSeatsResponse {
    sfs: Record<string, Array<{ s: string[] }>>; // key is sector ID, value is array of groups with seat IDs
    err: string | null;
}

// Process eBilet data from multiple seats responses and ONE freeseats response
// seatsBySid: Map of sector ID -> seats data
// freeSeatsData: Single response containing sfs with all sectors
export function processEbiletAllSectors(
    seatsBySid: Map<string, EbiletSeatsResponse>,
    freeSeatsData: EbiletFreeSeatsResponse & { sfc?: Record<string, number> },
    kupbilecikSectors?: SectorStats[],
    sectorCapacities?: Record<string, { id: string, n: string, c: number }>
): SourceStats | null {
    if (freeSeatsData.err !== null) {
        console.log('eBilet: freeSeatsData has error:', freeSeatsData.err);
        return null;
    }

    if (seatsBySid.size === 0 && (!sectorCapacities || !freeSeatsData.sfc)) {
        console.log('eBilet: No seats data or capacity data captured');
        return null;
    }

    const sectors: SectorStats[] = [];
    const globalRowsData = new Map<string, { total: number; free: number; taken: number }>();
    const globalFreeSeats: string[] = [];
    const globalTakenSeats: string[] = [];

    // Track which kupbilecik sectors have been matched to prevent duplicates
    const matchedKbSectors = new Set<string>();

    if (seatsBySid.size > 0 && freeSeatsData.sfs) {
        console.log(`eBilet: Processing ${seatsBySid.size} sector(s) with geometry data`);
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
                } else {
                    // Try to grab name from capacities if available
                    if (sectorCapacities?.[sid]?.n) sectorName = sectorCapacities[sid].n;
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
    } else if (sectorCapacities && freeSeatsData.sfc) {
        // Fallback: No geometry data, but we have total capacities and free seat counts!
        console.log(`eBilet: Processing ${Object.keys(sectorCapacities).length} sector(s) using lazy-loaded SFC counts`);
        let totalFree = 0;
        let totalTaken = 0;

        for (const [sid, cap] of Object.entries(sectorCapacities)) {
            const freeCount = freeSeatsData.sfc[sid] || 0;
            const totalCount = cap.c || 0;
            const takenCount = Math.max(0, totalCount - freeCount);

            if (totalCount > 0) {
                sectors.push({
                    sectorName: cap.n || `Sektor ${sid}`,
                    rows: {},
                    freeSeats: [],
                    takenSeats: [],
                    totals: {
                        total: totalCount,
                        free: freeCount,
                        taken: takenCount,
                    },
                });

                totalFree += freeCount;
                totalTaken += takenCount;
                console.log(`eBilet: Sector "${cap.n}" - ${freeCount} free, ${takenCount} taken / total: ${totalCount}`);
            }
        }

        return {
            source: 'ebilet',
            totals: {
                total: totalFree + totalTaken,
                free: totalFree,
                taken: totalTaken,
            },
            rows: {},
            freeSeats: [],
            takenSeats: [],
            sectors: sectors.length > 0 ? sectors : undefined,
        };
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
