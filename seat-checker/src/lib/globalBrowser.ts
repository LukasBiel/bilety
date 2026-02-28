import { chromium, Browser } from 'playwright';

// Prevent multiple instances in development during hot-reload
const globalForBrowser = global as unknown as { _browserInstance: Browser | undefined };

export class GlobalBrowserService {
    private static instance: GlobalBrowserService;
    private browser: Browser | null = null;
    private isLaunching: boolean = false;

    private constructor() { }

    public static getInstance(): GlobalBrowserService {
        if (!GlobalBrowserService.instance) {
            GlobalBrowserService.instance = new GlobalBrowserService();
        }
        return GlobalBrowserService.instance;
    }

    public async getBrowser(): Promise<Browser> {
        // 1. Return existing valid browser
        if (globalForBrowser._browserInstance && this.isConnected(globalForBrowser._browserInstance)) {
            return globalForBrowser._browserInstance;
        }

        // 2. If launching is already in progress, wait for it (simple mutex)
        if (this.isLaunching) {
            // Wait up to 10s for the other launch to finish
            const start = Date.now();
            while (this.isLaunching && Date.now() - start < 10000) {
                await new Promise(r => setTimeout(r, 100));
            }
            // If successful, return it
            if (globalForBrowser._browserInstance && this.isConnected(globalForBrowser._browserInstance)) {
                return globalForBrowser._browserInstance;
            }
        }

        // 3. Launch new browser
        this.isLaunching = true;
        try {
            console.log('GlobalBrowser: Launching new Chromium instance...');
            const browser = await chromium.launch({
                headless: true, // Always headless in production/background
                args: ['--no-sandbox', '--disable-setuid-sandbox'] // Safety args
            });

            // Save to global scope
            globalForBrowser._browserInstance = browser;

            // Handle disconnects
            browser.on('disconnected', () => {
                console.log('GlobalBrowser: Browser disconnected!');
                globalForBrowser._browserInstance = undefined;
            });

            console.log('GlobalBrowser: Launched successfully.');
            return browser;
        } finally {
            this.isLaunching = false;
        }
    }

    private isConnected(browser: Browser): boolean {
        return browser.isConnected();
    }

    // Optional: Manually close if needed (e.g. server shutdown)
    public async close() {
        if (globalForBrowser._browserInstance) {
            await globalForBrowser._browserInstance.close();
            globalForBrowser._browserInstance = undefined;
        }
    }
}

// Export a simple helper for consumers
export const getGlobalBrowser = async () => {
    return GlobalBrowserService.getInstance().getBrowser();
};
