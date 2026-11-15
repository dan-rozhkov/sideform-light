/** Plural variants, picked by `Intl.PluralRules` from the `count` param. `other` is required. */
export type PluralForms = {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
};

export type Message = string | PluralForms;

/**
 * The shape a translation of an English namespace must have: exactly the same keys, a string where
 * English has a string and plural forms where English has plural forms. Missing or extra keys fail
 * `tsc`, so no language can fall behind English.
 */
export type Translation<T> = { [K in keyof T]: T[K] extends string ? string : PluralForms };

export type MessageParams = Record<string, string | number>;
