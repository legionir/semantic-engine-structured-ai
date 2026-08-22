declare const mobileAPI: {
    isNative: any;
    platform: any;
    readFile(path: string): Promise<string>;
    writeFile(path: string, data: string): Promise<void>;
    deleteFile(path: string): Promise<void>;
    readDirectory(path: string): Promise<string[]>;
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<void>;
    share(options: {
        title?: string;
        text?: string;
        url?: string;
    }): Promise<void>;
    getPlatform(): string;
    isNativePlatform(): boolean;
};
export { mobileAPI };
