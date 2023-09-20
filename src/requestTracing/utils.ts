// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { AzureAppConfigurationOptions } from "../AzureAppConfigurationOptions";
import {
    AzureFunctionEnvironmentVariable,
    AzureWebAppEnvironmentVariable,
    ContainerAppEnvironmentVariable,
    DevEnvironmentValue,
    EnvironmentKey,
    HostType, HostTypeKey,
    KeyVaultConfiguredTag,
    KubernetesEnvironmentVariable,
    NodeJSDevEnvironmentVariableValue,
    NodeJSEnvironmentVariable,
    RequestType,
    RequestTypeKey,
    ServiceFabricEnvironmentVariable
} from "./constants";

// Utils
export function createCorrelationContextHeader(options: AzureAppConfigurationOptions | undefined): string {
    /*
    RequestType: 'Startup' during application starting up, 'Watch' after startup completed.
    Host: identify with defined envs
    Env: identify by env `NODE_ENV` which is a popular but not standard.usually the value can be "development", "production".
    UsersKeyVault
    */
    const keyValues = new Map<string, string | undefined>();
    keyValues.set(RequestTypeKey, RequestType.Startup); // TODO: now always "Startup", until refresh is supported.
    keyValues.set(HostTypeKey, getHostType());
    keyValues.set(EnvironmentKey, isDevEnvironment() ? DevEnvironmentValue : undefined);

    const tags: string[] = [];
    if (options?.keyVaultOptions) {
        const { credential, secretClients, secretResolver } = options.keyVaultOptions;
        if (credential !== undefined || secretClients?.length || secretResolver !== undefined) {
            tags.push(KeyVaultConfiguredTag);
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
    if (process.env[AzureFunctionEnvironmentVariable]) {
        hostType = HostType.AzureFunction;
    } else if (process.env[AzureWebAppEnvironmentVariable]) {
        hostType = HostType.AzureWebApp;
    } else if (process.env[ContainerAppEnvironmentVariable]) {
        hostType = HostType.ContainerApp;
    } else if (process.env[KubernetesEnvironmentVariable]) {
        hostType = HostType.Kubernetes;
    } else if (process.env[ServiceFabricEnvironmentVariable]) {
        hostType = HostType.ServiceFabric;
    }
    return hostType;
}

function isDevEnvironment(): boolean {
    const envType = process.env[NodeJSEnvironmentVariable];
    if (NodeJSDevEnvironmentVariableValue === envType?.toLowerCase()) {
        return true;
    }
    return false;
}