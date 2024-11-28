// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export class Lock {
    #locked = false;

    async execute(fn) {
        if (this.#locked) {
            return; // do nothing
        }
        this.#locked = true;
        try {
            await fn();
        } finally {
            this.#locked = false;
        }
    }
}
