import type { SourceType } from './types';

export interface DiscordSaleNotification {
    eventId: string;
    eventTitle: string;
    soldSeatsCount: number;
    details: Array<{
        sector: string;
        row: string;
        seat: string;
        source: SourceType;
    }>;
}

/**
 * Sends a formatted embed to the configured Discord Webhook.
 */
export async function sendDiscordSaleNotification(notification: DiscordSaleNotification) {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;

    if (!webhookUrl) {
        console.warn('Discord Webhook URL not configured. Skipping notification.');
        return false;
    }

    if (notification.soldSeatsCount === 0 || notification.details.length === 0) {
        return false;
    }

    // Sort details to group by source and sector
    const sortedDetails = [...notification.details].sort((a, b) => {
        if (a.source !== b.source) return a.source.localeCompare(b.source);
        if (a.sector !== b.sector) return a.sector.localeCompare(b.sector);
        return a.row.localeCompare(b.row);
    });

    // Formatting the seats list nicely
    const seatsText = sortedDetails.map(d =>
        `• Sektor: **${d.sector}** | Rząd: **${d.row}** | Miejsce: **${d.seat}** [${d.source}]`
    ).join('\n');

    const sourceColors: Record<SourceType, number> = {
        biletyna: 0xFF5733,   // Orange/Red
        ebilet: 0x33C3FF,     // Light Blue
        kupbilecik: 0x33FF57  // Green
    };

    // Use the color of the first sold seat for the embed edge
    const mainColor = sourceColors[notification.details[0].source] || 0x5865F2; // Default Discord Blurple

    const payload = {
        embeds: [
            {
                title: `🚨 UWAGA! Znaleziono nową sprzedaż!`,
                description: `Zauważono sprzedaż **${notification.soldSeatsCount}** biletów na wydarzenie:\n\n**${notification.eventTitle}**\n\n**Szczegóły miejsc:**\n${seatsText}`,
                color: mainColor,
                timestamp: new Date().toISOString(),
                footer: {
                    text: 'Seat Checker Bot'
                }
            }
        ]
    };

    try {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            console.error(`Discord Webhook failed with status ${response.status}: ${await response.text()}`);
            return false;
        }

        console.log(`[Discord] Successfully sent notification for ${notification.soldSeatsCount} sold seats on ${notification.eventTitle}`);
        return true;

    } catch (error) {
        console.error('Failed to send Discord notification:', error);
        return false;
    }
}
