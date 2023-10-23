// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { AzureAppConfigurationOptions } from "../AzureAppConfigurationOptions";
import {
    AzureFunctionEnvironmentVariable,
    AzureWebAppEnvironmentVariable,
    ContainerAppEnvironmentVariable,
    DevEnvironmentValue,
    EnvironmentKey,
    HostType,
    HostTypeKey,
    KeyVaultConfiguredTag,
    KubernetesEnvironmentVariable,
    NodeJSDevEnvironmentVariableValue,
    NodeJSEnvironmentVariable,
    RequestTracingDisabledEnvironmentVariable,
    RequestType,
    RequestTypeKey,
    ServiceFabricEnvironmentVariable
} from "./constants";

// Utils
export function createCorrelationContextHeader(options: AzureAppConfigurationOptions | undefined, requestType: RequestType): string {
    /*
    RequestType: 'Startup' during application starting up, 'Watch' after startup completed.
    Host: identify with defined envs
    Env: identify by env `NODE_ENV` which is a popular but not standard.usually the value can be "development", "production".
    UsersKeyVault
    */
    const keyValues = new Map<string, string | undefined>();
    keyValues.set(RequestTypeKey, requestType);
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

export function requestTracingEnabled(): boolean {
    const requestTracingDisabledEnv = getEnvironmentVariable(RequestTracingDisabledEnvironmentVariable);
    const disabled = requestTracingDisabledEnv?.toLowerCase() === "true";
    return !disabled;
}

function getEnvironmentVariable(name: string) {
    // Make it compatible with non-Node.js runtime
    if (typeof process?.env === "object") {
        return process.env[name];
    } else {
        return undefined;
    }
}

function getHostType(): string | undefined {
    let hostType: string | undefined;
    if (getEnvironmentVariable(AzureFunctionEnvironmentVariable)) {
        hostType = HostType.AzureFunction;
    } else if (getEnvironmentVariable(AzureWebAppEnvironmentVariable)) {
        hostType = HostType.AzureWebApp;
    } else if (getEnvironmentVariable(ContainerAppEnvironmentVariable)) {
        hostType = HostType.ContainerApp;
    } else if (getEnvironmentVariable(KubernetesEnvironmentVariable)) {
        hostType = HostType.Kubernetes;
    } else if (getEnvironmentVariable(ServiceFabricEnvironmentVariable)) {
        hostType = HostType.ServiceFabric;
    } else if (isBrowser()) {
        hostType = HostType.Browser;
    } else if (isWebWorker()) {
        hostType = HostType.WebWorker;
    }
    return hostType;
}

function isDevEnvironment(): boolean {
    const envType = getEnvironmentVariable(NodeJSEnvironmentVariable);
    if (NodeJSDevEnvironmentVariableValue === envType?.toLowerCase()) {
        return true;
    }
    return false;
}

function isBrowser() {
    // https://developer.mozilla.org/en-US/docs/Web/API/Window
    const isWindowDefinedAsExpected = typeof window === "object" && typeof Window === "function" && window instanceof Window;
    // https://developer.mozilla.org/en-US/docs/Web/API/Document
    const isDocumentDefinedAsExpected = typeof document === "object" && typeof Document === "function" && document instanceof Document;

    return isWindowDefinedAsExpected && isDocumentDefinedAsExpected;
}

function isWebWorker() {
    // https://developer.mozilla.org/en-US/docs/Web/API/WorkerGlobalScope
    const workerGlobalScopeDefined = typeof WorkerGlobalScope !== "undefined";
    // https://developer.mozilla.org/en-US/docs/Web/API/WorkerNavigator
    const isNavigatorDefinedAsExpected = typeof navigator === "object" && typeof WorkerNavigator !== "function" && navigator instanceof WorkerNavigator;
    // https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers#importing_scripts_and_libraries
    const importScriptsAsGlobalFunction = typeof importScripts === "function";

    return workerGlobalScopeDefined && importScriptsAsGlobalFunction && isNavigatorDefinedAsExpected;
}