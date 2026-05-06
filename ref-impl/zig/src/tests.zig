const std = @import("std");
const testing = std.testing;
const value = @import("value.zig");
const Value = value.Value;
const Error = value.Error;
const dtxt_parser = @import("parser.zig");
const stringify = @import("stringify.zig");
const json = @import("json.zig");
const json_stringify = @import("json_stringify.zig");
const converter = @import("converter.zig");

const allocator = testing.allocator;

// ============ DTXT Parser Tests ============

test "parse: empty object" {
    var p = dtxt_parser.Parser.init(allocator, "{}");
    const result = try p.parse();
    defer result.deinit(allocator);
    try testing.expect(result == .Object);
    try testing.expectEqual(@as(usize, 0), result.Object.len);
}

test "parse: string value" {
    var p = dtxt_parser.Parser.init(allocator, "{ name: `hello` }");
    const result = try p.parse();
    defer result.deinit(allocator);
    const entry = result.Object[0];
    try testing.expect(std.mem.eql(u8, entry.key, "name"));
    try testing.expect(entry.value == .String);
    try testing.expect(std.mem.eql(u8, entry.value.String, "hello"));
}

test "parse: number value" {
    var p = dtxt_parser.Parser.init(allocator, "{ count: 42 }");
    const result = try p.parse();
    defer result.deinit(allocator);
    try testing.expectEqual(@as(f64, 42.0), result.Object[0].value.Number);
}

test "parse: negative number" {
    var p = dtxt_parser.Parser.init(allocator, "{ val: -3.14 }");
    const result = try p.parse();
    defer result.deinit(allocator);
    try testing.expect(result.Object[0].value.Number < -3.13);
}

test "parse: boolean T and F" {
    var p = dtxt_parser.Parser.init(allocator, "{ a: T, b: F }");
    const result = try p.parse();
    defer result.deinit(allocator);
    try testing.expect(result.Object[0].value.Bool == true); // "a" sorts first
    try testing.expect(result.Object[1].value.Bool == false);
}

test "parse: null" {
    var p = dtxt_parser.Parser.init(allocator, "{ val: N }");
    const result = try p.parse();
    defer result.deinit(allocator);
    try testing.expect(result.Object[0].value == .Null);
}

test "parse: array" {
    var p = dtxt_parser.Parser.init(allocator, "{ items: [1, 2, 3] }");
    const result = try p.parse();
    defer result.deinit(allocator);
    const arr = result.Object[0].value.Array;
    try testing.expectEqual(@as(usize, 3), arr.len);
    try testing.expectEqual(@as(f64, 1.0), arr[0].Number);
    try testing.expectEqual(@as(f64, 2.0), arr[1].Number);
    try testing.expectEqual(@as(f64, 3.0), arr[2].Number);
}

test "parse: empty array" {
    var p = dtxt_parser.Parser.init(allocator, "{ items: [] }");
    const result = try p.parse();
    defer result.deinit(allocator);
    try testing.expectEqual(@as(usize, 0), result.Object[0].value.Array.len);
}

test "parse: nested object" {
    var p = dtxt_parser.Parser.init(allocator, "{ outer: { inner: `val` } }");
    const result = try p.parse();
    defer result.deinit(allocator);
    const inner = result.Object[0].value.Object;
    try testing.expectEqual(@as(usize, 1), inner.len);
    try testing.expect(std.mem.eql(u8, inner[0].key, "inner"));
    try testing.expect(std.mem.eql(u8, inner[0].value.String, "val"));
}

test "parse: Date constructor" {
    var p = dtxt_parser.Parser.init(allocator, "{ created: Date(2026-01-15T10:30:00Z) }");
    const result = try p.parse();
    defer result.deinit(allocator);
    try testing.expect(result.Object[0].value == .Date);
    try testing.expect(std.mem.eql(u8, result.Object[0].value.Date, "2026-01-15T10:30:00Z"));
}

test "parse: Date only" {
    var p = dtxt_parser.Parser.init(allocator, "{ date: Date(2026-01-15) }");
    const result = try p.parse();
    defer result.deinit(allocator);
    try testing.expect(std.mem.eql(u8, result.Object[0].value.Date, "2026-01-15"));
}

test "parse: BigNumber" {
    var p = dtxt_parser.Parser.init(allocator, "{ big: BigNumber(9007199254740993) }");
    const result = try p.parse();
    defer result.deinit(allocator);
    try testing.expect(result.Object[0].value == .BigNumber);
    try testing.expect(std.mem.eql(u8, result.Object[0].value.BigNumber, "9007199254740993"));
}

test "parse: Binary" {
    var p = dtxt_parser.Parser.init(allocator, "{ hash: Binary(A7B2319E44CE12BA) }");
    const result = try p.parse();
    defer result.deinit(allocator);
    try testing.expect(result.Object[0].value == .Binary);
    try testing.expect(std.mem.eql(u8, result.Object[0].value.Binary, "A7B2319E44CE12BA"));
}

