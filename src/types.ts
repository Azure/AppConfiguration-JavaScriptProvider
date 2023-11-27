// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * SettingSelector is used to select key-values from Azure App Configuration.
 * It is used to filter key-values based on keys and labels.
 * 
 * @property keyFilter:
 * The key filter to apply when querying Azure App Configuration for key-values.
 * An asterisk `*` can be added to the end to return all key-values whose key begins with the key filter.
 * e.g. key filter `abc*` returns all key-values whose key starts with `abc`.
 * A comma `,` can be used to select multiple key-values. Comma separated filters must exactly match a key to select it.
 * Using asterisk to select key-values that begin with a key filter while simultaneously using comma separated key filters is not supported.
 * E.g. the key filter `abc*,def` is not supported. The key filters `abc*` and `abc,def` are supported.
 * For all other cases the characters: asterisk `*`, comma `,`, and backslash `\` are reserved. Reserved characters must be escaped using a backslash (\).
 * e.g. the key filter `a\\b\,\*c*` returns all key-values whose key starts with `a\b,*c`.
 *
 * @property labelFilter:
 * The label filter to apply when querying Azure App Configuration for key-values.
 * By default, the "null label" will be used, matching key-values without a label.
 * The characters asterisk `*` and comma `,` are not supported.
 * Backslash `\` character is reserved and must be escaped using another backslash `\`.
 */
export type SettingSelector = { keyFilter: string, labelFilter?: string };
