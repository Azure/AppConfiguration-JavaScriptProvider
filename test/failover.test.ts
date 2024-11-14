// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const expect = chai.expect;
import { load } from "./exportedApi";
import { createMockedConnectionString, createMockedFeatureFlag, createMockedKeyValue, mockAppConfigurationClientListConfigurationSettingsWithFailure, mockConfigurationManagerGetClients, restoreMocks } from "./utils/testHelper";
import { getValidDomain, isValidEndpoint } from "../src/ConfigurationClientManager";

const mockedKVs = [{
    key: "app.settings.fontColor",
    value: "red",
}, {
    key: "app.settings.fontSize",
    value: "40",
}].map(createMockedKeyValue);

const mockedFeatureFlags = [{
    key: "app.settings.fontColor",
    value: "red",
}].map(createMockedKeyValue).concat([
    createMockedFeatureFlag("Beta", { enabled: true }),
    createMockedFeatureFlag("Alpha_1", { enabled: true }),
    createMockedFeatureFlag("Alpha_2", { enabled: false }),
]);

describe("failover", function () {
    this.timeout(15000);

    afterEach(() => {
        restoreMocks();
    });

    it("should failover to replica and load key values from config store", async () => {
        const replicaDiscoveryEnabled = true;
        const isFailoverable = true;
        mockConfigurationManagerGetClients(isFailoverable);
        mockAppConfigurationClientListConfigurationSettingsWithFailure(mockedKVs);

        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            replicaDiscoveryEnabled: replicaDiscoveryEnabled
        });
        expect(settings).not.undefined;
        expect(settings.get("app.settings.fontColor")).eq("red");
        expect(settings.get("app.settings.fontSize")).eq("40");
    });

    it("should failover to replica and load feature flags from config store", async () => {
        const replicaDiscoveryEnabled = true;
        const isFailoverable = true;
        mockConfigurationManagerGetClients(isFailoverable);
        mockAppConfigurationClientListConfigurationSettingsWithFailure(mockedFeatureFlags);

        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            replicaDiscoveryEnabled: replicaDiscoveryEnabled,
            featureFlagOptions: {
                enabled: true,
                selectors: [{
                    keyFilter: "*"
                }]
            }
        });
        expect(settings).not.undefined;
        expect(settings.get("feature_management")).not.undefined;
        expect(settings.get<any>("feature_management").feature_flags).not.undefined;
    });

    it("should throw error when all clients failed", async () => {
        const isFailoverable = false;
        mockConfigurationManagerGetClients(isFailoverable);
        mockAppConfigurationClientListConfigurationSettingsWithFailure(mockedKVs);

        const connectionString = createMockedConnectionString();
        return expect(load(connectionString)).eventually.rejectedWith("Failed to get configuration settings from endpoint.");
    });

    it("should validate endpoint", () => {
        const fakeHost = "fake.azconfig.io";
        const validDomain = getValidDomain(fakeHost);

        expect(isValidEndpoint("azure.azconfig.io", validDomain)).to.be.true;
        expect(isValidEndpoint("azure.privatelink.azconfig.io", validDomain)).to.be.true;
        expect(isValidEndpoint("azure-replica.azconfig.io", validDomain)).to.be.true;
        expect(isValidEndpoint("azure.badazconfig.io", validDomain)).to.be.false;
        expect(isValidEndpoint("azure.azconfigbad.io", validDomain)).to.be.false;
        expect(isValidEndpoint("azure.appconfig.azure.com", validDomain)).to.be.false;
        expect(isValidEndpoint("azure.azconfig.bad.io", validDomain)).to.be.false;

        const fakeHost2 = "foobar.appconfig.azure.com";
        const validDomain2 = getValidDomain(fakeHost2);

        expect(isValidEndpoint("azure.appconfig.azure.com", validDomain2)).to.be.true;
        expect(isValidEndpoint("azure.z1.appconfig.azure.com", validDomain2)).to.be.true;
        expect(isValidEndpoint("azure-replia.z1.appconfig.azure.com", validDomain2)).to.be.true; // Note: Typo "azure-replia"
        expect(isValidEndpoint("azure.privatelink.appconfig.azure.com", validDomain2)).to.be.true;
        expect(isValidEndpoint("azconfig.appconfig.azure.com", validDomain2)).to.be.true;
        expect(isValidEndpoint("azure.azconfig.io", validDomain2)).to.be.false;
        expect(isValidEndpoint("azure.badappconfig.azure.com", validDomain2)).to.be.false;
        expect(isValidEndpoint("azure.appconfigbad.azure.com", validDomain2)).to.be.false;

        const fakeHost3 = "foobar.azconfig-test.io";
        const validDomain3 = getValidDomain(fakeHost3);

        expect(isValidEndpoint("azure.azconfig-test.io", validDomain3)).to.be.false;
        expect(isValidEndpoint("azure.azconfig.io", validDomain3)).to.be.false;

        const fakeHost4 = "foobar.z1.appconfig-test.azure.com";
        const validDomain4 = getValidDomain(fakeHost4);

        expect(isValidEndpoint("foobar.z2.appconfig-test.azure.com", validDomain4)).to.be.false;
        expect(isValidEndpoint("foobar.appconfig-test.azure.com", validDomain4)).to.be.false;
        expect(isValidEndpoint("foobar.appconfig.azure.com", validDomain4)).to.be.false;
    });
});