test "parse: comments ignored" {
    const input =
        \\# comment
        \\{
        \\  name: `test`, # inline
        \\  # another
        \\  count: 42,
        \\}
    ;
    var p = dtxt_parser.Parser.init(allocator, input);
    const result = try p.parse();
    defer result.deinit(allocator);
    try testing.expectEqual(@as(usize, 2), result.Object.len);
}

test "parse: keys are sorted" {
    var p = dtxt_parser.Parser.init(allocator, "{ zebra: 1, apple: 2, mango: 3 }");
    const result = try p.parse();
    defer result.deinit(allocator);
    try testing.expect(std.mem.eql(u8, result.Object[0].key, "apple"));
    try testing.expect(std.mem.eql(u8, result.Object[1].key, "mango"));
    try testing.expect(std.mem.eql(u8, result.Object[2].key, "zebra"));
}

test "parse: trailing comma" {
    var p = dtxt_parser.Parser.init(allocator, "{ a: 1, b: 2, }");
    const result = try p.parse();
    defer result.deinit(allocator);
    try testing.expectEqual(@as(usize, 2), result.Object.len);
}

test "parse: interpreted string with escapes" {
    var p = dtxt_parser.Parser.init(allocator, "{ msg: \"hello\\nworld\" }");
    const result = try p.parse();
    defer result.deinit(allocator);
    try testing.expect(std.mem.eql(u8, result.Object[0].value.String, "hello\nworld"));
}

test "parse: invalid DTXT" {
    var p = dtxt_parser.Parser.init(allocator, "{ invalid }");
    try testing.expectError(Error.ExpectedColon, p.parse());
}

test "parse: duplicate key" {
    var p = dtxt_parser.Parser.init(allocator, "{ a: 1, a: 2 }");
    try testing.expectError(Error.DuplicateKey, p.parse());
}

test "parse: unknown constructor" {
    var p = dtxt_parser.Parser.init(allocator, "{ x: Foo(1) }");
    try testing.expectError(Error.UnknownConstructor, p.parse());
}

test "parse: nested arrays and objects" {
    const input =
        \\{
        \\  items: [
        \\    { id: 1, name: `one` },
        \\    { id: 2, name: `two` },
        \\  ],
        \\  meta: {
        \\    total: 2,
        \\  },
        \\}
    ;
    var p = dtxt_parser.Parser.init(allocator, input);
    const result = try p.parse();
    defer result.deinit(allocator);
    try testing.expectEqual(@as(usize, 2), result.Object[0].value.Array.len);
    try testing.expectEqual(@as(f64, 2.0), result.Object[1].value.Object[0].value.Number);
}

// ============ DTXT Stringifier Tests ============

test "stringify: basic types" {
    var p = dtxt_parser.Parser.init(allocator, "{ name: `hello`, count: 42, active: T }");
    const val = try p.parse();
    defer val.deinit(allocator);
    const result = try stringify.formatValue(val, allocator);
    defer allocator.free(result);
    try testing.expect(std.mem.indexOf(u8, result, "name:") != null);
    try testing.expect(std.mem.indexOf(u8, result, "`hello`") != null);
}

test "stringify: empty object" {
    const val = Value{ .Object = &.{} };
    const result = try stringify.stringifyMinified(val, allocator);
    defer allocator.free(result);
    try testing.expect(std.mem.eql(u8, result, "{}"));
}

test "stringify: minified" {
    var p = dtxt_parser.Parser.init(allocator, "{ a: 1, b: `test` }");
    const val = try p.parse();
    defer val.deinit(allocator);
    const result = try stringify.stringifyMinified(val, allocator);
    defer allocator.free(result);
    try testing.expect(std.mem.indexOf(u8, result, "{") != null);
    try testing.expect(std.mem.indexOf(u8, result, "}") != null);
}

test "stringify: Date constructor" {
    var p = dtxt_parser.Parser.init(allocator, "{ created: Date(2026-01-15) }");
    const val = try p.parse();
    defer val.deinit(allocator);
    const result = try stringify.stringifyMinified(val, allocator);
    defer allocator.free(result);
    try testing.expect(std.mem.indexOf(u8, result, "Date(2026-01-15)") != null);
}

// ============ JSON Parser Tests ============

test "json parse: basic types" {
    var p = json.JsonParser.init(allocator, "{\"name\": \"hello\", \"count\": 42, \"active\": true, \"disabled\": false, \"value\": null}");
    const result = try p.parse();
    defer result.deinit(allocator);
    try testing.expectEqual(@as(usize, 5), result.Object.len);
}

