/**
 * The STF data model (spec §3): eleven mutually distinct kinds.
 *
 * Spec §3.1 forbids representing a typed value as a string carrying a marker prefix, so
 * `Decimal`, `Date`, and `Timestamp` are classes, `BigInt` is the JavaScript primitive, and
 * `Binary` is a `Uint8Array`. None of them can be confused with a `string`.
 */

export type STFKind =
  | "Null"
  | "Boolean"
  | "Number"
  | "String"
  | "Array"
  | "Object"
  | "BigInt"
  | "Decimal"
  | "Date"
  | "Timestamp"
  | "Binary";

export type STFObject = { [key: string]: STFValue };

export type STFValue =
  | null
  | boolean
  | number
  | string
  | STFValue[]
  | STFObject
  | bigint
  | STFDecimal
  | STFDate
  | STFTimestamp
  | Uint8Array;

/**
 * Authored member order for an object.
 *
 * JavaScript objects reorder keys that look like array indices, so `{b: 1, 123: 2}` would
 * otherwise serialize with `123` first and break the round-trip that spec §11.2 requires.
 * The parser records the true order here and the serializer honours it. A plain object is
 * still what callers get, so property access stays ordinary.
 */
export const ORDER = Symbol.for("stf.order");

/** Creates an object that remembers the order its keys were added in. */
export function makeObject(entries: Array<[string, STFValue]>): STFObject {
  const object: STFObject = {};
  for (const [key, value] of entries) object[key] = value;
  Object.defineProperty(object, ORDER, {
    value: entries.map(([key]) => key),
    enumerable: false,
    writable: true,
    configurable: true,
  });
  return object;
}

/** The authored key order if it was recorded, otherwise the host's own order. */
export function keysOf(object: STFObject): string[] {
  const recorded = (object as Record<symbol, unknown>)[ORDER];
  if (Array.isArray(recorded)) {
    // Guard against a caller having added or deleted keys after parsing.
    const own = Object.keys(object);
    if (recorded.length === own.length && recorded.every((k) => k in object)) {
      return recorded as string[];
    }
  }
  return Object.keys(object);
}

/**
 * An exact signed decimal: a coefficient and a scale (spec §10.2).
 *
 * `DECIMAL(1.5)` and `DECIMAL(1.50)` are distinct values, so the scale is data. The sign is
 * dropped when the coefficient is zero, since zero has one mathematical value.
 */
export class STFDecimal {
  readonly negative: boolean;
  readonly coefficient: bigint;
  readonly scale: number;

  constructor(negative: boolean, coefficient: bigint, scale: number) {
    this.negative = negative && coefficient !== 0n;
    this.coefficient = coefficient;
    this.scale = scale;
  }

  /** The canonical payload text, reproducing the authored spelling exactly. */
  get payload(): string {
    const digits = this.coefficient.toString();
    const sign = this.negative ? "-" : "";
    if (this.scale === 0) return sign + digits;
    if (digits.length > this.scale) {
      const cut = digits.length - this.scale;
      return `${sign}${digits.slice(0, cut)}.${digits.slice(cut)}`;
    }
    return `${sign}0.${digits.padStart(this.scale, "0")}`;
  }

  /** Scale-sensitive equality (spec §3.2): coefficient *and* scale must match. */
  equals(other: unknown): boolean {
    return (
      other instanceof STFDecimal &&
      other.negative === this.negative &&
      other.coefficient === this.coefficient &&
      other.scale === this.scale
    );
  }

  toString(): string {
    return this.payload;
  }
}

/** A wall date with no time and no offset (spec §10.4). */
export class STFDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;

  constructor(year: number, month: number, day: number) {
    this.year = year;
    this.month = month;
    this.day = day;
  }

  get payload(): string {
    return `${pad(this.year, 4)}-${pad(this.month, 2)}-${pad(this.day, 2)}`;
  }

  equals(other: unknown): boolean {
    return (
      other instanceof STFDate &&
      other.year === this.year &&
      other.month === this.month &&
      other.day === this.day
    );
  }

  toString(): string {
    return this.payload;
  }
}

