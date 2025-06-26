// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const expect = chai.expect;
import { CDN_TOKEN_LOOKUP_HEADER, loadFromAzureFrontDoor } from "./exportedApi.js";
import { MAX_TIME_OUT, mockAppConfigurationClientListConfigurationSettings, mockAppConfigurationClientGetConfigurationSetting, restoreMocks, createMockedEndpoint, createMockedKeyValue, sleepInMs } from "./utils/testHelper.js";
import * as uuid from "uuid";
import { ListConfigurationSettingsOptions, GetConfigurationSettingOptions } from "@azure/app-configuration";

let mockedKVs: any[] = [];

function updateSetting(key: string, value: any) {
    const setting = mockedKVs.find(elem => elem.key === key);
    if (setting) {
        setting.value = value;
        setting.etag = uuid.v4();
    }
}

describe("load from Azure Front Door", function () {
    this.timeout(MAX_TIME_OUT);

    before(() => {
        mockedKVs = [
            { value: "red", key: "app.settings.fontColor" },
            { value: "40", key: "app.settings.fontSize" }
        ].map(createMockedKeyValue);
        mockAppConfigurationClientListConfigurationSettings([mockedKVs]);
    });

    after(() => {
        restoreMocks();
    });

    it("should load data from Azure Front Door", async () => {
        const endpoint = createMockedEndpoint();
        const settings = await loadFromAzureFrontDoor(endpoint);
        expect(settings).not.undefined;
        expect(settings.get("app.settings.fontColor")).eq("red");
        expect(settings.get("app.settings.fontSize")).eq("40");
    });

    it("should throw error when replica discovery is enabled", async () => {
        const endpoint = createMockedEndpoint();
        return expect(loadFromAzureFrontDoor(endpoint, {
            replicaDiscoveryEnabled: true
        })).eventually.rejectedWith("Replica discovery is not supported when loading from Azure Front Door.");
    });

    it("should throw error when load balancing is enabled", async () => {
        const endpoint = createMockedEndpoint();
        return expect(loadFromAzureFrontDoor(endpoint, {
            loadBalancingEnabled: true
        })).eventually.rejectedWith("Load balancing is not supported when loading from Azure Front Door.");
    });
});

let cdnTokenLookup;
const listKvFromAfdCallback = (options: ListConfigurationSettingsOptions) => {
    cdnTokenLookup = options.requestOptions?.customHeaders?.[CDN_TOKEN_LOOKUP_HEADER];
};
const getKvFromAfdCallback = (options: GetConfigurationSettingOptions) => {
    cdnTokenLookup = options.requestOptions?.customHeaders?.[CDN_TOKEN_LOOKUP_HEADER];
};
describe("dynamic refresh when loading from Azure Front Door", function () {
    this.timeout(MAX_TIME_OUT);

    beforeEach(() => {
        mockedKVs = [
            { value: "red", key: "app.settings.fontColor" },
            { value: "40", key: "app.settings.fontSize" }
        ].map(createMockedKeyValue);
        mockAppConfigurationClientListConfigurationSettings([mockedKVs], listKvFromAfdCallback);
        mockAppConfigurationClientGetConfigurationSetting(mockedKVs, getKvFromAfdCallback);
    });

    afterEach(() => {
        restoreMocks();
    });

    it("should append cdn token to the watch request", async () => {
        const endpoint = createMockedEndpoint();
        const settings = await loadFromAzureFrontDoor(endpoint, {
            refreshOptions: {
                enabled: true,
                refreshIntervalInMs: 2_000,
                watchedSettings: [
                    { key: "app.settings.fontColor" }
                ]
            }
        });
        expect(settings).not.undefined;
        expect(settings.get("app.settings.fontColor")).eq("red");
        expect(settings.get("app.settings.fontSize")).eq("40");

        updateSetting("app.settings.fontColor", "blue");

        await settings.refresh();
        expect(settings.get("app.settings.fontColor")).eq("red");
        expect(cdnTokenLookup).is.undefined;

        await sleepInMs(2 * 1000 + 1);
        await settings.refresh();
        expect(settings.get("app.settings.fontColor")).eq("blue");
        expect(cdnTokenLookup).is.not.undefined;
        const previousCdnToken = cdnTokenLookup;

        updateSetting("app.settings.fontColor", "green");

        await sleepInMs(2 * 1000 + 1);
        await settings.refresh();
        expect(settings.get("app.settings.fontColor")).eq("green");
        expect(cdnTokenLookup).is.not.undefined;
        expect(cdnTokenLookup).to.not.eq(previousCdnToken);
    });
});
