import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { Share } from '@capacitor/share';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
console.log('[Web Engine Mobile] Starting...');
// Initialize platform-specific features
async function initializeMobile() {
    // Hide splash screen
    await SplashScreen.hide();
    // Set status bar style
    if (Capacitor.isNativePlatform()) {
        await StatusBar.setStyle({ style: Style.Dark });
        await StatusBar.setBackgroundColor({ color: '#1a1a2e' });
    }
    console.log('[Web Engine Mobile] Initialized');
}
// Mobile API wrapper exposed to the editor
const mobileAPI = {
    isNative: Capacitor.isNativePlatform(),
    platform: Capacitor.getPlatform(),
    // File system
    async readFile(path) {
        const result = await Filesystem.readFile({
            path,
            directory: Directory.Data,
        });
        return result.data;
    },
    async writeFile(path, data) {
        await Filesystem.writeFile({
            path,
            data,
            directory: Directory.Data,
            encoding: Encoding.UTF8,
        });
    },
    async deleteFile(path) {
        await Filesystem.deleteFile({
            path,
            directory: Directory.Data,
        });
    },
    async readDirectory(path) {
        const result = await Filesystem.readdir({
            path,
            directory: Directory.Data,
        });
        return result.files.map(f => f.name);
    },
    // Preferences (key-value storage)
    async getItem(key) {
        const result = await Preferences.get({ key });
        return result.value;
    },
    async setItem(key, value) {
        await Preferences.set({ key, value });
    },
    async removeItem(key) {
        await Preferences.remove({ key });
    },
    // Share
    async share(options) {
        await Share.share(options);
    },
    // App info
    getPlatform() {
        return Capacitor.getPlatform();
    },
    isNativePlatform() {
        return Capacitor.isNativePlatform();
    },
};
// Expose to window
window.__MOBILE_API__ = mobileAPI;
// Initialize
initializeMobile().catch(console.error);
export { mobileAPI };
//# sourceMappingURL=main.js.map