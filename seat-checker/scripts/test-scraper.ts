import { scrapeAllEvents } from '../src/lib/scrapers';
import { joinEvents } from '../src/lib/eventJoin';
import { scrapeEventStats } from '../src/lib/scrapers/eventScraper';
import { loadStatsHistory } from '../src/lib/statsHistory';
import { getGlobalBrowser } from '../src/lib/globalBrowser';

async function main() {
    const args = process.argv.slice(2);
    const indexArg = args[0];

    // --- Monkey-patch console.log to include timestamp and time-diff ---
    const originalLog = console.log;
    const startTime = Date.now();
    let lastLogTime = startTime;

    console.log = (...args: any[]) => {
        const now = Date.now();
        const totalDiff = ((now - startTime) / 1000).toFixed(2).padStart(6);
        const stepDiff = ((now - lastLogTime) / 1000).toFixed(2).padStart(6);
        lastLogTime = now;
        originalLog(`[+${totalDiff}s | ${stepDiff}s]`, ...args);
    };

    console.log("Rozpoczynamy narzedzie testowe...");
    console.log("Pobieranie podstawowych list wydarzen ze wszystkich zrodel...");

    const scrapeResults = await scrapeAllEvents();

    // Logowanie wynikow pierwszego etapu
    for (const res of scrapeResults) {
        if (res.error) {
            console.log(`[UWAGA] ${res.source} rzucilo blad: ${res.error}`);
        } else {
            console.log(`-> ${res.source}: ${res.events.length} wydarzen znalezionych.`);
        }
    }

    const allRawEvents = scrapeResults.flatMap(r => r.events);
    const joinedEvents = joinEvents(allRawEvents);

    console.log(`\n================================================================`);
    console.log(`Zlaczono w sumie: ${joinedEvents.length} unikalnych wydarzen.`);
    console.log(`================================================================\n`);

    if (!indexArg) {
        console.log("Nie podano indeksu wydarzenia. Oto dostepne wydarzenia:");
        joinedEvents.forEach((evt, idx) => {
            const sources = Object.keys(evt.sources).join(', ');
            console.log(`[${idx.toString().padStart(3, ' ')}] ${evt.title} (${evt.date} w ${evt.city || '?'}) [Źródła: ${sources}]`);
        });
        console.log("\nAby uzyc pojedynczego, odpal: npx tsx scripts/test-scraper.ts <index_liczbowy>");
        process.exit(0);
    }

    const targetIndex = parseInt(indexArg, 10);
    if (isNaN(targetIndex) || targetIndex < 0 || targetIndex >= joinedEvents.length) {
        console.error("Niewlasciwy indeks wydarzenia!");
        process.exit(1);
    }

    const event = joinedEvents[targetIndex];
    console.log(`Wbrano wydarzenie o indeksie: [${targetIndex}]`);
    console.log(`Tytul: ${event.title}`);
    console.log(`Data:  ${event.date} / Miasto: ${event.city}`);
    console.log(`Global ID: ${event.globalEventId}`);

    // Zrodel linki:
    console.log(`\nURL do wydarzen:`);
    Object.entries(event.sources).forEach(([platform, data]) => {
        if (data) {
            console.log(`- ${platform}: ${data.eventCardUrl}`);
        }
    });

    console.log(`\n================================================================`);
    console.log(`Sprawdzam dane historyczne...`);
    const prevStats = await loadStatsHistory(event.globalEventId);
    if (prevStats) {
        console.log(`Znaleziono poprzedni zapis biletow (z dnia ${prevStats.timestamp}):`);
        console.log(JSON.stringify(prevStats, null, 2));
    } else {
        console.log(`Brak starszych zapisow. To bedzie pierwszy zrzut biletow.`);
    }

    console.log(`\n================================================================`);
    console.log(`Zaczynamy dokladne pobieranie statystyk (scrapeEventStats)...`);
    const scrapeStart = Date.now();

    // Uruchomienie dokladnego skanowania wszystkich podstron biletow (siedzenia, sektory itd)
    let stats;
    try {
        stats = await scrapeEventStats(event, event.globalEventId);
    } catch (e) {
        console.error("Blad po stronie glownego scrapera:", e);
        process.exit(1);
    }

    const scrapeEnd = Date.now();
    console.log(`\nSkrypt pobierania biletow zakonczyl sie pomyślnie po ${((scrapeEnd - scrapeStart) / 1000).toFixed(2)}s`);

    console.log(`\n================================================================`);
    console.log(`========================= PODSUMOWANIE =========================`);
    console.log(`================================================================`);

    console.log(`Laczenie wszystkie miejsca: ${stats.combinedTotals.total}`);
    console.log(`Lacznie WOLNYCH:          ${stats.combinedTotals.free}`);
    console.log(`Lacznie ZAJĘTYCH:         ${stats.combinedTotals.taken}`);

    console.log(`\nPodzial na platformy (Bileterie):`);
    Object.entries(stats.perSource).forEach(([sourceName, source]) => {
        if (!source) return;
        console.log(`\n-> [${sourceName.toUpperCase()}]`);
        console.log(`   Scraper zaprowadzil nas do linku Sklepu: ${source.finalUrl || 'Brak linku'}`);
        console.log(`   Statystyki: ${source.totals.total} miejsc (Wolne: ${source.totals.free} | Zablokowane/Sprzedane: ${source.totals.taken})`);

        if (source.sectors && source.sectors.length > 0) {
            console.log(`   Liczba znalezionych Sektorow / Poziomow: ${source.sectors.length}`);
            source.sectors.forEach(s => {
                const total = s.totals.total.toString().padStart(4);
                const free = s.totals.free.toString().padStart(4);
                const taken = s.totals.taken.toString().padStart(4);
                console.log(`      * ${s.sectorName.padEnd(20)} -> Łącznie: ${total} | Wolne: ${free} | Kupione/Niedostępne: ${taken}`);
            });
        }
    });

    if (stats.diff) {
        console.log(`\n=================== NOWO SPRZEDANE OD OSTATNIEGO RAZU ===================`);
        console.log(`Porownanie wzgledem: ${stats.diff.lastUpdated}`);
        console.log(`- Biletyna  zniknelo wolnych miejsc: +${stats.diff.biletynaSold}`);
        console.log(`- eBilet    zniknelo wolnych miejsc: +${stats.diff.ebiletSold}`);
        console.log(`- KupBilecik zniknelo wolnych miejsc: +${stats.diff.kupbilecikSold}`);
    }

    if (stats.inferredSold && Object.keys(stats.inferredSold).length > 0) {
        console.log(`\nOdkryto nowo-wykupione siedzenia: ${Object.keys(stats.inferredSold).length}`);
        // Wypisz probke, zeby nie zasmiecac ekranu, e.g. up to 10
        const sampleSold = Object.entries(stats.inferredSold).slice(0, 10);
        sampleSold.forEach(([seatKey, platform]) => {
            console.log(`   * ${seatKey} (wedlug ${platform})`);
        });
        if (Object.keys(stats.inferredSold).length > 10) {
            console.log(`   ... i ${Object.keys(stats.inferredSold).length - 10} wiecej`);
        }
    }

    // Zakonczenie zywotu przegladarki w tle, ktora stworzyl singleton
    console.log("\nZamykam globalna przegladarke...");
    const browserService = await getGlobalBrowser();
    await browserService.close();

    console.log("== GOTOWE ==");
    process.exit(0);
}

main().catch(err => {
    console.error("Wystąpił nieoczekiwany blad w skrypcie: ", err);
    process.exit(1);
});
