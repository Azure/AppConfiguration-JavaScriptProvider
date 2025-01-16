// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as dotenv from "dotenv";
dotenv.config()

import { load } from "@azure/app-configuration-provider";
const connectionString = process.env.APPCONFIG_CONNECTION_STRING;
const appConfig = await load(connectionString, {
    refreshOptions: {
        enabled: true
    }
});

appConfig.onRefresh(() => {
    console.log("Configuration has been refreshed.");
});

import express from "express";

const app = express();
const PORT = 3000;

app.use(express.json());

app.get("/", (req, res) => {
    appConfig.refresh();
    res.send("Please go to /config to get the configuration.");
});

app.get("/config", (req, res) => {
    appConfig.refresh();
    res.json(appConfig.constructConfigurationObject());
});

app.get("/config/:key", (req, res) => {
    appConfig.refresh();
    res.json(appConfig.get(req.params.key) ?? "");
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
