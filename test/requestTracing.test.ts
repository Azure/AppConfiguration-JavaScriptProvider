// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const expect = chai.expect;
import { createMockedConnectionString, createMockedKeyValue, createMockedTokenCredential, mockAppConfigurationClientListConfigurationSettings, restoreMocks, sleepInMs } from "./utils/testHelper.js";
import { load } from "./exportedApi.js";

class HttpRequestHeadersPolicy {
    headers: any;
    name: string;

    constructor() {
        this.headers = {};
        this.name = "HttpRequestHeadersPolicy";
    }
    sendRequest(req, next) {
        this.headers = req.headers;
        return next(req).then(resp => resp);
    }
}

describe("request tracing", function () {
    this.timeout(15000);

    const fakeEndpoint = "https://127.0.0.1"; // sufficient to test the request it sends out
    const headerPolicy = new HttpRequestHeadersPolicy();
    const position: "perCall" | "perRetry" = "perCall";
    const clientOptions = {
        retryOptions: {
            maxRetries: 0 // save time
        },
        additionalPolicies: [{
            policy: headerPolicy,
            position
        }]
    };

    before(() => {
    });

    after(() => {
    });

    it("should have correct user agent prefix", async () => {
        try {
            await load(createMockedConnectionString(fakeEndpoint), { clientOptions });
        } catch (e) { /* empty */ }
        expect(headerPolicy.headers).not.undefined;
        expect(headerPolicy.headers.get("User-Agent")).satisfy((ua: string) => ua.startsWith("javascript-appconfiguration-provider"));
    });

    it("should have request type in correlation-context header", async () => {
        try {
            await load(createMockedConnectionString(fakeEndpoint), {
                clientOptions
            });
        } catch (e) { /* empty */ }
        expect(headerPolicy.headers).not.undefined;
        expect(headerPolicy.headers.get("Correlation-Context")).eq("RequestType=Startup");
    });

    it("should have key vault tag in correlation-context header", async () => {
        try {
            await load(createMockedConnectionString(fakeEndpoint), {
                clientOptions,
                keyVaultOptions: {
                    credential: createMockedTokenCredential()
                }
            });
        } catch (e) { /* empty */ }
        expect(headerPolicy.headers).not.undefined;
        const correlationContext = headerPolicy.headers.get("Correlation-Context");
        expect(correlationContext).not.undefined;
        expect(correlationContext.includes("UsesKeyVault")).eq(true);
    });

    it("should detect env in correlation-context header", async () => {
        process.env.NODE_ENV = "development";
        try {
            await load(createMockedConnectionString(fakeEndpoint), {
                clientOptions
            });
        } catch (e) { /* empty */ }
        expect(headerPolicy.headers).not.undefined;
        const correlationContext = headerPolicy.headers.get("Correlation-Context");
        expect(correlationContext).not.undefined;
        expect(correlationContext.includes("Env=Dev")).eq(true);
        delete process.env.NODE_ENV;
    });

    it("should detect host type in correlation-context header", async () => {
        process.env.WEBSITE_SITE_NAME = "website-name";
        try {
            await load(createMockedConnectionString(fakeEndpoint), {
                clientOptions
            });
        } catch (e) { /* empty */ }
        expect(headerPolicy.headers).not.undefined;
        const correlationContext = headerPolicy.headers.get("Correlation-Context");
        expect(correlationContext).not.undefined;
        expect(correlationContext.includes("Host=AzureWebApp")).eq(true);
        delete process.env.WEBSITE_SITE_NAME;
    });

    it("should disable request tracing when AZURE_APP_CONFIGURATION_TRACING_DISABLED is true", async () => {
        for (const indicator of ["TRUE", "true"]) {
            process.env.AZURE_APP_CONFIGURATION_TRACING_DISABLED = indicator;
            try {
                await load(createMockedConnectionString(fakeEndpoint), {
                    clientOptions
                });
            } catch (e) { /* empty */ }
            expect(headerPolicy.headers).not.undefined;
            const correlationContext = headerPolicy.headers.get("Correlation-Context");
            expect(correlationContext).undefined;
        }

        // clean up
        delete process.env.AZURE_APP_CONFIGURATION_TRACING_DISABLED;
    });

    it("should have request type in correlation-context header when refresh is enabled", async () => {
        mockAppConfigurationClientListConfigurationSettings([[{
            key: "app.settings.fontColor",
            value: "red"
        }].map(createMockedKeyValue)]);

        const settings = await load(createMockedConnectionString(fakeEndpoint), {
            clientOptions,
            refreshOptions: {
                enabled: true,
                refreshIntervalInMs: 1000,
                watchedSettings: [{
                    key: "app.settings.fontColor"
                }]
            }
        });
        await sleepInMs(1000 + 1);
        try {
            await settings.refresh();
        } catch (e) { /* empty */ }
        expect(headerPolicy.headers).not.undefined;
        const correlationContext = headerPolicy.headers.get("Correlation-Context");
        expect(correlationContext).not.undefined;
        expect(correlationContext.includes("RequestType=Watch")).eq(true);

        restoreMocks();
    });

    describe("request tracing in Web Worker environment", () => {
        let originalNavigator;
        let originalWorkerNavigator;
        let originalWorkerGlobalScope;
        let originalImportScripts;

        before(() => {
            // Save the original values to restore them later
            originalNavigator = (global as any).navigator;
            originalWorkerNavigator = (global as any).WorkerNavigator;
            originalWorkerGlobalScope = (global as any).WorkerGlobalScope;
            originalImportScripts = (global as any).importScripts;
        });

        afterEach(() => {
            // Restore the original values after each test
            // global.navigator was added in node 21, https://nodejs.org/api/globals.html#navigator_1
            // global.navigator only has a getter, so we have to use Object.defineProperty to modify it
            Object.defineProperty(global, "navigator", {
                value: originalNavigator,
                configurable: true
            });
            (global as any).WorkerNavigator = originalWorkerNavigator;
            (global as any).WorkerGlobalScope = originalWorkerGlobalScope;
            (global as any).importScripts = originalImportScripts;
        });

        it("should identify WebWorker environment", async () => {
            (global as any).WorkerNavigator = function WorkerNavigator() { };
            Object.defineProperty(global, "navigator", {
                value: new (global as any).WorkerNavigator(),
                configurable: true
            });
            (global as any).WorkerGlobalScope = function WorkerGlobalScope() { };
            (global as any).importScripts = function importScripts() { };

            try {
                await load(createMockedConnectionString(fakeEndpoint), { clientOptions });
            } catch (e) { /* empty */ }
            expect(headerPolicy.headers).not.undefined;
            const correlationContext = headerPolicy.headers.get("Correlation-Context");
            expect(correlationContext).not.undefined;
            expect(correlationContext.includes("Host=WebWorker")).eq(true);
        });

        it("is not WebWorker when WorkerNavigator is undefined", async () => {
            Object.defineProperty(global, "navigator", {
                value: { userAgent: "node.js" } as any, // Mock navigator
                configurable: true
            });
            (global as any).WorkerNavigator = undefined;
            (global as any).WorkerGlobalScope = function WorkerGlobalScope() { };
            (global as any).importScripts = function importScripts() { };

            try {
                await load(createMockedConnectionString(fakeEndpoint), { clientOptions });
            } catch (e) { /* empty */ }
            expect(headerPolicy.headers).not.undefined;
            const correlationContext = headerPolicy.headers.get("Correlation-Context");
            expect(correlationContext).not.undefined;
            expect(correlationContext.includes("Host=WebWorker")).eq(false);
        });

        it("is not WebWorker when navigator is not an instance of WorkerNavigator", async () => {
            Object.defineProperty(global, "navigator", {
                value: { userAgent: "node.js" } as any, // Mock navigator but not an instance of WorkerNavigator
                configurable: true
            });
            (global as any).WorkerNavigator = function WorkerNavigator() { };
            (global as any).WorkerGlobalScope = function WorkerGlobalScope() { };
            (global as any).importScripts = function importScripts() { };

            try {
                await load(createMockedConnectionString(fakeEndpoint), { clientOptions });
            } catch (e) { /* empty */ }
            expect(headerPolicy.headers).not.undefined;
            const correlationContext = headerPolicy.headers.get("Correlation-Context");
            expect(correlationContext).not.undefined;
            expect(correlationContext.includes("Host=WebWorker")).eq(false);
        });

        it("is not WebWorker when WorkerGlobalScope is undefined", async () => {
            (global as any).WorkerNavigator = function WorkerNavigator() { };
            Object.defineProperty(global, "navigator", {
                value: new (global as any).WorkerNavigator(),
                configurable: true
            });
            (global as any).WorkerGlobalScope = undefined;
            (global as any).importScripts = function importScripts() { };

            try {
                await load(createMockedConnectionString(fakeEndpoint), { clientOptions });
            } catch (e) { /* empty */ }
            expect(headerPolicy.headers).not.undefined;
            const correlationContext = headerPolicy.headers.get("Correlation-Context");
            expect(correlationContext).not.undefined;
            expect(correlationContext.includes("Host=WebWorker")).eq(false);
        });

        it("is not WebWorker when importScripts is undefined", async () => {
            (global as any).WorkerNavigator = function WorkerNavigator() { };
            Object.defineProperty(global, "navigator", {
                value: new (global as any).WorkerNavigator(),
                configurable: true
            });
            (global as any).WorkerGlobalScope = function WorkerGlobalScope() { };
            (global as any).importScripts = undefined;

            try {
                await load(createMockedConnectionString(fakeEndpoint), { clientOptions });
            } catch (e) { /* empty */ }
            expect(headerPolicy.headers).not.undefined;
            const correlationContext = headerPolicy.headers.get("Correlation-Context");
            expect(correlationContext).not.undefined;
            expect(correlationContext.includes("Host=WebWorker")).eq(false);
        });
    });

    describe("request tracing in Web Browser environment", () => {
        let originalWindowType;
        let originalWindowObject;
        let originalDocumentType;
        let originalDocumentObject;

        before(() => {
            // Save the original values to restore them later
            originalWindowType = (global as any).Window;
            originalWindowObject = (global as any).window;
            originalDocumentType = (global as any).Document;
            originalDocumentObject = (global as any).document;
        });

        afterEach(() => {
            // Restore the original values after each test
            (global as any).Window = originalWindowType;
            (global as any).window = originalWindowObject;
            (global as any).Document = originalDocumentType;
            (global as any).document = originalDocumentObject;
        });

        it("should identify Web environment", async () => {
            (global as any).Window = function Window() { };
            (global as any).window = new (global as any).Window();
            (global as any).Document = function Document() { };
            (global as any).document = new (global as any).Document();

            try {
                await load(createMockedConnectionString(fakeEndpoint), { clientOptions });
            } catch (e) { /* empty */ }
            expect(headerPolicy.headers).not.undefined;
            const correlationContext = headerPolicy.headers.get("Correlation-Context");
            expect(correlationContext).not.undefined;
            expect(correlationContext.includes("Host=Web")).eq(true);
        });

        it("is not Web when document is undefined", async () => {
            (global as any).Window = function Window() { };
            (global as any).window = new (global as any).Window();
            (global as any).Document = function Document() { };
            (global as any).document = undefined; // not an instance of Document

            try {
                await load(createMockedConnectionString(fakeEndpoint), { clientOptions });
            } catch (e) { /* empty */ }
            expect(headerPolicy.headers).not.undefined;
            const correlationContext = headerPolicy.headers.get("Correlation-Context");
            expect(correlationContext).not.undefined;
            expect(correlationContext.includes("Host=Web")).eq(false);
        });

        it("is not Web when document is not instance of Document", async () => {
            (global as any).Window = function Window() { };
            (global as any).window = new (global as any).Window();
            (global as any).Document = function Document() { };
            (global as any).document = {}; // Not an instance of Document

            try {
                await load(createMockedConnectionString(fakeEndpoint), { clientOptions });
            } catch (e) { /* empty */ }
            expect(headerPolicy.headers).not.undefined;
            const correlationContext = headerPolicy.headers.get("Correlation-Context");
            expect(correlationContext).not.undefined;
            expect(correlationContext.includes("Host=Web")).eq(false);
        });

        it("is not Web when window is undefined", async () => {
            (global as any).Window = function Window() { };
            (global as any).window = undefined; // not an instance of Window
            (global as any).Document = function Document() { };
            (global as any).document = new (global as any).Document();

            try {
                await load(createMockedConnectionString(fakeEndpoint), { clientOptions });
            } catch (e) { /* empty */ }
            expect(headerPolicy.headers).not.undefined;
            const correlationContext = headerPolicy.headers.get("Correlation-Context");
            expect(correlationContext).not.undefined;
            expect(correlationContext.includes("Host=Web")).eq(false);
        });

        it("is not Web when window is not instance of Window", async () => {
            (global as any).Window = function Window() { };
            (global as any).window = {}; // not an instance of Window
            (global as any).Document = function Document() { };
            (global as any).document = new (global as any).Document();

            try {
                await load(createMockedConnectionString(fakeEndpoint), { clientOptions });
            } catch (e) { /* empty */ }
            expect(headerPolicy.headers).not.undefined;
            const correlationContext = headerPolicy.headers.get("Correlation-Context");
            expect(correlationContext).not.undefined;
            expect(correlationContext.includes("Host=Web")).eq(false);
        });
    });
});
