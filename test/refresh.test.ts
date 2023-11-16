// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const expect = chai.expect;
import { load } from "./exportedApi";
import { mockAppConfigurationClientListConfigurationSettings, mockAppConfigurationClientGetConfigurationSetting, restoreMocks, createMockedConnectionString, createMockedKeyValue, sleepInMs } from "./utils/testHelper";
import * as uuid from "uuid";

let mockedKVs: any[] = [];

function updateSetting(key: string, value: any) {
    const setting = mockedKVs.find(elem => elem.key === key);
    if (setting) {
        setting.value = value;
        setting.etag = uuid.v4();
    }
}
function addSetting(key: string, value: any) {
    mockedKVs.push(createMockedKeyValue({ key, value }));
}

describe("dynamic refresh", function () {
    beforeEach(() => {
        mockedKVs = [
            { value: "red", key: "app.settings.fontColor" },
            { value: "40", key: "app.settings.fontSize" }
        ].map(createMockedKeyValue);
        mockAppConfigurationClientListConfigurationSettings(mockedKVs);
        mockAppConfigurationClientGetConfigurationSetting(mockedKVs)
    });

    afterEach(() => {
        restoreMocks();
    })

    it("should only allow non-empty list of watched settings when refresh is enabled", async () => {
        const connectionString = createMockedConnectionString();
        const loadWithEmptyWatchedSettings = load(connectionString, {
            refreshOptions: {
                enabled: true,
                watchedSettings: []
            }
        });
        const loadWithUndefinedWatchedSettings = load(connectionString, {
            refreshOptions: {
                enabled: true
            }
        });
        return Promise.all([
            expect(loadWithEmptyWatchedSettings).eventually.rejectedWith("Refresh is enabled but no watched settings are specified."),
            expect(loadWithUndefinedWatchedSettings).eventually.rejectedWith("Refresh is enabled but no watched settings are specified.")
        ]);
    });

    it("should throw error when calling onRefresh when refresh is not enabled", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString);
        expect(() => settings.onRefresh(() => { })).throws("Refresh is not enabled.");
    });

    it("should only udpate values after refreshInterval", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            refreshOptions: {
                enabled: true,
                refreshIntervalInMs: 2000,
                watchedSettings: [
                    { key: "app.settings.fontColor" }
                ]
            }
        });
        expect(settings).not.undefined;
        expect(settings.get("app.settings.fontColor")).eq("red");
        expect(settings.get("app.settings.fontSize")).eq("40");

        // change setting
        updateSetting("app.settings.fontColor", "blue");

        // within refreshInterval, should not really refresh
        await settings.refresh();
        expect(settings.get("app.settings.fontColor")).eq("red");

        // after refreshInterval, should really refresh
        await sleepInMs(2 * 1000 + 1);
        await settings.refresh();
        expect(settings.get("app.settings.fontColor")).eq("blue");
    });

    it("should not update values when unwatched setting changes", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            refreshOptions: {
                enabled: true,
                refreshIntervalInMs: 2000,
                watchedSettings: [
                    { key: "app.settings.fontColor" }
                ]
            }
        });
        expect(settings).not.undefined;
        expect(settings.get("app.settings.fontColor")).eq("red");
        expect(settings.get("app.settings.fontSize")).eq("40");

        updateSetting("app.settings.fontSize", "50"); // unwatched setting
        await sleepInMs(2 * 1000 + 1);
        await settings.refresh();
        expect(settings.get("app.settings.fontSize")).eq("40");
    });

    it("should watch multiple settings if specified", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            refreshOptions: {
                enabled: true,
                refreshIntervalInMs: 2000,
                watchedSettings: [
                    { key: "app.settings.fontColor" },
                    { key: "app.settings.fontSize" }
                ]
            }
        });
        expect(settings).not.undefined;
        expect(settings.get("app.settings.fontColor")).eq("red");
        expect(settings.get("app.settings.fontSize")).eq("40");

        // change setting
        addSetting("app.settings.bgColor", "white");
        updateSetting("app.settings.fontSize", "50");
        await sleepInMs(2 * 1000 + 1);
        await settings.refresh();
        expect(settings.get("app.settings.fontSize")).eq("50");
        expect(settings.get("app.settings.bgColor")).eq("white");
    });

    it("should execute callbacks on successful refresh", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            refreshOptions: {
                enabled: true,
                refreshIntervalInMs: 2000,
                watchedSettings: [
                    { key: "app.settings.fontColor" }
                ]
            }
        });
        let count = 0;
        const callback = settings.onRefresh(() => count++);

        updateSetting("app.settings.fontColor", "blue");
        await settings.refresh();
        expect(count).eq(0);

        await sleepInMs(2 * 1000 + 1);
        await settings.refresh();
        expect(count).eq(1);

        // can dispose callbacks
        callback.dispose();
    });
});