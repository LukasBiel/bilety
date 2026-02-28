import { loadFullStats } from '../src/lib/fullStatsCache';
import { loadHistory } from '../src/lib/history';
import { loadStatsHistory, type StatsHistoryEntry } from '../src/lib/statsHistory';
import type { CombinedEventStats, SourceType } from '../src/lib/types';
import { normalizeSeatKey } from '../src/lib/seat-scrapers/utils';

// Helper to artificially remove a seat from a specific source (Simulate SALE)
function simulateSale(stats: CombinedEventStats, source: SourceType, seatKeyToSell: string) {
    const sData = stats.perSource[source];
    if (!sData || !sData.sectors) return false;

    for (const sector of sData.sectors) {
        const index = sector.freeSeats.findIndex(s => s === seatKeyToSell || normalizeSeatKey(s) === normalizeSeatKey(seatKeyToSell));
        if (index !== -1) {
            // Remove from free, add to taken
            sector.freeSeats.splice(index, 1);
            sector.takenSeats.push(seatKeyToSell);

            // Adjust totals
            sData.totals.free--;
            sData.totals.taken++;
            sector.totals.free--;
            sector.totals.taken++;
            console.log(`[SIM] Symulacja sprzedaży: Usunięto miejsce ${sector.sectorName}:${seatKeyToSell} z wolnych na platformie ${source}`);
            return true;
        }
    }
    return false;
}

// Helper to artificially move a seat from one source to another (Simulate MIGRATION)
function simulateMigration(stats: CombinedEventStats, fromSource: SourceType, toSource: SourceType, seatKeyToMigrate: string, exactSectorName: string) {
    // 1. Sell it from the old source
    const sold = simulateSale(stats, fromSource, seatKeyToMigrate);
    if (!sold) return false;

    // 2. Add it to the new source
    const tData = stats.perSource[toSource];
    if (!tData || !tData.sectors) return false;

    // Find the matching sector name
    let targetSector = tData.sectors.find(s => s.sectorName === exactSectorName) || tData.sectors[0];

    // We can't perfectly guess the sector name mapping, but we can try to find one where it fits, or just force it into the first sector for math purposes.
    // In real life, the new platform provides the sector name. Here we just inject it blindly.

    targetSector.freeSeats.push(seatKeyToMigrate);
    // Remove it from taken if it was there
    const takenIdx = targetSector.takenSeats.findIndex(s => normalizeSeatKey(s) === normalizeSeatKey(seatKeyToMigrate));
    if (takenIdx !== -1) targetSector.takenSeats.splice(takenIdx, 1);

    tData.totals.free++;
    if (takenIdx !== -1) tData.totals.taken--;
    targetSector.totals.free++;
    if (takenIdx !== -1) targetSector.totals.taken--;

    console.log(`[SIM] Symulacja migracji: Dodano miejsce ${targetSector.sectorName}:${seatKeyToMigrate} jako wolne na platformie ${toSource}`);
    return true;
}

