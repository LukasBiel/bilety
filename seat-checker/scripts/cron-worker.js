import fs from 'fs';
import path from 'path';

// Zmienna przechowująca czas (w ms) odstępu między skanowaniami. Domyślnie 60 minut (1 godzina)
const INTERVAL_MS = parseInt(process.env.CRON_INTERVAL_MS || '3600000', 10);
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api/events';

console.log('====================================================');
console.log(' Uruchomiono bota odświeżającego w tle (CRON JOB)');
console.log(` Odstęp między skanowaniami: ${INTERVAL_MS / 1000 / 60} minut`);
console.log(` Docelowy serwer API: ${API_URL}`);
console.log(' Bot będzie wysyłać powiadomienia na Discord jeśli znajdzie nowe sprzedaże.');
console.log(' Możesz zminimalizować to okno. Aby zamknąć bota, wciśnij CTRL+C.');
console.log('====================================================\n');

async function triggerRefresh() {
    const timestamp = new Date().toLocaleString('pl-PL');
    console.log(`[${timestamp}] 🚀 Rozpoczynam automatyczne skanowanie wszystkich wydarzeń...`);

    try {
        // Uderzamy w nasz główny POST endpoint, który samoczynnie odświeża wszystko, robi diffy i wysyła na Discord
        const start = Date.now();
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            console.error(`[${timestamp}] ❌ Błąd krytyczny API: ${response.status} ${response.statusText}`);
            return;
        }

        const data = await response.json();
        const duration = ((Date.now() - start) / 1000).toFixed(1);

        if (data.success) {
            console.log(`[${timestamp}] ✅ Skanowanie zakończone sukcesem w ${duration}s! Przeskanowano ${data.events?.length || 0} wydarzeń.`);
            if (data.sourceDetails) {
                const detailsStr = data.sourceDetails.map(s => `${s.source}: ${s.count}`).join(', ');
                console.log(`[${timestamp}] 📊 Szczegóły: ${detailsStr}`);
            }
        } else {
            console.log(`[${timestamp}] ⚠️ Skanowanie zakończone, ale zwróciło błąd: ${data.error}`);
        }

    } catch (error) {
        console.error(`[${timestamp}] ❌ Błąd połączenia z serwerem (Czy aplikacja na porcie 3000 jest włączona?):`, error.message);
    }
}

// 1. Uruchom natychmiast przy włączeniu
triggerRefresh();

// 2. Następnie pętla co X minut
setInterval(triggerRefresh, INTERVAL_MS);
