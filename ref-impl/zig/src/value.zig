const std = @import("std");

pub const MAX_DEPTH = 64;

pub const Value = union(enum) {
    Null,
    Bool: bool,
    Number: f64,
    String: []const u8,
    Array: []Value,
    Object: []ObjectEntry,
    Date: []const u8,
    BigNumber: []const u8,
    Binary: []const u8,

    pub const ObjectEntry = struct {
        key: []const u8,
        value: Value,
    };

    pub fn deinit(self: Value, allocator: std.mem.Allocator) void {
        switch (self) {
            .Null, .Bool, .Number => {},
            .String => |s| allocator.free(s),
            .Array => |arr| {
                for (arr) |item| item.deinit(allocator);
                allocator.free(arr);
            },
            .Object => |entries| {
                for (entries) |entry| {
                    allocator.free(entry.key);
                    entry.value.deinit(allocator);
                }
                allocator.free(entries);
            },
            .Date => |d| allocator.free(d),
            .BigNumber => |b| allocator.free(b),
            .Binary => |b| allocator.free(b),
        }
    }

    pub fn clone(self: Value, allocator: std.mem.Allocator) !Value {
        switch (self) {
            .Null => return .Null,
            .Bool => |b| return .{ .Bool = b },
            .Number => |n| return .{ .Number = n },
            .String => |s| return .{ .String = try allocator.dupe(u8, s) },
            .Array => |arr| {
                const new_arr = try allocator.alloc(Value, arr.len);
                for (arr, 0..) |item, i| {
                    new_arr[i] = try item.clone(allocator);
                }
                return .{ .Array = new_arr };
            },
            .Object => |entries| {
                const new_entries = try allocator.alloc(ObjectEntry, entries.len);
                for (entries, 0..) |entry, i| {
                    new_entries[i] = .{
                        .key = try allocator.dupe(u8, entry.key),
                        .value = try entry.value.clone(allocator),
                    };
                }
                return .{ .Object = new_entries };
            },
            .Date => |d| return .{ .Date = try allocator.dupe(u8, d) },
            .BigNumber => |b| return .{ .BigNumber = try allocator.dupe(u8, b) },
            .Binary => |b| return .{ .Binary = try allocator.dupe(u8, b) },
        }
    }

    pub fn tagEquals(self: Value, comptime t: std.meta.Tag(Value)) bool {
        return @intFromEnum(self) == @intFromEnum(t);
    }
};

pub const Error = error{
    UnexpectedEnd,
    InvalidToken,
    DuplicateKey,
    ExpectedColon,
    ExpectedCommaOrClose,
    InvalidNumber,
    InvalidString,
    InvalidConstructor,
    UnknownConstructor,
    NestingTooDeep,
    InvalidDate,
    InvalidBigNumber,
    InvalidBinary,
    InvalidJson,
    TrailingData,
    InvalidEscape,
    InvalidConstructorPayload,
} || std.mem.Allocator.Error;

pub fn sortEntries(entries: []Value.ObjectEntry) void {
    std.sort.block(Value.ObjectEntry, entries, {}, struct {
        pub fn lessThan(_: void, a: Value.ObjectEntry, b: Value.ObjectEntry) bool {
            return std.mem.lessThan(u8, a.key, b.key);
        }
    }.lessThan);
}
