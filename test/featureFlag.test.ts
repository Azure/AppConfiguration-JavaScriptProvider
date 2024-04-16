// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
import { load } from "./exportedApi";
import { createMockedConnectionString, createMockedFeatureFlag, createMockedKeyValue, mockAppConfigurationClientListConfigurationSettings, restoreMocks } from "./utils/testHelper";
chai.use(chaiAsPromised);
const expect = chai.expect;

const mockedKVs = [{
    key: "app.settings.fontColor",
    value: "red",
}].map(createMockedKeyValue).concat([
    createMockedFeatureFlag("Beta", true),
    createMockedFeatureFlag("Alpha_1", true),
    createMockedFeatureFlag("Alpha2", false),
]);

describe("feature flags", function () {
    this.timeout(10000);

    before(() => {
        mockAppConfigurationClientListConfigurationSettings(mockedKVs);
    });

    after(() => {
        restoreMocks();
    })
    it("should load feature flags if enabled", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            featureFlagOptions: {
                enabled: true
            }
        });
        expect(settings).not.undefined;
        expect(settings.get("feature_management")).not.undefined;
        expect(settings.get<any>("feature_management").feature_flags).not.undefined;
    });

    it("should not load feature flags if disabled", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            featureFlagOptions: {
                enabled: false
            }
        });
        expect(settings).not.undefined;
        expect(settings.get("feature_management")).undefined;
    });

    it("should not load feature flags if not specified", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString);
        expect(settings).not.undefined;
        expect(settings.get("feature_management")).undefined;
    });

    it("should load feature flags with custom selector", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            featureFlagOptions: {
                enabled: true,
                selectors: [{
                    keyFilter: "Alpha*"
                }]
            }
        });
        expect(settings).not.undefined;
        expect(settings.get("feature_management")).not.undefined;
        const featureFlags = settings.get<any>("feature_management").feature_flags;
        expect(featureFlags).not.undefined;
        expect((featureFlags as []).length).equals(2);
    });

});
