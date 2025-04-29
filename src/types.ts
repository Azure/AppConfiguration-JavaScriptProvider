// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * SettingSelector is used to select key-values from Azure App Configuration based on keys and labels.
 */
export type SettingSelector = {
    /**
     * The key filter to apply when querying Azure App Configuration for key-values.
     *
     * @remarks
     * An asterisk `*` can be added to the end to return all key-values whose key begins with the key filter.
     * e.g. key filter `abc*` returns all key-values whose key starts with `abc`.
     * A comma `,` can be used to select multiple key-values. Comma separated filters must exactly match a key to select it.
     * Using asterisk to select key-values that begin with a key filter while simultaneously using comma separated key filters is not supported.
     * E.g. the key filter `abc*,def` is not supported. The key filters `abc*` and `abc,def` are supported.
     * For all other cases the characters: asterisk `*`, comma `,`, and backslash `\` are reserved. Reserved characters must be escaped using a backslash (\).
     * e.g. the key filter `a\\b\,\*c*` returns all key-values whose key starts with `a\b,*c`.
     */
    keyFilter?: string,

    /**
     * The label filter to apply when querying Azure App Configuration for key-values.
     *
     * @remarks
     * The characters asterisk `*` and comma `,` are not supported.
     * Backslash `\` character is reserved and must be escaped using another backslash `\`.
     *
     * @defaultValue `LabelFilter.Null`, matching key-values without a label.
     */
    labelFilter?: string

    /**
     * The tag filter to apply when querying Azure App Configuration for key-values.
     *
     * @remarks
     * Each tag filter must follow the format "tagName=tagValue". Only those key-values will be loaded whose tags match all the tags provided here.
     * Built in tag filter value is `TagFilter.Null`, which indicates the tag has no value. For example, `tagName=${TagFilter.Null}` will match all key-values with the tag "tagName" that has no value.
     * Up to 5 tag filters can be provided. If no tag filters are provided, key-values will not be filtered based on tags.
     */
    tagFilters?: string[]

    /**
     * The name of snapshot to load from App Configuration.
     *
     * @remarks
     * Snapshot is a set of key-values selected from the App Configuration store based on the composition type and filters. Once created, it is stored as an immutable entity that can be referenced by name.
     * If snapshot name is used in a selector, no key and label filter should be used for it. Otherwise, an exception will be thrown.
     */
    snapshotName?: string
};

/**
 * KeyFilter is used to filter key-values based on keys.
 */
export enum KeyFilter {
    /**
     * Matches all key-values.
     */
    Any = "*"
}

/**
 * LabelFilter is used to filter key-values based on labels.
 */
export enum LabelFilter {
    /**
     * Matches key-values without a label.
     */
    Null = "\0"
}

/**
 * TagFilter is used to filter key-values based on tags.
 */
export enum TagFilter {
    /**
     * Matches key-values without a label.
     */
    Null = ""
}
