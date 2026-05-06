const std = @import("std");
const value = @import("value.zig");
const Value = value.Value;
const dtxt_parser = @import("parser.zig");
const stringify = @import("stringify.zig");
const json = @import("json.zig");
const json_stringify = @import("json_stringify.zig");

pub const Options = struct {
    mode: Mode = .json_to_dtxt,
    indent: ?[]const u8 = "  ",
    wrap_key: []const u8 = "root",
    no_wrap: bool = false,
};

pub const Mode = enum {
    json_to_dtxt,
    dtxt_to_json,
    format,
};

pub fn convert(
    allocator: std.mem.Allocator,
    input: []const u8,
    opts: Options,
) ![]const u8 {
    switch (opts.mode) {
        .json_to_dtxt => {
            var jp = json.JsonParser.init(allocator, input);
            var parsed = try jp.parse();
            defer parsed.deinit(allocator);
            if (shouldWrap(parsed)) {
                if (opts.no_wrap) return error.NonObjectRoot;
                var entries = std.ArrayList(Value.ObjectEntry).empty;
                defer entries.deinit(allocator);
                try entries.append(allocator, .{
                    .key = try allocator.dupe(u8, opts.wrap_key),
                    .value = try parsed.clone(allocator),
                });
                const wrapped = Value{ .Object = try entries.toOwnedSlice(allocator) };
                defer wrapped.deinit(allocator);
                if (opts.indent) |ind| {
                    return stringify.stringify(wrapped, allocator, ind);
                } else {
                    return stringify.stringifyMinified(wrapped, allocator);
                }
            } else {
                if (opts.indent) |ind| {
                    return stringify.stringify(parsed, allocator, ind);
                } else {
                    return stringify.stringifyMinified(parsed, allocator);
                }
            }
        },
        .dtxt_to_json => {
            var dp = dtxt_parser.Parser.init(allocator, input);
            const parsed = try dp.parse();
            defer parsed.deinit(allocator);
            if (opts.indent) |ind| {
                return json_stringify.stringifyJson(parsed, allocator, ind);
            } else {
                return json_stringify.stringifyJsonMinified(parsed, allocator);
            }
        },
        .format => {
            var dp = dtxt_parser.Parser.init(allocator, input);
            const parsed = try dp.parse();
            defer parsed.deinit(allocator);
            if (opts.indent) |ind| {
                return stringify.stringify(parsed, allocator, ind);
            } else {
                return stringify.stringifyMinified(parsed, allocator);
            }
        },
    }
}

fn shouldWrap(v: Value) bool {
    return switch (v) {
        .Array, .Null, .Bool, .Number, .String, .Date, .BigNumber, .Binary => true,
        .Object => false,
    };
}

pub fn detectIsoDate(str: []const u8) bool {
    if (str.len < 10) return false;
    var i: usize = 0;

    if (!expectDigits(str, &i, 4)) return false;
    if (!expectChar(str, &i, '-')) return false;
    if (!expectDigits(str, &i, 2)) return false;
    if (!expectChar(str, &i, '-')) return false;
    if (!expectDigits(str, &i, 2)) return false;

    if (i < str.len and str[i] == 'T') {
        i += 1;
        if (!expectDigits(str, &i, 2)) return false;
        if (!expectChar(str, &i, ':')) return false;
        if (!expectDigits(str, &i, 2)) return false;
        if (!expectChar(str, &i, ':')) return false;
        if (!expectDigits(str, &i, 2)) return false;
        if (i < str.len and str[i] == '.') {
            i += 1;
            while (i < str.len and isDigit(str[i])) i += 1;
        }
        if (i < str.len and str[i] == 'Z') {
            i += 1;
        } else if (i < str.len and (str[i] == '+' or str[i] == '-')) {
            i += 1;
            if (!expectDigits(str, &i, 2)) return false;
            if (!expectChar(str, &i, ':')) return false;
            if (!expectDigits(str, &i, 2)) return false;
        }
    }

    return i == str.len;
}

fn isDigit(ch: u8) bool {
    return ch >= '0' and ch <= '9';
}

fn expectDigits(s: []const u8, idx: *usize, count: usize) bool {
    var j: usize = 0;
    while (j < count) : (j += 1) {
        if (idx.* >= s.len or !isDigit(s[idx.*])) return false;
        idx.* += 1;
    }
    return true;
}

fn expectChar(s: []const u8, idx: *usize, ch: u8) bool {
    if (idx.* >= s.len or s[idx.*] != ch) return false;
    idx.* += 1;
    return true;
}
