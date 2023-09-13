// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { PipelinePolicy, PipelineRequest, PipelineResponse, SendRequest } from '@azure/core-rest-pipeline';
import { AzureAppConfigurationOptions } from './AzureAppConfigurationOptions';
import {
    AzureFunctionEnvironmentVariable,
    AzureWebAppEnvironmentVariable,
    ContainerAppEnvironmentVariable,
    CorrelationContextHeaderName,
    DevEnvironmentValue,
    EnvironmentKey,
    HostType,
    HostTypeKey,
    KeyVaultConfiguredTag,
    KubernetesEnvironmentVariable,
    NodeJSEnvironmentVariable,
    RequestType,
    RequestTypeKey,
    ServiceFabricEnvironmentVariable
} from './RequestTracing';

export class CorrelationContextPolicy implements PipelinePolicy {
    constructor(private options: AzureAppConfigurationOptions | undefined) {
    }

    name: string = "CorrelationContextPolicy";

    sendRequest(request: PipelineRequest, next: SendRequest): Promise<PipelineResponse> {
        request.headers.set(CorrelationContextHeaderName, this.createCorrelationContextHeader());
        return next(request);
    }

    createCorrelationContextHeader(): string {
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
        if (this.options?.keyVaultOptions) {
            const { credential, secretClients, secretResolver } = this.options.keyVaultOptions;
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
    if ("development" === envType?.toLowerCase()) {
        return true;
    }
    return false;
}
