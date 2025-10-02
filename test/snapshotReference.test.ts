// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/* eslint-disable @typescript-eslint/no-unused-expressions */
import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const expect = chai.expect;
import { load } from "../src/index.js";
import {
    mockAppConfigurationClientListConfigurationSettings,
    mockAppConfigurationClientGetSnapshot,
    mockAppConfigurationClientListConfigurationSettingsForSnapshot,
    restoreMocks,
    createMockedConnectionString,
    createMockedKeyValue,
    createMockedSnapshotReference,
    createMockedFeatureFlag,
    sleepInMs
} from "./utils/testHelper.js";
import * as uuid from "uuid";

const mockedKVs = [{
    key: "TestKey1",
    value: "Value1",
}, {
    key: "TestKey2",
    value: "Value2",
}
].map(createMockedKeyValue);

mockedKVs.push(createMockedSnapshotReference("TestSnapshotRef", "TestSnapshot1"));

// TestSnapshot1
const snapshot1 = [{
    key: "TestKey1",
    value: "Value1 in snapshot1",
}
].map(createMockedKeyValue);
const testFeatureFlag = createMockedFeatureFlag("TestFeatureFlag");
snapshot1.push(testFeatureFlag);

// TestSnapshot2
const snapshot2 = [{
    key: "TestKey1",
    value: "Value1 in snapshot2",
}
].map(createMockedKeyValue);

describe("snapshot reference", function () {

    beforeEach(() => {
        const snapshotResponses = new Map([
            ["TestSnapshot1", { compositionType: "key" }],
            ["TestSnapshot2", { compositionType: "key" }]]
        );
        const snapshotKVs = new Map([
            ["TestSnapshot1", [snapshot1]],
            ["TestSnapshot2", [snapshot2]]]
        );
        mockAppConfigurationClientGetSnapshot(snapshotResponses);
        mockAppConfigurationClientListConfigurationSettingsForSnapshot(snapshotKVs);
        mockAppConfigurationClientListConfigurationSettings([mockedKVs]);
    });

    afterEach(() => {
        restoreMocks();
    });

    it("should resolve snapshot reference", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString);
        expect(settings.get("TestKey1")).eq("Value1 in snapshot1");

        // it should ignore feature flags in snapshot
        expect(settings.get(testFeatureFlag.key)).to.be.undefined;
        expect(settings.get("feature_management")).to.be.undefined;

        // it should not load the snapshot reference key
        expect(settings.get("TestSnapshotRef")).to.be.undefined;
    });

    it("should refresh when snapshot reference changes", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            refreshOptions: {
                enabled: true,
                refreshIntervalInMs: 2000
            }
        });
        expect(settings.get("TestKey1")).eq("Value1 in snapshot1");

        const setting = mockedKVs.find(kv => kv.key === "TestSnapshotRef");
        setting!.value = "{\"snapshot_name\":\"TestSnapshot2\"}";
        setting!.etag = uuid.v4();

        await sleepInMs(2 * 1000 + 1);

        await settings.refresh();

        expect(settings.get("TestKey1")).eq("Value1 in snapshot2");
    });

});
