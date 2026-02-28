import type { SourceStats, SectorStats } from '../types';

// KupBilecik data processing
export interface KupBilecikObiektData {
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

export function processKupbilecikData(obiektData: KupBilecikObiektData): SourceStats | null {
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
