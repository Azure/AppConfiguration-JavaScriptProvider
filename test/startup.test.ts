// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const expect = chai.expect;
import { load } from "./exportedApi";
import { MAX_TIME_OUT, createMockedConnectionString, createMockedKeyValue, mockAppConfigurationClientListConfigurationSettings, restoreMocks } from "./utils/testHelper.js";
import { ErrorMessages } from "../src/common/errorMessages.js"; 

describe("startup", function () {
    this.timeout(MAX_TIME_OUT);

    afterEach(() => {
        restoreMocks();
    });

    it("should retry for load operation before timeout", async () => {
        let attempt = 0;
        const failForInitialAttempt = () => {
            attempt += 1;
            if (attempt <= 1) {
                throw new Error("Test Error");
            }
        };
        mockAppConfigurationClientListConfigurationSettings(
            [[{key: "TestKey", value: "TestValue"}].map(createMockedKeyValue)],
            failForInitialAttempt);

        const settings = await load(createMockedConnectionString());
        expect(attempt).eq(2);
        expect(settings).not.undefined;
        expect(settings.get("TestKey")).eq("TestValue");
    });

    it("should not retry for load operation after timeout", async () => {
        let attempt = 0;
        const failForAllAttempts = () => {
            attempt += 1;
            throw new Error("Test Error");
        };
        mockAppConfigurationClientListConfigurationSettings(
            [[{key: "TestKey", value: "TestValue"}].map(createMockedKeyValue)],
            failForAllAttempts);

        try {
            await load(createMockedConnectionString(), {
                startupOptions: {
                    timeoutInMs: 5_000
                }
            });
        } catch (error) {
            expect(error.message).eq(ErrorMessages.LOAD_OPERATION_FAILED);
            expect(error.cause.message).eq(ErrorMessages.LOAD_OPERATION_TIMEOUT);
            expect(attempt).eq(1);
            return;
        }
        // we should never reach here, load should throw an error
        throw new Error("Expected load to throw.");
    });

    it("should not retry on non-retriable TypeError", async () => {
        let attempt = 0;
        const failForAllAttempts = () => {
            attempt += 1;
            throw new TypeError("Non-retriable Test Error");
        };
        mockAppConfigurationClientListConfigurationSettings(
            [[{key: "TestKey", value: "TestValue"}].map(createMockedKeyValue)],
            failForAllAttempts);

        try {
            await load(createMockedConnectionString(), {
                startupOptions: {
                    timeoutInMs: 10_000
                }
            });
        } catch (error) {
            expect(error.message).eq(ErrorMessages.LOAD_OPERATION_FAILED);
            expect(error.cause.message).eq("Non-retriable Test Error");
            expect(attempt).eq(1);
            return;
        }
        // we should never reach here, load should throw an error
        throw new Error("Expected load to throw.");
    });

    it("should not retry on non-retriable RangeError", async () => {
        let attempt = 0;
        const failForAllAttempts = () => {
            attempt += 1;
            throw new RangeError("Non-retriable Test Error");
        };
        mockAppConfigurationClientListConfigurationSettings(
            [[{key: "TestKey", value: "TestValue"}].map(createMockedKeyValue)],
            failForAllAttempts);

        try {
            await load(createMockedConnectionString(), {
                startupOptions: {
                    timeoutInMs: 10_000
                }
            });
        } catch (error) {
            expect(error.message).eq(ErrorMessages.LOAD_OPERATION_FAILED);
            expect(error.cause.message).eq("Non-retriable Test Error");
            expect(attempt).eq(1);
            return;
        }
        // we should never reach here, load should throw an error
        throw new Error("Expected load to throw.");
    });
});
