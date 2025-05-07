import * as dotenv from "dotenv";
dotenv.config()

import { DefaultAzureCredential } from "@azure/identity";
const credential = new DefaultAzureCredential();

import { load } from "@azure/app-configuration-provider";
const connectionString = process.env.APPCONFIG_CONNECTION_STRING;

const totalStartTime = performance.now();

const settings = await load(connectionString, {
    selectors: [
        { keyFilter: "Message" },
        // { keyFilter: "PerformanceTest_*" },
        // { keyFilter: "KeyVaultReference_*" },
    ],
    keyVaultOptions: {
        credential: credential
    }
});

const totalEndTime = performance.now();
const totalDuration = totalEndTime - totalStartTime;

console.log(`Total time: ${totalDuration.toFixed(2)}ms`);

console.log(settings.get("Message"));
console.log(settings.get("PerformanceTest_Key1"));
console.log(settings.get("KeyVaultReference_Secret1"));