// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { AzureAppConfigurationOptions } from "../AzureAppConfigurationOptions";
import * as Constants from "./constants";

// Utils
export function createCorrelationContextHeader(options: AzureAppConfigurationOptions | undefined): string {
    /*
    RequestType: 'Startup' during application starting up, 'Watch' after startup completed.
    Host: identify with defined envs
    Env: identify by env `NODE_ENV` which is a popular but not standard.usually the value can be "development", "production".
    UsersKeyVault
    */
    const keyValues = new Map<string, string | undefined>();
    keyValues.set(Constants.RequestTypeKey, Constants.RequestType.Startup); // TODO: now always "Startup", until refresh is supported.
    keyValues.set(Constants.HostTypeKey, getHostType());
    keyValues.set(Constants.EnvironmentKey, isDevEnvironment() ? Constants.DevEnvironmentValue : undefined);

    const tags: string[] = [];
    if (options?.keyVaultOptions) {
        const { credential, secretClients, secretResolver } = options.keyVaultOptions;
        if (credential !== undefined || secretClients?.length || secretResolver !== undefined) {
            tags.push(Constants.KeyVaultConfiguredTag);
        }
    }

    const contextParts: string[] = [];
    for (const [k, v] of keyValues) {
        if (v !== undefined) {
            contextParts.push(`${k}=${v}`);
        }
    }
    for (const tag of tags) {
        contextParts.push(tag);
    }

    return contextParts.join(",");
}

function getHostType(): string | undefined {
    let hostType: string | undefined;
    if (process.env[Constants.AzureFunctionEnvironmentVariable]) {
        hostType = Constants.HostType.AzureFunction;
    } else if (process.env[Constants.AzureWebAppEnvironmentVariable]) {
        hostType = Constants.HostType.AzureWebApp;
    } else if (process.env[Constants.ContainerAppEnvironmentVariable]) {
        hostType = Constants.HostType.ContainerApp;
    } else if (process.env[Constants.KubernetesEnvironmentVariable]) {
        hostType = Constants.HostType.Kubernetes;
    } else if (process.env[Constants.ServiceFabricEnvironmentVariable]) {
        hostType = Constants.HostType.ServiceFabric;
    }
    return hostType;
}

function isDevEnvironment(): boolean {
    const envType = process.env[Constants.NodeJSEnvironmentVariable];
    if ("development" === envType?.toLowerCase()) {
        return true;
    }
    return false;
}