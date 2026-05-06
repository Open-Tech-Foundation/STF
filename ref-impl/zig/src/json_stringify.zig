const std = @import("std");
const value = @import("value.zig");
const Value = value.Value;

pub fn stringifyJson(
    val: Value,
    allocator: std.mem.Allocator,
    indent: ?[]const u8,
) ![]const u8 {
    var buf = std.ArrayList(u8).empty;
    defer buf.deinit(allocator);
    try writeJson(&buf, val, allocator, indent, 0);
    return buf.toOwnedSlice(allocator);
}

pub fn stringifyJsonMinified(
    val: Value,
    allocator: std.mem.Allocator,
) ![]const u8 {
    return stringifyJson(val, allocator, null);
}

fn writeJson(
    buf: *std.ArrayList(u8),
    val: Value,
    allocator: std.mem.Allocator,
    indent: ?[]const u8,
    level: usize,
) !void {
    switch (val) {
        .Null => try buf.appendSlice(allocator, "null"),
        .Bool => |b| {
            if (b) try buf.appendSlice(allocator, "true") else try buf.appendSlice(allocator, "false");
        },
        .Number => |n| {
            var out_buf: [64]u8 = undefined;
            const s = try std.fmt.bufPrint(&out_buf, "{d}", .{n});
            try buf.appendSlice(allocator, s);
        },
        .String => |s| try writeJsonString(buf, s, allocator),
        .Array => |arr| {
            if (arr.len == 0) {
                try buf.appendSlice(allocator, "[]");
                return;
            }
            try buf.append(allocator, '[');
            if (indent) |ind| {
                try buf.append(allocator, '\n');
                var next = std.ArrayList(u8).empty;
                defer next.deinit(allocator);
                var l: usize = 0;
                while (l < level + 1) : (l += 1) try next.appendSlice(allocator, ind);
                for (arr, 0..) |item, i| {
                    try buf.appendSlice(allocator, next.items);
                    try writeJson(buf, item, allocator, indent, level + 1);
                    if (i < arr.len - 1) try buf.appendSlice(allocator, ",\n");
                }
                var close = std.ArrayList(u8).empty;
                defer close.deinit(allocator);
                l = 0;
                while (l < level) : (l += 1) try close.appendSlice(allocator, ind);
                try buf.appendSlice(allocator, "\n");
                try buf.appendSlice(allocator, close.items);
            } else {
                for (arr, 0..) |item, i| {
                    try writeJson(buf, item, allocator, indent, level + 1);
                    if (i < arr.len - 1) try buf.append(allocator, ',');
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
                var next = std.ArrayList(u8).empty;
                defer next.deinit(allocator);
                var l: usize = 0;
                while (l < level + 1) : (l += 1) try next.appendSlice(allocator, ind);
                for (entries, 0..) |entry, i| {
                    try buf.appendSlice(allocator, next.items);
                    try writeJsonString(buf, entry.key, allocator);
                    try buf.appendSlice(allocator, ": ");
                    try writeJson(buf, entry.value, allocator, indent, level + 1);
                    if (i < entries.len - 1) try buf.appendSlice(allocator, ",\n");
                }
                var close = std.ArrayList(u8).empty;
                defer close.deinit(allocator);
                l = 0;
                while (l < level) : (l += 1) try close.appendSlice(allocator, ind);
                try buf.appendSlice(allocator, "\n");
                try buf.appendSlice(allocator, close.items);
            } else {
                for (entries, 0..) |entry, i| {
                    try writeJsonString(buf, entry.key, allocator);
                    try buf.append(allocator, ':');
                    try writeJson(buf, entry.value, allocator, indent, level + 1);
                    if (i < entries.len - 1) try buf.append(allocator, ',');
                }
            }
            try buf.append(allocator, '}');
        },
        .Date => |d| {
            var tagged_buf: [256]u8 = undefined;
            const tagged = try std.fmt.bufPrint(&tagged_buf, "$date:{s}", .{d});
            try writeJsonString(buf, tagged, allocator);
        },
        .BigNumber => |b| {
            var cleaned = std.ArrayList(u8).empty;
            defer cleaned.deinit(allocator);
            var idx: usize = 0;
            var negative = false;
            if (b.len > 0 and b[0] == '-') {
                negative = true;
                idx = 1;
            }
            while (idx < b.len and b[idx] == '0') : (idx += 1) {}
            if (idx >= b.len) {
                try writeJsonString(buf, "$bigint:0", allocator);
            } else {
                var out_buf: [256]u8 = undefined;
                const cleaned_str = if (negative)
                    try std.fmt.bufPrint(&out_buf, "$bigint:-{s}", .{b[idx..]})
                else
                    try std.fmt.bufPrint(&out_buf, "$bigint:{s}", .{b[idx..]});
                try writeJsonString(buf, cleaned_str, allocator);
            }
        },
        .Binary => |b| {
            var tagged_buf: [512]u8 = undefined;
            const tagged = try std.fmt.bufPrint(&tagged_buf, "$binary:{s}", .{b});
            try writeJsonString(buf, tagged, allocator);
        },
    }
}

fn writeJsonString(buf: *std.ArrayList(u8), s: []const u8, allocator: std.mem.Allocator) !void {
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
                    var hex_buf: [8]u8 = undefined;
                    const hex = try std.fmt.bufPrint(&hex_buf, "\\u{X:0>4}", .{ch});
                    try buf.appendSlice(allocator, hex);
                } else {
                    try buf.append(allocator, ch);
                }
            },
        }
    }
    try buf.append(allocator, '"');
}