/**
 * The zone designator of a timestamp. `Z` stays distinct from `+00:00`, because spec §3.2
 * makes the offset spelling preserved data.
 */
export type STFOffset =
  | { kind: "utc" }
  | { kind: "fixed"; negative: boolean; hours: number; minutes: number };

export function offsetText(offset: STFOffset): string {
  if (offset.kind === "utc") return "Z";
  return `${offset.negative ? "-" : "+"}${pad(offset.hours, 2)}:${pad(offset.minutes, 2)}`;
}

/**
 * An absolute instant with a mandatory UTC offset (spec §10.4).
 *
 * Fractional-second digits are kept as text because trailing zeros are data: `.100` ≠ `.1`.
 */
export class STFTimestamp {
  readonly date: STFDate;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly fraction: string | null;
  readonly offset: STFOffset;

  constructor(
    date: STFDate,
    hour: number,
    minute: number,
    second: number,
    fraction: string | null,
    offset: STFOffset,
  ) {
    this.date = date;
    this.hour = hour;
    this.minute = minute;
    this.second = second;
    this.fraction = fraction;
    this.offset = offset;
  }

  get payload(): string {
    const time = `${pad(this.hour, 2)}:${pad(this.minute, 2)}:${pad(this.second, 2)}`;
    const frac = this.fraction === null ? "" : `.${this.fraction}`;
    return `${this.date.payload}T${time}${frac}${offsetText(this.offset)}`;
  }

  equals(other: unknown): boolean {
    if (!(other instanceof STFTimestamp)) return false;
    return this.payload === other.payload && this.date.equals(other.date);
  }

  toString(): string {
    return this.payload;
  }
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/** A document-level directive (spec §5.1). Metadata, not data. */
export interface STFDirective {
  name: string;
  payload: string;
}

/** A parsed document: its directives plus its root object. */
export interface STFDocument {
  directives: STFDirective[];
  root: STFObject;
}

export function kindOf(value: STFValue): STFKind {
  if (value === null) return "Null";
  switch (typeof value) {
    case "boolean":
      return "Boolean";
    case "number":
      return "Number";
    case "string":
      return "String";
    case "bigint":
      return "BigInt";
  }
  if (Array.isArray(value)) return "Array";
  if (value instanceof Uint8Array) return "Binary";
  if (value instanceof STFDecimal) return "Decimal";
  if (value instanceof STFTimestamp) return "Timestamp";
  if (value instanceof STFDate) return "Date";
  return "Object";
}

/**
 * Value equality per spec §3.2.
 *
 * Kinds never cross-compare, Numbers use `Object.is` so `-0 ≠ 0`, Decimals are
 * scale-sensitive, Binary compares octets, and object member order is ignored.
 */
export function equals(a: STFValue, b: STFValue): boolean {
  const kind = kindOf(a);
  if (kind !== kindOf(b)) return false;

  switch (kind) {
    case "Null":
      return true;
    case "Boolean":
    case "String":
    case "BigInt":
      return a === b;
    case "Number":
      // Object.is keeps -0 distinct from 0; NaN cannot occur (§7.3).
      return Object.is(a, b);
    case "Decimal":
      return (a as STFDecimal).equals(b);
    case "Date":
      return (a as STFDate).equals(b);
    case "Timestamp":
      return (a as STFTimestamp).equals(b);
    case "Binary": {
      const x = a as Uint8Array;
      const y = b as Uint8Array;
      if (x.length !== y.length) return false;
      for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
      return true;
    }
    case "Array": {
      const x = a as STFValue[];
      const y = b as STFValue[];
      if (x.length !== y.length) return false;
      for (let i = 0; i < x.length; i++) if (!equals(x[i], y[i])) return false;
      return true;
    }
    case "Object": {
      const x = a as STFObject;
      const y = b as STFObject;
      const xk = Object.keys(x);
      if (xk.length !== Object.keys(y).length) return false;
      for (const key of xk) {
        if (!Object.prototype.hasOwnProperty.call(y, key)) return false;
        if (!equals(x[key], y[key])) return false;
      }
      return true;
    }
  }
}
