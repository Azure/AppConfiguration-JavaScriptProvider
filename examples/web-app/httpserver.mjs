// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as dotenv from "dotenv";
dotenv.config()

import { load } from "@azure/app-configuration-provider";
import { DefaultAzureCredential } from "@azure/identity";
const endpoint = process.env.APPCONFIG_ENDPOINT;
const credential = new DefaultAzureCredential();
const appConfig = await load(endpoint, credential, {
    refreshOptions: {
        enabled: true,
        // By default, the refresh interval is 30 seconds. You can change it by setting refreshIntervalInMs.
    },
    keyVaultOptions:{
        credential: credential
    }
});
let config = appConfig.constructConfigurationObject();

appConfig.onRefresh(() => {
    config = appConfig.constructConfigurationObject();
});

import express from "express";

const server = express();
const PORT = 3000;

server.use(express.json());

// Use a middleware to achieve request-driven configuration refresh
// For more information, please go to dynamic refresh tutorial: https://learn.microsoft.com/azure/azure-app-configuration/enable-dynamic-configuration-javascript
server.use((req, res, next) => {
    // this call is not blocking, the configuration will be updated asynchronously
    appConfig.refresh();
    next();
});

server.get("/", (req, res) => {
    res.send(`Message from Azure App Configuration: ${config.message}`);
});

server.get("/config", (req, res) => {
    res.json(config);
});

server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
