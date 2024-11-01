// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { AppConfigurationClient, AppConfigurationClientOptions } from "@azure/app-configuration";
import { ConfigurationClientWrapper } from "./ConfigurationClientWrapper";
import { TokenCredential } from "@azure/identity";
import { AzureAppConfigurationOptions, MaxRetries, MaxRetryDelayInMs } from "./AzureAppConfigurationOptions";
import { isFailoverableEnv } from "./requestTracing/utils";
import * as RequestTracing from "./requestTracing/constants";

const TCP_ORIGIN_KEY_NAME = "_origin._tcp";
const ALT_KEY_NAME = "_alt";
const TCP_KEY_NAME = "_tcp";
const Endpoint_KEY_NAME = "Endpoint";
const Id_KEY_NAME = "Id";
const Secret_KEY_NAME = "Secret";
const ConnectionStringRegex = /Endpoint=(.*);Id=(.*);Secret=(.*)/;
const AzConfigDomainLabel = ".azconfig.";
const AppConfigDomainLabel = ".appconfig.";
const FallbackClientRefreshExpireInterval = 60 * 60 * 1000; // 1 hour in milliseconds
const MinimalClientRefreshInterval = 30 * 1000; // 30 seconds in milliseconds
const SrvQueryTimeout = 5* 1000; // 5 seconds in milliseconds

export class ConfigurationClientManager {
    isFailoverable: boolean;
    endpoint: string;
    #secret : string;
    #id : string;
    #credential: TokenCredential;
    #clientOptions: AppConfigurationClientOptions | undefined;
    #validDomain: string;
    #staticClients: ConfigurationClientWrapper[];
    #dynamicClients: ConfigurationClientWrapper[];
    #lastFallbackClientRefreshTime: number = 0;
    #lastFallbackClientRefreshAttempt: number = 0;

