// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const expect = chai.expect;
import { load } from "./exportedApi";
import { MAX_TIME_OUT, createMockedConnectionString, createMockedKeyValue, mockAppConfigurationClientListConfigurationSettings, restoreMocks } from "./utils/testHelper.js";

describe("startup", function () {
    this.timeout(MAX_TIME_OUT);

    afterEach(() => {
        restoreMocks();
    });

    it("should throw exception when timeout", async () => {
        expect(load(createMockedConnectionString(), {startupOptions: {timeoutInMs: 1}}))
            .eventually.rejectedWith("Load operation timed out.");
    });

    it("should retry for load operation when retryEnabled is true", async () => {
        let attempt = 0;
        const failForInitialAttempt = () => {
            if (attempt < 1) {
                attempt += 1;
                throw new Error("Test Error");
            }
        };
        mockAppConfigurationClientListConfigurationSettings(
            [[{key: "TestKey", value: "TestValue"}].map(createMockedKeyValue)],
            failForInitialAttempt);

        const settings = await load(createMockedConnectionString());
        expect(settings).not.undefined;
        expect(settings.get("TestKey")).eq("TestValue");
    });
});
