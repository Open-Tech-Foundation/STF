const std = @import("std");
const value = @import("value.zig");
const Value = value.Value;

pub fn stringify(
    val: Value,
    allocator: std.mem.Allocator,
    indent: ?[]const u8,
) ![]const u8 {
    var buf = std.ArrayList(u8).empty;
    defer buf.deinit(allocator);
    try writeValue(&buf, val, allocator, indent, 0);
    return buf.toOwnedSlice(allocator);
}

pub fn formatValue(
    val: Value,
    allocator: std.mem.Allocator,
) ![]const u8 {
    return stringify(val, allocator, "  ");
}

pub fn stringifyMinified(
    val: Value,
    allocator: std.mem.Allocator,
) ![]const u8 {
    return stringify(val, allocator, null);
}

fn writeValue(
    buf: *std.ArrayList(u8),
    val: Value,
    allocator: std.mem.Allocator,
    indent: ?[]const u8,
    level: usize,
) !void {
    switch (val) {
        .Null => try buf.append(allocator, 'N'),
        .Bool => |b| {
            if (b) try buf.appendSlice(allocator, "T") else try buf.appendSlice(allocator, "F");
        },
        .Number => |n| {
            var out_buf: [64]u8 = undefined;
            const s = try std.fmt.bufPrint(&out_buf, "{d}", .{n});
            try buf.appendSlice(allocator, s);
        },
        .String => |s| {
            if (std.mem.indexOf(u8, s, "`") != null) {
                try buf.append(allocator, '"');
                for (s) |ch| {
                    switch (ch) {
                        '"' => try buf.appendSlice(allocator, "\\\""),
                        '\\' => try buf.appendSlice(allocator, "\\\\"),
                        '\n' => try buf.appendSlice(allocator, "\\n"),
                        '\r' => try buf.appendSlice(allocator, "\\r"),
                        '\t' => try buf.appendSlice(allocator, "\\t"),
                        '\x08' => try buf.appendSlice(allocator, "\\b"),
                        '\x0C' => try buf.appendSlice(allocator, "\\f"),
                        else => {
                            if (ch < 0x20) {
                                var hex_buf: [6]u8 = undefined;
                                const hex = std.fmt.bufPrint(&hex_buf, "\\u{X:0>4}", .{ch}) catch @panic("buf too small");
                                try buf.appendSlice(allocator, hex);
                            } else {
                                try buf.append(allocator, ch);
                            }
                        },
                    }
                }
                try buf.append(allocator, '"');
            } else {
                try buf.append(allocator, '`');
                try buf.appendSlice(allocator, s);
                try buf.append(allocator, '`');
            }
        },
        .Array => |arr| {
            if (arr.len == 0) {
                try buf.appendSlice(allocator, "[]");
                return;
            }
            try buf.append(allocator, '[');
            if (indent) |ind| {
                try buf.append(allocator, '\n');
                var next_indent = std.ArrayList(u8).empty;
                defer next_indent.deinit(allocator);
                try next_indent.appendSlice(allocator, ind);
                var l: usize = 0;
                while (l < level + 1) : (l += 1) try next_indent.appendSlice(allocator, ind);
                for (arr) |item| {
                    try buf.appendSlice(allocator, next_indent.items);
                    try writeValue(buf, item, allocator, indent, level + 1);
                    try buf.appendSlice(allocator, ",\n");
                }
                var close = std.ArrayList(u8).empty;
                defer close.deinit(allocator);
                l = 0;
                while (l < level + 1) : (l += 1) try close.appendSlice(allocator, ind);
                try buf.appendSlice(allocator, close.items);
            } else {
                for (arr) |item| {
                    try writeValue(buf, item, allocator, indent, level + 1);
                    try buf.append(allocator, ',');
                }
            }
            try buf.append(allocator, ']');
        },
        .Object => |entries| {
            if (entries.len == 0) {
                try buf.appendSlice(allocator, "{}");
                return;
            }
            try buf.append(allocator, '{');
            if (indent) |ind| {
                try buf.append(allocator, '\n');
                var next_indent = std.ArrayList(u8).empty;
                defer next_indent.deinit(allocator);
                var l: usize = 0;
                while (l < level + 1) : (l += 1) try next_indent.appendSlice(allocator, ind);
                for (entries) |entry| {
                    try buf.appendSlice(allocator, next_indent.items);
                    try buf.appendSlice(allocator, entry.key);
                    try buf.appendSlice(allocator, ": ");
                    try writeValue(buf, entry.value, allocator, indent, level + 1);
                    try buf.appendSlice(allocator, ",\n");
                }
                var close = std.ArrayList(u8).empty;
                defer close.deinit(allocator);
                l = 0;
                while (l < level + 1) : (l += 1) try close.appendSlice(allocator, ind);
                try buf.appendSlice(allocator, close.items);
            } else {
                for (entries) |entry| {
                    try buf.appendSlice(allocator, entry.key);
                    try buf.append(allocator, ':');
                    try writeValue(buf, entry.value, allocator, indent, level + 1);
                    try buf.append(allocator, ',');
                }
            }
            try buf.append(allocator, '}');
        },
        .Date => |d| {
            try buf.appendSlice(allocator, "Date(");
            try buf.appendSlice(allocator, d);
            try buf.append(allocator, ')');
        },
        .BigNumber => |b| {
            try buf.appendSlice(allocator, "BigNumber(");
            try buf.appendSlice(allocator, b);
            try buf.append(allocator, ')');
        },
        .Binary => |b| {
            try buf.appendSlice(allocator, "Binary(");
            try buf.appendSlice(allocator, b);
            try buf.append(allocator, ')');
        },
    }
}