test "json parse: nested" {
    var p = json.JsonParser.init(allocator, "{\"outer\": {\"inner\": \"val\"}}");
    const result = try p.parse();
    defer result.deinit(allocator);
    try testing.expect(result.Object[0].value == .Object);
}

test "json parse: array" {
    var p = json.JsonParser.init(allocator, "{\"items\": [1, 2, 3]}");
    const result = try p.parse();
    defer result.deinit(allocator);
    try testing.expectEqual(@as(usize, 3), result.Object[0].value.Array.len);
}

// ============ JSON Stringifier Tests ============

test "json stringify: basic" {
    var p = dtxt_parser.Parser.init(allocator, "{ name: `hello`, count: 42 }");
    const result = try p.parse();
    defer result.deinit(allocator);
    const json_str = try json_stringify.stringifyJsonMinified(result, allocator);
    defer allocator.free(json_str);
    try testing.expect(std.mem.indexOf(u8, json_str, "\"name\"") != null);
    try testing.expect(std.mem.indexOf(u8, json_str, "42") != null);
}

// ============ Converter Tests ============

test "converter: json to dtxt" {
    const json_input = "{\"name\": \"test\", \"count\": 42}";
    const result = try converter.convert(allocator, json_input, .{
        .mode = .json_to_dtxt,
        .indent = "  ",
    });
    defer allocator.free(result);
    try testing.expect(std.mem.indexOf(u8, result, "name:") != null);
    try testing.expect(std.mem.indexOf(u8, result, "`test`") != null);
    try testing.expect(std.mem.indexOf(u8, result, "count: 42") != null);
}

test "converter: dtxt to json" {
    const dtxt_input = "{ name: `test`, count: 42 }";
    const result = try converter.convert(allocator, dtxt_input, .{
        .mode = .dtxt_to_json,
        .indent = "  ",
    });
    defer allocator.free(result);
    try testing.expect(std.mem.indexOf(u8, result, "\"name\"") != null);
    try testing.expect(std.mem.indexOf(u8, result, "\"test\"") != null);
}

test "converter: array root auto-wrap" {
    const json_input = "[1, 2, 3]";
    const result = try converter.convert(allocator, json_input, .{
        .mode = .json_to_dtxt,
        .indent = "  ",
    });
    defer allocator.free(result);
    try testing.expect(std.mem.indexOf(u8, result, "root:") != null);
}

test "converter: array root custom wrap key" {
    const json_input = "[1, 2, 3]";
    const result = try converter.convert(allocator, json_input, .{
        .mode = .json_to_dtxt,
        .indent = "  ",
        .wrap_key = "items",
    });
    defer allocator.free(result);
    try testing.expect(std.mem.indexOf(u8, result, "items:") != null);
}

test "converter: format DTXT" {
    const dtxt_input = "{name:`test`,count:42}";
    const result = try converter.convert(allocator, dtxt_input, .{
        .mode = .format,
        .indent = "  ",
    });
    defer allocator.free(result);
    try testing.expect(std.mem.indexOf(u8, result, "\n") != null);
}

test "converter: minify DTXT" {
    const dtxt_input = "{\n  name: `test`,\n  count: 42,\n}";
    const result = try converter.convert(allocator, dtxt_input, .{
        .mode = .format,
        .indent = null,
    });
    defer allocator.free(result);
    try testing.expect(std.mem.indexOf(u8, result, "\n") == null);
}

test "converter: roundtrip json -> dtxt -> json" {
    const original = "{\"name\": \"test\", \"count\": 42, \"active\": true}";
    const dtxt = try converter.convert(allocator, original, .{
        .mode = .json_to_dtxt,
        .indent = "  ",
    });
    defer allocator.free(dtxt);

    try testing.expect(std.mem.indexOf(u8, dtxt, "name:") != null);
    try testing.expect(std.mem.indexOf(u8, dtxt, "`test`") != null);
    try testing.expect(std.mem.indexOf(u8, dtxt, "count: 42") != null);

    const back_to_json = try converter.convert(allocator, dtxt, .{
        .mode = .dtxt_to_json,
        .indent = "  ",
    });
    defer allocator.free(back_to_json);

    try testing.expect(std.mem.indexOf(u8, back_to_json, "\"name\"") != null);
    try testing.expect(std.mem.indexOf(u8, back_to_json, "\"test\"") != null);
    try testing.expect(std.mem.indexOf(u8, back_to_json, "\"count\"") != null);
}

test "iso date detection" {
    try testing.expect(converter.detectIsoDate("2026-01-15"));
    try testing.expect(converter.detectIsoDate("2026-01-15T10:30:00Z"));
    try testing.expect(converter.detectIsoDate("2026-01-15T10:30:00.123Z"));
    try testing.expect(converter.detectIsoDate("2026-01-15T10:30:00+05:30"));
    try testing.expect(!converter.detectIsoDate("not a date"));
    try testing.expect(!converter.detectIsoDate("hello"));
}
