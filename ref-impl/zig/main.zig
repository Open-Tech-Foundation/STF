const std = @import("std");

pub fn parse(input: []const u8) ![]const u8 {
    _ = input;
    return &[_]u8{};
}

pub fn stringify(value: []const u8) ![]u8 {
    _ = value;
    return &[_]u8{};
}

// Export WASM functions
export fn parse_wasm(input_ptr: [*]const u8, input_len: usize) [*]u8 {
    const input = input_ptr[0..input_len];
    const result = parse(input) catch return &[_]u8{};
    return @ptrCast([*]u8, result.ptr);
}

export fn stringify_wasm(input_ptr: [*]const u8) [*]u8 {
    const input = input_ptr[0..];
    const result = stringify(input) catch return &[_]u8{};
    return @ptrCast([*]u8, result.ptr);
}