    constructor (
        connectionStringOrEndpoint?: string | URL,
        credentialOrOptions?: TokenCredential | AzureAppConfigurationOptions,
        appConfigOptions?: AzureAppConfigurationOptions
    ) {
        let staticClient: AppConfigurationClient;
        let options: AzureAppConfigurationOptions | undefined;

        if (typeof connectionStringOrEndpoint === "string" && !instanceOfTokenCredential(credentialOrOptions)) {
            const connectionString = connectionStringOrEndpoint;
            options = credentialOrOptions as AzureAppConfigurationOptions;
            this.#clientOptions = getClientOptions(options);
            staticClient = new AppConfigurationClient(connectionString, this.#clientOptions);
            const regexMatch = connectionString.match(ConnectionStringRegex);
            if (regexMatch) {
                this.endpoint = regexMatch[1];
                this.#id = regexMatch[2];
                this.#secret = regexMatch[3];
            } else {
                throw new Error(`Invalid connection string. Valid connection strings should match the regex '${ConnectionStringRegex.source}'.`);
            }
        } else if ((connectionStringOrEndpoint instanceof URL || typeof connectionStringOrEndpoint === "string") && instanceOfTokenCredential(credentialOrOptions)) {
            let endpoint = connectionStringOrEndpoint;
            // ensure string is a valid URL.
            if (typeof endpoint === "string") {
                try {
                    endpoint = new URL(endpoint);
                } catch (error) {
                    if (error.code === "ERR_INVALID_URL") {
                        throw new Error("Invalid endpoint URL.", { cause: error });
                    } else {
                        throw error;
                    }
                }
            }

            const credential = credentialOrOptions as TokenCredential;
            options = appConfigOptions as AzureAppConfigurationOptions;
            this.#clientOptions = getClientOptions(options);
            staticClient = new AppConfigurationClient(connectionStringOrEndpoint.toString(), credential, this.#clientOptions);
            this.endpoint = endpoint.toString();
            this.#credential = credential;
        } else {
            throw new Error("A connection string or an endpoint with credential must be specified to create a client.");
        }

        this.#staticClients = [new ConfigurationClientWrapper(this.endpoint, staticClient)];
        this.#validDomain = getValidDomain(this.endpoint);
        this.isFailoverable = (options?.replicaDiscoveryEnabled ?? true) && isFailoverableEnv();
    }

    async getClients() : Promise<ConfigurationClientWrapper[]> {
        if (!this.isFailoverable) {
            return this.#staticClients;
        }

        const currentTime = Date.now();
        if (this.#isFallbackClientDiscoveryDue(currentTime)) {
            this.#lastFallbackClientRefreshAttempt = currentTime;
            const host = new URL(this.endpoint).hostname;
            await this.#discoverFallbackClients(host);
        }

        // Filter static clients whose backoff time has ended
        let availableClients = this.#staticClients.filter(client => client.backoffEndTime <= currentTime);
        // If there are dynamic clients, filter and concatenate them
        if (this.#dynamicClients && this.#dynamicClients.length > 0) {
            availableClients = availableClients.concat(
                this.#dynamicClients
                    .filter(client => client.backoffEndTime <= currentTime));
        }

        return availableClients;
    }

    async refreshClients() {
        const currentTime = Date.now();
        if (this.isFailoverable &&
            currentTime > new Date(this.#lastFallbackClientRefreshAttempt + MinimalClientRefreshInterval).getTime()) {
            this.#lastFallbackClientRefreshAttempt = currentTime;
            const host = new URL(this.endpoint).hostname;
            await this.#discoverFallbackClients(host);
        }
    }

    async #discoverFallbackClients(host) {
        const timeout = setTimeout(() => {
        }, SrvQueryTimeout);
        const srvResults = await querySrvTargetHost(host);

        try {
            const result = await Promise.race([srvResults, timeout]);

            if (result === timeout) {
                throw new Error("SRV record query timed out.");
            }

            const srvTargetHosts = result as string[];
            // Shuffle the list of SRV target hosts
            for (let i = srvTargetHosts.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [srvTargetHosts[i], srvTargetHosts[j]] = [srvTargetHosts[j], srvTargetHosts[i]];
            }

            const newDynamicClients: ConfigurationClientWrapper[] = [];
            for (const host of srvTargetHosts) {
                if (isValidEndpoint(host, this.#validDomain)) {
                    const targetEndpoint = `https://${host}`;
                    if (targetEndpoint.toLowerCase() === this.endpoint.toLowerCase()) {
                        continue;
                    }
                    const client = this.#newConfigurationClient(targetEndpoint);
                    newDynamicClients.push(new ConfigurationClientWrapper(targetEndpoint, client));
                }
            }

            this.#dynamicClients = newDynamicClients;
            this.#lastFallbackClientRefreshTime = Date.now();
        } catch (err) {
            console.warn(`Fail to build fallback clients, ${err.message}`);
        }
    }

    #newConfigurationClient(endpoint) {
        if (this.#credential) {
            return new AppConfigurationClient(endpoint, this.#credential, this.#clientOptions);
        }

        const connectionStr = buildConnectionString(endpoint, this.#secret, this.#id);
        return new AppConfigurationClient(connectionStr, this.#clientOptions);
    }

    #isFallbackClientDiscoveryDue(dateTime) {
        return dateTime >= this.#lastFallbackClientRefreshAttempt + MinimalClientRefreshInterval
            && (!this.#dynamicClients
                || this.#dynamicClients.every(client => dateTime < client.backoffEndTime)
                || dateTime >= this.#lastFallbackClientRefreshTime + FallbackClientRefreshExpireInterval);
    }
}

/**
 * Query SRV records and return target hosts.
 */
async function querySrvTargetHost(host: string): Promise<string[]> {
    const results: string[] = [];
    let dns;

    if (isFailoverableEnv()) {
        dns = require("dns/promises");
    } else {
        throw new Error("Failover is not supported in the current environment.");
    }

    try {
        // Look up SRV records for the origin host
        const originRecords = await dns.resolveSrv(`${TCP_ORIGIN_KEY_NAME}.${host}`);
        if (originRecords.length === 0) {
            return results;
        }

        // Add the first origin record to results
        const originHost = originRecords[0].name;
        results.push(originHost);

        // Look up SRV records for alternate hosts
        let index = 0;
        let moreAltRecordsExist = true;
        while (moreAltRecordsExist) {
            const currentAlt = `${ALT_KEY_NAME}${index}`;
            try {
                const altRecords = await dns.resolveSrv(`${currentAlt}.${TCP_KEY_NAME}.${originHost}`);
                if (altRecords.length === 0) {
                    moreAltRecordsExist = false;
                    break; // No more alternate records, exit loop
                }

                altRecords.forEach(record => {
                    const altHost = record.name;
                    if (altHost) {
                        results.push(altHost);
                    }
                });
                index++;
            } catch (err) {
                if (err.code === "ENOTFOUND") {
                    break; // No more alternate records, exit loop
                } else {
                    throw new Error(`Failed to lookup alternate SRV records: ${err.message}`);
                }
            }
        }
    } catch (err) {
        if (err.code === "ENOTFOUND") {
            return results; // No SRV records found, return empty array
        } else {
            throw new Error(`Failed to lookup SRV records: ${err.message}`);
        }
    }

    return results;
}

/**
 * Builds a connection string from the given endpoint, secret, and id.
 * Returns an empty string if either secret or id is empty.
 */
function buildConnectionString(endpoint, secret, id: string): string {
    if (!secret || !id) {
        return "";
    }

    return `${Endpoint_KEY_NAME}=${endpoint};${Id_KEY_NAME}=${id};${Secret_KEY_NAME}=${secret}`;
}

/**
 * Extracts a valid domain from the given endpoint URL based on trusted domain labels.
 */
export function getValidDomain(endpoint: string): string {
    try {
        const url = new URL(endpoint);
        const trustedDomainLabels = [AzConfigDomainLabel, AppConfigDomainLabel];
        const host = url.hostname.toLowerCase();

        for (const label of trustedDomainLabels) {
            const index = host.lastIndexOf(label);
            if (index !== -1) {
                return host.substring(index);
            }
        }
    } catch (error) {
        console.error("Error parsing URL:", error.message);
    }

    return "";
}

/**
 * Checks if the given host ends with the valid domain.
 */
export function isValidEndpoint(host: string, validDomain: string): boolean {
    if (!validDomain) {
        return false;
    }

    return host.toLowerCase().endsWith(validDomain.toLowerCase());
}

export function getClientOptions(options?: AzureAppConfigurationOptions): AppConfigurationClientOptions | undefined {
    // user-agent
    let userAgentPrefix = RequestTracing.USER_AGENT_PREFIX; // Default UA for JavaScript Provider
    const userAgentOptions = options?.clientOptions?.userAgentOptions;
    if (userAgentOptions?.userAgentPrefix) {
        userAgentPrefix = `${userAgentOptions.userAgentPrefix} ${userAgentPrefix}`; // Prepend if UA prefix specified by user
    }

    // retry options
    const defaultRetryOptions = {
        maxRetries: MaxRetries,
        maxRetryDelayInMs: MaxRetryDelayInMs,
    };
    const retryOptions = Object.assign({}, defaultRetryOptions, options?.clientOptions?.retryOptions);

    return Object.assign({}, options?.clientOptions, {
        retryOptions,
        userAgentOptions: {
            userAgentPrefix
        }
    });
}

export function instanceOfTokenCredential(obj: unknown) {
    return obj && typeof obj === "object" && "getToken" in obj && typeof obj.getToken === "function";
}

