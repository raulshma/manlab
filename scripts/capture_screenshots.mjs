import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

(async () => {
    console.log("Launching browser...");
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    const baseUrl = 'http://localhost:5173';

    // Pre-emptively set skip flag to avoid setup screen if possible
    await page.evaluateOnNewDocument(() => {
        localStorage.setItem("manlab:skip_auth_setup", "true");
    });

    try {
        console.log(`Navigating to ${baseUrl}...`);
        await page.goto(baseUrl, { waitUntil: 'networkidle0' });

        // Wait for potential animations or data loading
        await new Promise(r => setTimeout(r, 3000));

        const routes = [
            { path: '/', name: 'dashboard' },
            { path: '/nodes', name: 'nodes' },
            { path: '/network', name: 'network' },
            { path: '/monitoring', name: 'monitoring' },
            { path: '/settings', name: 'settings' },
            { path: '/analytics', name: 'analytics' },
            { path: '/files', name: 'files' },
            { path: '/logs', name: 'audit_logs' },
            { path: '/docker', name: 'docker_studio' },
            { path: '/processes', name: 'processes' },
            { path: '/users', name: 'users' }
        ];

        for (const route of routes) {
            console.log(`Navigating to ${route.path}...`);
            if (route.path !== '/') {
                await page.goto(`${baseUrl}${route.path}`, { waitUntil: 'networkidle0' });
                await new Promise(r => setTimeout(r, 2000));
            }

            const imagePath = join(__dirname, `../docs/images/${route.name}.png`); // Using relative path
            console.log(`Saving screenshot to ${imagePath}`);
            await page.screenshot({ path: imagePath, fullPage: false });
        }
    } catch (e) {
        console.error("Error during screenshot capture:", e);
    } finally {
        await browser.close();
        console.log("Browser closed.");
    }
})();