async function runSimulation(eventId: string) {
    console.log(`========== SYMULATOR SPRZEDAŻY I MIGRACJI ==========`);
    console.log(`Wczytywanie wydarzenia: ${eventId}`);

    const originalStats = loadFullStats(eventId);
    if (!originalStats) {
        console.error(`Nie znaleziono w pamięci pliku full_stats_cache.json dla ${eventId}`);
        return;
    }

    const prevHistory = await loadHistory(eventId);
    const prevStats = await loadStatsHistory(eventId);

    if (!prevStats) {
        console.error(`Brak stats_history.json dla tego wydarzenia. Pamiętaj by uprzednio zeskrapować je prawdziwie!`);
        return;
    }

    // Clone the stats to avoid mutating the real cache file implicitly (if objects are kept in memory)
    const stats: CombinedEventStats = JSON.parse(JSON.stringify(originalStats));

    // ==========================================
    // DEKLARACJA SCENARIUSZA TESTOWEGO
    // ==========================================
    console.log('\n--- KROK 1: Zmiana dancyh by zasymulować rynek ---');

    // Znajdźmy jedno losowe wolne miejsce na eBilet i zasymulujmy MIGRACJĘ na KupBilecik
    let migratedSeat = null;
    let soldSeat = null;

    const eBiletSectors = stats.perSource.ebilet?.sectors || [];
    if (eBiletSectors.length > 0 && eBiletSectors[0].freeSeats.length > 0) {
        migratedSeat = eBiletSectors[0].freeSeats[0];
        simulateMigration(stats, 'ebilet', 'kupbilecik', migratedSeat, eBiletSectors[0].sectorName);
    }

    // Znajdźmy jakieś miejsce na KupBilecik by zasymulować czystą SPRZEDAŻ
    const kbSectors = stats.perSource.kupbilecik?.sectors || [];
    if (kbSectors.length > 0 && kbSectors[0].freeSeats.length > 2) {
        soldSeat = kbSectors[0].freeSeats[0]; // take first, since migrated was pushed to end
        if (soldSeat === migratedSeat) soldSeat = kbSectors[0].freeSeats[1];
        simulateSale(stats, 'kupbilecik', soldSeat);
    }

    // ==========================================
    // ODTWORZENIE LOGIKI SERWERA Z eventScraper.ts
    // ==========================================
    console.log('\n--- KROK 2: Uruchomienie Silnika Kalkulacji i Różnic ---');

    const results = stats.perSource;
    const allCurrentFreeKeys = new Set<string>();
    const currentFreeKeysBySource: Record<string, Set<string>> = {
        biletyna: new Set(),
        ebilet: new Set(),
        kupbilecik: new Set()
    };
    const knownSectors = new Set<string>();

    for (const [sourceName, sourceData] of Object.entries(results)) {
        if (!sourceData || !sourceData.sectors) continue;
        const source = sourceName as SourceType;
        for (const sector of sourceData.sectors) {
            knownSectors.add(sector.sectorName);
            for (const seatKey of sector.freeSeats) {
                const normalizedSeatKey = normalizeSeatKey(seatKey);
                const uniqueKey = `${sector.sectorName}:${normalizedSeatKey}`;
                allCurrentFreeKeys.add(uniqueKey);
                currentFreeKeysBySource[source].add(uniqueKey);
            }
        }
    }

    const inferredSold: Record<string, SourceType> = {};
    const shiftedFrom: Record<string, number> = { biletyna: 0, ebilet: 0, kupbilecik: 0 };

    for (const [uniqueKey, lastSource] of Object.entries(prevHistory)) {
        const [sectorName] = uniqueKey.split(':');
        if (knownSectors.has(sectorName)) {
            if (!currentFreeKeysBySource[lastSource]?.has(uniqueKey)) {
                if (allCurrentFreeKeys.has(uniqueKey)) {
                    shiftedFrom[lastSource]++;
                    console.log(`[MATH] Wykryto MIGRACJĘ miejsca ${uniqueKey} (Utracono na ${lastSource}, ale odnaleziono powiązane gdzie indziej)`);
                } else {
                    inferredSold[uniqueKey] = lastSource;
                    console.log(`[MATH] Wykryto SPRZEDAŻ miejsca ${uniqueKey} z ${lastSource}`);
                }
            }
        }
    }

    const currentStatsEntry: StatsHistoryEntry = {
        biletynaTaken: results.biletyna?.totals.taken || 0,
        ebiletTaken: results.ebilet?.totals.taken || 0,
        kupbilecikTaken: results.kupbilecik?.totals.taken || 0,
        biletynaFree: results.biletyna?.totals.free || 0,
        ebiletFree: results.ebilet?.totals.free || 0,
        kupbilecikFree: results.kupbilecik?.totals.free || 0,
        timestamp: new Date().toISOString()
    };

    let diffObj = undefined;

    if (prevStats) {
        let bSold = 0;
        let eSold = 0;
        let kSold = 0;

        for (const source of Object.values(inferredSold)) {
            if (source === 'biletyna') bSold++;
            if (source === 'ebilet') eSold++;
            if (source === 'kupbilecik') kSold++;
        }

        diffObj = {
            biletynaSold: bSold,
            ebiletSold: eSold,
            kupbilecikSold: kSold,
            lastUpdated: prevStats.timestamp
        };
    }

    console.log('\n--- KROK 3: WYNIK WYJŚCIOWY DO DISCORDA I FRONTENDU (Bezpośrednie liczenie wyizolowanych stratnych miejsc) ---');
    console.log(diffObj);

    console.log('\n--- KROK 4: TEST RENDEROWANIA KOLORU NA MAPIE (FRONTEND UI) ---');
    if (migratedSeat) {
        console.log(`[TEST KOLORU] Zmigrowane miejsce ${migratedSeat} wcześniej należało do eBiletu.`);
        console.log(`Frontend UI podczas malowania kropki SVG nakłada warstwy. Widzi że na eBilet ma status "Zajęte/Ciemne".`);
        console.log(`Następnie widzi, że na KupBilecik ma nowy status "Wolne/Jasne Niebieskie".`);
        console.log(`[WYNIK UI] Ponieważ wolny status zawsze wygrywa i nadpisuje poprzednie wg kodu w page.tsx, kropka natychmiastowo zaświeci się docelowym, JASNYSZARYM (lub niebieskim) kolorem nowego sprzedawcy!`);
    }

    if (diffObj) {
        if (diffObj.ebiletSold === 0) {
            console.log(`✅ SUKCES LOGIKI! Pomimo ubytku 1 miejsca z serwerów eBiletu, z racji migracji do innej puli liczba SPRZEDAŻY wyniosła: 0! Brak fałszywego powiadomienia Discord.`);
        } else {
            console.log(`❌ Serwer zaraportowałby błędną sprzedaż na eBilecie: ${diffObj.ebiletSold}`);
        }

        if (diffObj.kupbilecikSold === 1) {
            console.log(`✅ SUKCES LOGIKI! Mimo zasilenia KupBileciku +1 migrującym miejscem (co zmyliło zwykłą matematykę), dedykowane stracone miejsce obok poprawnie nabiło +1 KupBilecikowi na Discord!`);
        } else {
            console.log(`❌ Serwer pominął sprzedaż na KupBileciku (wynik: ${diffObj.kupbilecikSold})`);
        }
    }

    console.log('\nTen skrypt nie modyfikuje rzeczywistych plików w projekcie. Symuluje on tylko matematykę z Twoich ostatnich cache\'ów!');
}

const args = process.argv.slice(2);
if (args.length === 0) {
    console.error("Podaj globalEventId (np. 20260309-1800-poznan-h3cq5s) jako argument uruchomienia.");
    process.exit(1);
}

runSimulation(args[0]);
