// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as dotenv from "dotenv";
dotenv.config()

import { load } from "@azure/app-configuration-provider";
const connectionString = process.env.APPCONFIG_CONNECTION_STRING;
const appConfig = await load(connectionString, {
    refreshOptions: {
        enabled: true,
        refreshIntervalInMs: 5_000
    }
});

appConfig.onRefresh(() => {
    console.log("Configuration has been refreshed.");
});

import express from "express";

const server = express();
const PORT = 3000;

server.use(express.json());

// Use a middleware to achieve request-driven configuration refresh
server.use((req, res, next) => {
    // this call s not blocking, the configuration will be updated asynchronously
    appConfig.refresh();
    next();
});

server.get("/", (req, res) => {
    res.send("Please go to /config to get the configuration.");
});

server.get("/config", (req, res) => {
    res.json(appConfig.constructConfigurationObject());
});

server.get("/config/:key", (req, res) => {
    res.json(appConfig.get(req.params.key) ?? "");
});

server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
