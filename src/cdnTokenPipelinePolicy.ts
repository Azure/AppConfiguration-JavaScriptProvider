// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { PipelinePolicy } from "@azure/core-rest-pipeline";
import { getCryptoModule } from "./common/utils.js";

const CDN_TOKEN_QUERY_PARAMETER = "_";
const RESOURCE_DELETED_PREFIX = "ResourceDeleted";

export const CDN_TOKEN_LOOKUP_HEADER = "cdn-token-lookup";

/**
 * The pipeline policy that retrieves the CDN token from the request header and appends it to the request URL. After that the lookup header is removed from the request.
 * @remarks
 * The policy position should be perCall.
 * The App Configuration service will not recognize the CDN token query parameter in the url, but this can help to break the CDN cache as the cache entry is based on the URL.
 */
export class CdnTokenPipelinePolicy implements PipelinePolicy {
    name: string = "AppConfigurationCdnTokenPolicy";

    async sendRequest(request, next) {
        if (request.headers.has(CDN_TOKEN_LOOKUP_HEADER)) {
            const token = request.headers.get(CDN_TOKEN_LOOKUP_HEADER);
            request.headers.delete(CDN_TOKEN_LOOKUP_HEADER);

            const url = new URL(request.url);
            url.searchParams.append(CDN_TOKEN_QUERY_PARAMETER, token); // _ is a dummy query parameter to break the CDN cache
            request.url = url.toString();
        }

        return next(request);
    }
}

/**
 * Calculates a cache consistency token for a deleted resource based on its previous ETag.
 * @param etag - The previous ETag of the deleted resource.
 */
export async function calculateResourceDeletedCacheConsistencyToken(etag: string): Promise<string> {
    const crypto = getCryptoModule();
    const rawString = `${RESOURCE_DELETED_PREFIX}\n${etag}`;
    const payload = new TextEncoder().encode(rawString);
    // In the browser or Node.js 18+, use crypto.subtle.digest
    if (crypto.subtle) {
        const hashBuffer = await crypto.subtle.digest("SHA-256", payload);
        const hashArray = new Uint8Array(hashBuffer);
        const base64String = btoa(String.fromCharCode(...hashArray));
        const base64urlString = base64String.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        return base64urlString;
    }
    // Use the crypto module's hash function
    else {
        const hash = crypto.createHash("sha256").update(payload).digest();
        return hash.toString("base64url");
    }
}
