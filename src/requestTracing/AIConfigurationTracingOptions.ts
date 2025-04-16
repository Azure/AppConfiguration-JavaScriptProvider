// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export class AIConfigurationTracingOptions {
    usesAIConfiguration: boolean = false;
    usesAIChatCompletionConfiguration: boolean = false;

    reset(): void {
        this.usesAIConfiguration = false;
        this.usesAIChatCompletionConfiguration = false;
    }
}
